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

/* The board contract every extraction sub-agent works under. The failures this
 * exists to stop were all seen in production output:
 *   - the board ref returned per ROW as "DB-1-GF-5", inventing a board per way;
 *   - the phase suffix folded into the board name, tripling the board count;
 *   - three-phase ways collapsed to one row, losing two devices in three. */
function boardContract(facts) {
  const lines = [
    '',
    '--- BOARD CONTRACT (follow exactly) ---',
    '1. The BOARD is named once, in the page header. Every row on this page belongs',
    '   to that one board. Return its reference EXACTLY as the header writes it.',
    '2. NEVER build a board reference out of a row. A way number or phase is NOT part',
    '   of the board name: the board is "DB-1-GF", never "DB-1-GF-5" or "DB-1-GF-5-L2".',
    '3. The way number and the phase are SEPARATE fields — way: "5", phase: "L2".',
    '4. A three-phase way is THREE devices, one per phase. Return one row per phase,',
    '   never one row for the way. Missing a phase loses two devices in three.',
    '5. Return a row for EVERY way the header declares, including spares. Mark an',
    '   unused way as spare rather than omitting it — an omission is indistinguishable',
    '   from a miss, and completeness is the thing being audited.',
    '6. Copy ratings, curves and cable data as printed. Do not normalise, round, or',
    '   infer a value that is not on the page. Leave a field null instead of guessing.',
  ];
  if (facts && facts.boardRef) lines.push(`7. This page's header declares board: ${facts.boardRef}. Use it verbatim.`);
  if (facts && facts.waysTotal) lines.push(`8. This page's header declares ${facts.waysTotal} ways. Account for all ${facts.waysTotal}.`);
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
  const req = {
    system: EXTRACTION_SYSTEM_PROMPT,
    prompt: instruction + boardContract(facts) + SCHEMA_DEMAND,
    imageBase64, mediaType,
    maxTokens: 12000,
  };

  // 1) primary extraction — route to vision_parse if image is present but text is absent
  // (image-only pages silently fail on non-vision models). Extract chain handles pages
  // with text + optional image; vision_parse handles image-only pages.
  const role = imageBase64 && (!textLines || textLines.length === 0) ? 'vision_parse' : 'extract';
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
