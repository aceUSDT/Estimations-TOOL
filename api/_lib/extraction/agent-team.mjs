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
  const raw = Array.isArray(textLines) ? textLines.join(' \n ') : String(textLines || '');
  const text = raw.replace(/\s+/g, ' ');
  const ref = (text.match(/\bREFERENCE\s*[:=-]?\s*([A-Z0-9][A-Z0-9/._-]{1,20})/i) || [])[1] || null;
  const waysRaw = (text.match(/NUMBER\s+OF\s+WAYS\s*[:=-]?\s*(\d{1,3})/i) || [])[1] || null;
  const ways = waysRaw ? Number(waysRaw) : null;
  /* A schematic is a different reading job from a schedule, so the agent is
   * told which one it has. Signals are the drawing's own words. */
  const schematic = /\b(single[- ]?line|schematic|busbar|switchboard|riser diagram)\b/i.test(text)
    && !/\bcircuit ref\b/i.test(text);
  return {
    boardRef: ref,
    waysTotal: Number.isFinite(ways) && ways > 0 && ways <= 200 ? ways : null,
    schematic,
  };
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
    'READ THE LAYOUT BEFORE YOU READ THE DATA',
    'Every practice draws these sheets differently. The orders below tell you what',
    'a board schedule MEANS; they cannot tell you where this one puts things. So',
    'work that out first, explicitly, before extracting a single row:',
    'A. Find the BOARD HEADER BLOCK. It is the group of label/value pairs naming the',
    '   board and its size. The label varies — REFERENCE, DB REFERENCE, Id No:,',
    '   BOARD, PANEL — and the way count may be its own field ("NUMBER OF WAYS: 18",',
    '   "No. of Ways: 26") or buried in a type string ("12-WAY TP&N", "8 WAY SP&N").',
    'B. Ask whether this sheet carries MORE THAN ONE board. Drawing sheets often',
    '   print an existing board and its replacement side by side, each with its own',
    '   header block and its own table. If so, treat them as separate boards and',
    '   attribute each row to the header block above it — never merge them.',
    'C. Find the TABLE and identify its columns by their headings, not by position.',
    '   Way, phase, rating, device, cable, circuit type and description appear in',
    '   any order, and some sheets label none of them.',
    'D. Decide which DIRECTION a row reads. Most read left to right, one way per row.',
    '   But a mirrored or "double-sided" chart prints two half-tables facing each',
    '   other across a central BUSBAR column: one printed row then carries TWO ways,',
    '   odd on the left and even on the right, and each half reads OUTWARD from the',
    '   busbar. The giveaway is a repeating spine of way, phase, phase, way',
    '   ("1 L1 L1 2", "3 L2 L2 4"). Read both halves. Reading such a sheet left to',
    '   right returns nothing at all.',
    'E. Note where the sheet puts things that are NOT outgoing ways — the incomer',
    '   block, the busbar rating, the legend, the revision panel, the general notes.',
    '   Notes printed alongside the table will run into your row text; ignore them',
    '   rather than reading them as circuit descriptions.',
    'F. State your reading in "layout" before the rows: which board(s) you found and',
    '   where, how one row maps to ways, and which column is which. If the sheet does',
    '   not match anything you recognise, say so there and extract conservatively —',
    '   a stated uncertainty is reviewable, a confident misreading is not.',
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
  if (facts && facts.schematic) {
    lines.push(
      '',
      'THIS PAGE IS A SCHEMATIC / SINGLE-LINE DIAGRAM — read it as a TREE, not a table.',
      '',
      'A panel on one of these drawings has THREE parts, and a take-off needs all',
      'three. Work through them in this order.',
      '',
      'PART 1 — THE PANEL ITSELF. A titled block, usually to one side, states the',
      '18. panel and its rating: "12WAY TP&N PANELBOARD - PB1 / GROUND FLOOR PLANT',
      '    ROOM / RATED VOLTAGE: 415V / RATED CURRENT: 250A / CLASSIFICATION: FORM 4',
      '    TYPE 2". That block is the BOARD HEADER — read it exactly as you would a',
      '    schedule\'s: reference PB1, 12 ways, TP&N, 250A, and its location. The',
      '    panel is equipment in its own right. Returning only the boards it feeds',
      '    is the single most common failure on these pages.',
      '',
      'PART 2 — THE INCOMER. Below or beside the busbar sits the incoming chain, and',
      '19. every item in it is a device: the incoming breaker ("200A SET AT 160A TP+N',
      '    TMD" — return BOTH numbers, the frame is 200A and the setting 160A), the',
      '    metering ("NEUVOLT METER", drawn as a circled M), the surge protection',
      '    ("SPD T1+T2"), and any current transformers ("CT"). Metering, SPD and CTs',
      '    are NOT protective devices — return them with their own class, as control',
      '    and associated equipment.',
      '',
      'PART 3 — THE OUTGOING WAYS. These hang off the busbar, each drawn as a small',
      '20. block with its way number, then its rating and type stacked beneath:',
      '      1  125 A ML2.3 TPN        5  40A ML2.3',
      '      4 L1  20 A TMD SPN        6  100/125 A ML2.3 TPN',
      '    Return one row per way with: the way NUMBER, its PHASE where one is shown,',
      '    the RATING, the device type as printed, and the pole configuration',
      '    (TPN, SPN, TP+N). All of it is on the drawing; none of it is inferred.',
      '21. The device is named by its MODEL, not by a class word. "ML2.3", "TMD",',
      '    "MCCB" and "ACB" all name the same kind of thing. Do NOT skip a way',
      '    because the word MCCB never appears — most of these drawings never write',
      '    it. Return the printed designation and let the classifier decide.',
      '22. A rating written as a pair — "100/125 A" — is a frame size and a trip',
      '    setting. Return both rather than choosing one.',
      '23. A way number repeated against L1, L2 and L3 ("4 L1", "4 L2", "4 L3") is',
      '    ONE way carrying THREE single-phase devices. Return three rows. Reading it',
      '    as one way loses two devices in three.',
      '24. "SPARE WAY" is a way that exists and holds no device. Return it, marked',
      '    spare, with its pole configuration. Spare capacity is part of the take-off',
      '    and omitting it makes the board look smaller than it is.',
      '25. A circled M drawn on an outgoing way is a METER on that way — associated',
      '    equipment belonging to the panel, never a protective device.',
      '',
      'AND ACROSS ALL THREE',
      '26. A feed is a relationship: from the panel, through a device and a cable, to',
      '    a board. Return the pair — the device on the panel side AND the board it',
      '    feeds — so the tree can be rebuilt. Do not merge them into one row.',
      '27. Ratings printed alongside a line belong to the device on that line. A',
      '    cable specification ("XLPE / LSF / CU", "150A CPC", "4C 95mm²", "SWA") is',
      '    not a device rating; keep them apart.',
      '28. Feeder pillars, EV charge points and similar sub-assemblies carry their',
      '    own outgoing devices. Return them; they are frequently the largest single',
      '    omission on a schematic.',
      '29. Text marked "BY OTHERS" or "GREY BY OTHERS" describes equipment outside',
      '    this package. Return it, flagged, rather than dropping it or pricing it.',
    );
  }
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
    'a0. CHECK HOW THE AGENTS READ THE SHEET. Each returns a "layout" saying which',
    '    board(s) it found and how one printed row maps to ways. A wrong layout is',
    '    the largest miss there is — it loses a whole board or half of every row,',
    '    and it shows up as an empty or half-empty result rather than as a wrong',
    '    value. Two signals to check against the source text:',
    '    - a repeating spine of way, phase, phase, way ("1 L1 L1 2", "3 L2 L2 4") is',
    '      a MIRRORED chart: one printed row carries two ways, odd left and even',
    '      right. An agent reporting left_to_right on such a sheet has read half of',
    '      it at most.',
    '    - more than one board header block on the sheet means more than one board.',
    '      An agent reporting one has attributed a whole board to its neighbour.',
    '    Where the layout reading is wrong, say so plainly in "notes" and set',
    '    complete=false, whatever the way arithmetic says.',
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
