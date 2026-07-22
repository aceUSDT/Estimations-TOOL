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

/* Master (Gemini) verdict prompt: audit, don't re-extract. */
function masterPrompt({ textLines, primary, second, mismatches }) {
  return [
    'You are the MASTER AUDITOR for an electrical take-off system. Two independent',
    'extraction agents have read a distribution-board schedule page. Your job is to',
    'audit COMPLETENESS: is anything present in the source that BOTH agents missed?',
    'You never change counts yourself — you report findings for human review.',
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
  const req = {
    system: EXTRACTION_SYSTEM_PROMPT,
    prompt: instruction + SCHEMA_DEMAND,
    imageBase64, mediaType,
    maxTokens: 12000,
  };

  // 1) primary extraction — first healthy model in the extract chain
  const a = await deps.pool.callRole('extract', req);
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
  };
}
