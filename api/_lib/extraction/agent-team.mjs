/* The AI agent team — Gemini master, NVIDIA sub-agents.
 *
 * Owner's architecture (decided 2026-07-22): Gemini is the MASTER agent that
 * oversees the work of the free NVIDIA sub-agents so nothing is missed. The
 * flow per page:
 *
 *   1. EXTRACT        sub-agent (role chain) reads the page → structured JSON
 *   2. SECOND OPINION a DIFFERENT model re-extracts independently
 *   3. CROSS-CHECK    deterministic code (crossCheckExtractions) computes the
 *                     disagreements — no model resolves another model's work
 *   4. MASTER REVIEW  Gemini audits: sees the source, both extractions, and
 *                     the computed disagreements; reports anything present on
 *                     the page but uncaptured, and flags rows to review
 *
 * Invariants (unchanged from the platform's contract):
 *  - Deterministic code computes every count/total; no agent, not even the
 *    master, invents a number. Master findings become REVIEW items.
 *  - A pipeline with no configured master still returns honest output —
 *    master: {status:'skipped'} — it never silently pretends it was audited.
 *  - Errors carry stable codes and never leak key material.
 */
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_SCHEMA, coerceResult } from './domain-pack.mjs';
import { parseModelJson } from './nvidia-pool.mjs';

const SCHEMA_DEMAND =
  '\n\nRespond with ONLY a single JSON object matching this schema (no prose, no code fences):\n'
  + JSON.stringify(EXTRACTION_SCHEMA);

/* The master's verdict shape — deliberately NOT the extraction schema: the
 * master audits, it does not re-extract. */
export const MASTER_VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['complete', 'missed', 'notes'],
  properties: {
    complete: { type: 'boolean' },
    missed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['board_ref', 'way', 'evidence'],
        properties: {
          board_ref: { type: 'string' },
          way: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
  },
};

/* What the page states about itself. Deterministic, so the master is handed
 * FACTS rather than being asked to infer them: a board schedule declares its
 * board and its way count in a header block, and that is the yardstick every
 * agent is measured against. */
export function declaredHeaderFacts(textLines) {
  const text = (Array.isArray(textLines) ? textLines.join(' \n ') : String(textLines || '')).replace(/\s+/g, ' ');
  const ref = (text.match(/\bREFERENCE\s*[:=-]?\s*([A-Z0-9][A-Z0-9/._-]{1,20})/i) || [])[1] || null;
  const waysRaw = (text.match(/NUMBER\s+OF\s+WAYS\s*[:=-]?\s*(\d{1,3})/i) || [])[1] || null;
  const ways = waysRaw ? Number(waysRaw) : null;
  return { boardRef: ref, waysTotal: Number.isFinite(ways) && ways > 0 && ways <= 200 ? ways : null };
}

/* Ways the agents actually returned, and which declared ways are unaccounted
 * for. Computed in code — the master is told the answer, never asked to count.
 * "Code computes" applies to the audit as much as to the take-off. */
export function wayCoverage(declared, ...extractions) {
  const seen = new Set();
  for (const ex of extractions) {
    for (const d of (ex && Array.isArray(ex.devices) ? ex.devices : [])) {
      const way = d && d.way != null && d.way !== '' ? String(d.way).trim() : null;
      if (way) seen.add(way.replace(/^0+(?=\d)/, ''));
    }
  }
  const total = declared && declared.waysTotal;
  if (!total) return { captured: [...seen], missing: [], checkable: false };
  const missing = [];
  for (let w = 1; w <= total; w++) if (!seen.has(String(w))) missing.push(String(w));
  return { captured: [...seen], missing, checkable: true };
}

/* The standing orders every extraction sub-agent works under.
 *
 * Source of truth: docs/EXTRACTION_SOP.md. Every rule here exists because a real
 * document broke without it, and each is phrased as the decision the agent has
 * to make rather than as general advice — an instruction the model cannot act
 * on is decoration.
 *
 * Deliberately NOT included: anything code already decides. Counting, grouping,
 * capacity and completeness are arithmetic and belong to the deterministic
 * layer. Asking a model to do them invites it to disagree with the answer.
 */
function boardContract(facts, role) {
  const lines = [
    '',
    '--- STANDING ORDERS (follow exactly; these override any habit) ---',
    '',
    'BOARD IDENTITY',
    '1. The BOARD is named ONCE, in the page header block. Every row on this page',
    '   belongs to that one board. Return its reference EXACTLY as the header writes',
    '   it — same punctuation, same case.',
    '2. NEVER build a board reference out of a row. A way number or a phase is not',
    '   part of a board name: the board is "DB-1-GF", never "DB-1-GF-5", never',
    '   "DB-1-GF-5-L2", never "154-DB-7-GCS-11".',
    '3. A current rating is not a board. "630A" is the size of a device.',
    '4. If the header names the board by DESCRIPTION ("110V AC DISTRIBUTION BOARD"),',
    '   that IS the board reference. Return it as written.',
    '5. If this page has no header of its own, it continues the previous board —',
    '   return the same board reference rather than inventing one.',
    '',
    'CIRCUITS',
    '6. The way number and the phase are SEPARATE fields: way "5", phase "L2".',
    '   Never merge them, never put either in the board reference.',
    '7. A three-phase way is THREE devices, one per phase. Return one row per phase.',
    '   Returning one row for the way loses two devices in three.',
    '8. Return a row for EVERY way the header declares, including spares. Mark an',
    '   unused way as spare rather than omitting it — an omission cannot be told',
    '   apart from a miss.',
    '9. A block row such as "12-L1,L2,L3 - 18-L1,L2,L3 ... SPARE" declares ways 12',
    '   THROUGH 18 spare. Expand it: one spare row per way in the range.',
    '10. Copy ratings, curves, cable sizes and CPC as printed. Do not round, do not',
    '    normalise, do not infer a value that is not on the page. A null field is',
    '    honest; a plausible invention is not.',
    '',
    'DEVICE CLASS',
    '11. Protection decides the class, not the label. A device with a residual',
    '    current value (30mA, 100mA) is an RCBO even where the drawing prints "MCB".',
    '12. AFDD with RCD protection is "AFDD+RCBO" — not AFDD alone, not RCBO alone.',
    '13. Control equipment — contactor, time clock, photocell, relay, starter, meter,',
    '    transformer — belongs to the board but is NOT a protective device. Return it',
    '    with its own class; never fold it into MCB/RCBO counts.',
    '14. A way marked SPARE has no device. A way marked SPACE has no device and no',
    '    outgoing circuit. They are different; keep them so.',
    '',
    'WHAT NOT TO DO',
    '15. Do not count anything. Do not total, subtotal or reconcile — deterministic',
    '    code does that, and a number from you competes with the one that is right.',
    '16. Do not resolve a disagreement between two documents. Report both readings.',
    '17. Do not skip a row because it looks malformed. Return it with the fields you',
    '    can read and leave the rest null, so a human sees it in Review.',
  ];
  if (role === 'vision_parse') {
    lines.push(
      '',
      'THIS PAGE IS AN IMAGE — no reliable text layer accompanies it.',
      '18. Read the table visually, column by column. Drawing sheets are frequently',
      '    ROTATED: if the text runs vertically, read it in the orientation the table',
      '    is drawn, not the orientation of the page.',
      '19. Follow the ruled lines. A value belongs to the row and column its cell',
      '    sits in, not to the nearest text on the page.',
      '20. If the image is too faint or cropped to read a region, say so in that',
      '    row rather than guessing at it.',
    );
  }
  if (facts && facts.boardRef) lines.push('', `THIS PAGE DECLARES BOARD: ${facts.boardRef}. Use it verbatim for every row.`);
  if (facts && facts.waysTotal) lines.push(`THIS PAGE DECLARES ${facts.waysTotal} WAYS. Account for all ${facts.waysTotal}, spares included.`);
  return lines.join('\n');
}

/* Master (Gemini) verdict prompt: audit, don't re-extract. */
function masterPrompt({ textLines, primary, second, mismatches, facts, coverage }) {
  const declared = [];
  if (facts && facts.boardRef) declared.push(`Header declares board: ${facts.boardRef}.`);
  if (facts && facts.waysTotal) declared.push(`Header declares ${facts.waysTotal} ways.`);
  if (coverage && coverage.checkable) {
    declared.push(`Agents returned ways: [${coverage.captured.join(', ') || 'none'}].`);
    declared.push(coverage.missing.length
      ? `UNACCOUNTED WAYS (computed, not your estimate): [${coverage.missing.join(', ')}].`
      : 'Every declared way is accounted for.');
  }
  return [
    'You are the MASTER AUDITOR for an electrical take-off system. Two independent',
    'extraction agents have read a distribution-board schedule page. Your job is to',
    'audit COMPLETENESS: is anything present in the source that BOTH agents missed?',
    'You never change counts yourself — you report findings for human review.',
    '',
    '--- WHAT THE PAGE DECLARES ABOUT ITSELF (computed deterministically) ---',
    ...(declared.length ? declared : ['The page declares no board reference or way count.']),
    '',
    'For each UNACCOUNTED way above, check the source text. If the way carries a',
    'device the agents did not return, list it in "missed". If it is genuinely blank',
    'or marked SPARE, do not list it. A way count that does not add up is the single',
    'most important thing to report: set complete=false when real devices are absent.',
    '',
    'HOW TO AUDIT (in order):',
    'a. A block row such as "12-L1,L2,L3 - 18-L1,L2,L3 ... SPARE" accounts for every',
    '   way in that range. Those ways are NOT missing.',
    'b. A three-phase way needs THREE rows, one per phase. Two rows where the source',
    '   shows three phases is a miss — report the absent phase.',
    'c. Control equipment (contactor, time clock, photocell, relay, starter, meter) is',
    '   often listed apart from the protective devices. If the page shows it and',
    '   neither agent returned it, that is a miss.',
    'd. A device with a residual current value is an RCBO even where the drawing says',
    '   MCB. Disagreement on class alone is a review flag, not a missing device.',
    'e. Do NOT count, total or reconcile. The numbers above were computed; your job is',
    '   to explain the gaps, not to recalculate them.',
    'f. Report only what the SOURCE shows. An empty region of the page is not a miss,',
    '   and inventing one sends a real estimator hunting for a device that is not there.',
    '',
    '--- SOURCE PAGE TEXT LINES ---',
    ...(textLines || []).slice(0, 400),
    '',
    '--- AGENT A (primary) EXTRACTION ---',
    JSON.stringify(primary),
    '',
    '--- AGENT B (second opinion) EXTRACTION ---',
    JSON.stringify(second),
    '',
    '--- DISAGREEMENTS (computed deterministically) ---',
    JSON.stringify(mismatches),
    '',
    'Reply with ONLY JSON: {"complete": boolean, "missed": [{"board_ref": string,',
    '"way": string, "evidence": string}], "notes": string}. "missed" lists ONLY items',
    'visible in the source text that appear in NEITHER extraction. Be conservative:',
    'an empty source region is not a missed item.',
  ].join('\n');
}

/* Run one page through the team.
 * deps: { pool            — createPool() instance (NVIDIA sub-agents)
 *         callMaster      — ({instruction, schema, maxTokens}) → {json} (Gemini)
 *         crossCheck      — crossCheckExtractions (deterministic)
 *         buildInstruction— shared instruction builder
 *         geminiConfigured— boolean }                                        */
export async function runAgentTeam(page, deps) {
  const { imageBase64, mediaType, textLines, filename, pageNumber, hints } = page;
  const instruction = page.instruction || deps.buildInstruction({ filename, pageNumber, hints, textLines });
  /* Every sub-agent works under the same explicit board contract, so the roles
     cannot disagree about what a board, a way and a phase are. */
  const facts = declaredHeaderFacts(textLines);
  /* Role is decided BEFORE the request is built, so a vision agent receives the
     orders written for reading an image — a page with no text layer is a
     different job from a page with one, and sending the same brief to both is
     how an image-only page came back empty. */
  const role = imageBase64 && (!textLines || textLines.length === 0) ? 'vision_parse' : 'extract';
  const req = {
    system: EXTRACTION_SYSTEM_PROMPT,
    prompt: instruction + boardContract(facts, role) + SCHEMA_DEMAND,
    imageBase64, mediaType,
    maxTokens: 12000,
  };

  // 1) primary extraction — route to vision_parse if image is present but text is absent
  // (image-only pages silently fail on non-vision models). Extract chain handles pages
  // with text + optional image; vision_parse handles image-only pages.
  const a = await deps.pool.callRole(role, req);
  const primary = coerceResult(parseModelJson(a.content) || {});

  // 2) independent second opinion — never the same model
  let b = null, second = null;
  try {
    b = await deps.pool.callRole('second_opinion', req, { exclude: [a.model] });
    second = coerceResult(parseModelJson(b.content) || {});
  } catch (e) {
    // A missing second opinion degrades honestly: verification reports it.
  }

  // 3) deterministic disagreement computation (never model-resolved) — same
  //    {status:'done', ...} contract the Gemini-only verifier emits, so the
  //    worker and UI need no engine-specific branching.
  const verification = second
    ? { status: 'done', provider: 'nvidia', model: b.model, ...deps.crossCheck(primary, second) }
    : { status: 'unavailable', provider: 'nvidia', reason: 'second_opinion_unavailable' };

  // 4) master audit — Gemini oversees; skipped is reported, never faked
  let master = { status: 'skipped', reason: 'gemini_unconfigured' };
  if (deps.geminiConfigured) {
    try {
      const { json: verdict } = await deps.callMaster({
        instruction: masterPrompt({
          textLines,
          primary,
          second,
          mismatches: verification.mismatches || [],
          facts,
          coverage: wayCoverage(facts, primary, second),
        }),
        schema: MASTER_VERDICT_SCHEMA,
        maxTokens: 4000,
      });
      master = verdict && typeof verdict.complete === 'boolean'
        ? {
            status: 'reviewed',
            complete: verdict.complete,
            missed: Array.isArray(verdict.missed) ? verdict.missed : [],
            notes: typeof verdict.notes === 'string' ? verdict.notes.slice(0, 2000) : '',
          }
        : { status: 'error', reason: 'unparseable_verdict' };
    } catch {
      master = { status: 'error', reason: 'master_call_failed' };
    }
  }

  return {
    result: primary,
    verification,
    master,
    agents: {
      extractor: { model: a.model, key: a.keyId, ms: a.ms },
      second: b ? { model: b.model, key: b.keyId, ms: b.ms } : null,
    },
    provider: 'nvidia+gemini',
    model: a.model,
    imageBase64: Boolean(imageBase64),  // track whether image was provided for deriveState
  };
}
