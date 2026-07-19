/* AI extraction provider — Google Gemini is the ONLY hosted AI provider.
 * Keys live ONLY in server-side env vars — never in the repo or browser.
 *
 *   GEMINI_API_KEY        required — https://aistudio.google.com/apikey
 *   GEMINI_MODEL          optional override (default pinned below — never a
 *                         "latest" alias; changing models is a deliberate,
 *                         benchmarked decision, not a silent default bump)
 *   GEMINI_VERIFY_MODEL   optional second Gemini model. When set, every page
 *                         is read twice and the two extractions are compared
 *                         by DETERMINISTIC CODE (crossCheckExtractions): the
 *                         models never judge each other — disagreements are
 *                         surfaced for human review, never auto-resolved.
 */
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_SCHEMA, coerceResult } from './domain-pack.mjs';

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
export const GEMINI_VERIFY_MODEL = process.env.GEMINI_VERIFY_MODEL || null;

export function providerStatus() {
  const gemini = Boolean(process.env.GEMINI_API_KEY);
  return {
    gemini,
    configured: gemini,
    primary: gemini ? 'gemini' : null,
    verify: gemini && Boolean(GEMINI_VERIFY_MODEL),
  };
}

export function buildInstruction({ filename, pageNumber, hints, textLines }) {
  let instruction = `Extract this page into the schema. Document: ${filename || 'unknown'}, page ${pageNumber || '?'}.`;
  if (hints && hints.type) instruction += ` Classifier hint (may be wrong): ${hints.type}${hints.sub_format ? ' / ' + hints.sub_format : ''}.`;
  if (Array.isArray(textLines) && textLines.length) {
    instruction += `\n\nOCR/native text lines from the same page (may contain OCR errors — the image is authoritative where they disagree):\n`
      + textLines.slice(0, 400).map((l) => String(l)).join('\n');
  }
  return instruction;
}

/* Gemini's responseJsonSchema accepts a JSON-Schema subset; strip the keywords
 * it rejects. Structure (properties/required/enum/items/type) is preserved so
 * both runs fill the SAME shape and the comparator can diff them 1:1. */
export function geminiSchema(node) {
  if (Array.isArray(node)) return node.map(geminiSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'additionalProperties' || key === '$schema' || key === 'default') continue;
    out[key] = geminiSchema(value);
  }
  return out;
}

export async function callGemini({ imageBase64, mediaType, instruction, maxTokens = 16000, model = GEMINI_MODEL }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY unset');
  const parts = [];
  if (imageBase64) parts.push({ inlineData: { mimeType: mediaType || 'image/jpeg', data: imageBase64 } });
  parts.push({ text: instruction });
  const body = {
    systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
      responseJsonSchema: geminiSchema(EXTRACTION_SCHEMA),
    },
  };
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Gemini API error ${resp.status}: ${detail.slice(0, 300)}`);
  }
  const data = await resp.json();
  const candidate = data.candidates && data.candidates[0];
  if (!candidate || !candidate.content || !Array.isArray(candidate.content.parts)) {
    throw new Error(`Gemini returned no candidate (${candidate && candidate.finishReason || 'no finishReason'})`);
  }
  if (candidate.finishReason === 'MAX_TOKENS') throw Object.assign(new Error('Extraction output truncated (max_tokens)'), { stop_reason: 'max_tokens' });
  const text = candidate.content.parts.map((p) => p.text || '').join('');
  return {
    result: coerceResult(JSON.parse(text)),
    model,
    usage: {
      input_tokens: data.usageMetadata ? data.usageMetadata.promptTokenCount : null,
      output_tokens: data.usageMetadata ? data.usageMetadata.candidatesTokenCount : null,
    },
  };
}

/* ---------- deterministic cross-check (code compares, never the model) ---- */

const norm = (v) => String(v == null ? '' : v).trim().toUpperCase().replace(/[\s\-_/]+/g, '');
const devKey = (d) => [norm(d.board_ref), norm(d.way), norm(d.phase)].join('|');

/* Compare two extractions of the SAME page. Returns row-level disagreements:
 *   missing_in_primary  — second run saw a device the primary missed (worst case: recall)
 *   missing_in_second   — primary saw a device the second run did not (possible over-capture)
 *   field_mismatch      — both saw the row but disagree on rating/class/poles
 * Never resolves anything — the caller routes these to the human Review queue. */
export function crossCheckExtractions(primary, second) {
  const p = (primary && primary.devices) || [];
  const s = (second && second.devices) || [];
  const skip = (d) => d.device_class === 'space';   // blank ways carry no take-off risk
  const pMap = new Map(p.filter((d) => !skip(d)).map((d) => [devKey(d), d]));
  const sMap = new Map(s.filter((d) => !skip(d)).map((d) => [devKey(d), d]));
  const mismatches = [];

  for (const [key, sd] of sMap) {
    if (!pMap.has(key)) {
      mismatches.push({
        kind: 'missing_in_primary', board: sd.board_ref || '', way: sd.way ?? '', phase: sd.phase || '',
        detail: `Second model found ${sd.device_class || 'a device'}${sd.rating_a ? ' ' + sd.rating_a + 'A' : ''} (“${(sd.description || '').slice(0, 60)}”) that the primary extraction missed`,
        second: { device_class: sd.device_class, rating_a: sd.rating_a, description: sd.description },
      });
    }
  }
  for (const [key, pd] of pMap) {
    const sd = sMap.get(key);
    if (!sd) {
      mismatches.push({
        kind: 'missing_in_second', board: pd.board_ref || '', way: pd.way ?? '', phase: pd.phase || '',
        detail: `Second model did not see ${pd.device_class || 'this device'}${pd.rating_a ? ' ' + pd.rating_a + 'A' : ''} (“${(pd.description || '').slice(0, 60)}”)`,
        primary: { device_class: pd.device_class, rating_a: pd.rating_a, description: pd.description },
      });
      continue;
    }
    const fields = [];
    if (pd.rating_a != null && sd.rating_a != null && Number(pd.rating_a) !== Number(sd.rating_a)) fields.push(['rating_a', pd.rating_a, sd.rating_a]);
    if (pd.device_class && sd.device_class && pd.device_class !== sd.device_class
        && !(new Set(['spare', 'other']).has(pd.device_class) || new Set(['spare', 'other']).has(sd.device_class))) {
      fields.push(['device_class', pd.device_class, sd.device_class]);
    }
    if (pd.poles != null && sd.poles != null && Number(pd.poles) !== Number(sd.poles)) fields.push(['poles', pd.poles, sd.poles]);
    for (const [field, a, b] of fields) {
      mismatches.push({
        kind: 'field_mismatch', board: pd.board_ref || '', way: pd.way ?? '', phase: pd.phase || '',
        field, primary: a, second: b,
        detail: `Models disagree on ${field}: ${a} vs ${b}`,
      });
    }
  }
  return {
    agree: mismatches.length === 0,
    counts: { primary: pMap.size, second: sMap.size },
    mismatches,
  };
}

/* Full page extraction with optional second-opinion verification.
 * Primary is always Gemini (GEMINI_MODEL). When GEMINI_VERIFY_MODEL is set the
 * second run executes in PARALLEL and the deterministic comparator produces
 * `verification` (nullable — null when no verify model is configured).
 * A second-opinion failure NEVER fails the page. */
export async function extractWithVerification({ imageBase64, mediaType, instruction, maxTokens }) {
  const status = providerStatus();
  if (!status.configured) {
    throw Object.assign(new Error('AI extraction is not configured: set GEMINI_API_KEY in the server environment.'), { http: 503 });
  }
  const args = { imageBase64, mediaType, instruction, maxTokens };
  const primaryCall = callGemini({ ...args, model: GEMINI_MODEL });
  const secondCall = status.verify ? callGemini({ ...args, model: GEMINI_VERIFY_MODEL }) : null;

  const primary = await primaryCall;   // primary failure propagates to caller
  let verification = null;
  if (secondCall) {
    try {
      const second = await secondCall;
      const check = crossCheckExtractions(primary.result, second.result);
      verification = { status: 'done', provider: 'gemini', model: second.model, ...check };
    } catch (err) {
      verification = { status: 'error', provider: 'gemini', error: err && err.message ? err.message : String(err) };
    }
  }
  return { ...primary, provider: 'gemini', verification };
}
