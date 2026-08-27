/* Hosted Gemini extraction and master-audit provider. NVIDIA sub-agents live
 * behind extraction-engine.mjs; every key remains server-side and never enters
 * the browser or repository.
 *
 *   GEMINI_API_KEY      required — https://aistudio.google.com/apikey
 *   GEMINI_MODEL        optional exact-model override (default pinned below)
 *
 * The model only reads and structures pages ("AI extracts, code computes"):
 * counting, aggregation and pricing stay deterministic in the app.
 */
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_SCHEMA, coerceResult } from './domain-pack.mjs';

/* Pin production to stable model ids. The short compatibility list is tried
 * only when Google reports that the configured model is unavailable, keeping
 * extraction online across staged model retirements without using a moving
 * "latest" alias. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
export const GEMINI_FALLBACK_MODELS = Object.freeze(['gemini-3.5-flash']);

export function geminiApiKey(env = process.env) {
  return env.GEMINI_API_KEY || env.Gemini || null;
}

export function geminiModelCandidates() {
  return [...new Set([GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS])];
}

export function isGeminiModelUnavailable(status, detail = '') {
  return status === 404 || (status === 400 && /model[^\n]*(?:unavailable|not found|no longer available|unsupported)/i.test(detail));
}

export function providerStatus(env = process.env) {
  const gemini = Boolean(geminiApiKey(env));
  return {
    gemini,
    configured: gemini,
    primary: gemini ? 'gemini' : null,
    configurationWarning: !env.GEMINI_API_KEY && env.Gemini ? 'legacy_gemini_variable_name' : null,
  };
}

export function buildInstruction({ filename, pageNumber, hints, textLines, layoutHint }) {
  let instruction = `Extract this page into the schema. Document: ${filename || 'unknown'}, page ${pageNumber || '?'}.`;
  if (hints && hints.type) instruction += ` Classifier hint (may be wrong): ${hints.type}${hints.sub_format ? ' / ' + hints.sub_format : ''}.`;
  if (hints?.deterministic_primary_board) {
    instruction += ` The deterministic Board Data/header evidence proves the source board is ${hints.deterministic_primary_board}. Keep Connected To/load references as downstream circuit_reference values; never use them as device board_ref values.`;
  }
  if (Array.isArray(hints?.calibration_roles) && hints.calibration_roles.length) {
    instruction += ` User-calibrated source regions are supplied for these roles: ${hints.calibration_roles.join(', ')}. Use their boxes as layout guidance and verify values against the image.`;
  }
  if (layoutHint && typeof layoutHint === 'object') {
    const compact = JSON.stringify(layoutHint).slice(0, 50000);
    instruction += `\n\nDeterministic spatial pre-pass (candidate table roles and source regions; verify every value against the image and do not count from this hint):\n${compact}`;
  }
  if (Array.isArray(textLines) && textLines.length) {
    instruction += `\n\nOCR/native text lines from the same page (may contain OCR errors — the image is authoritative where they disagree):\n`
      + textLines.slice(0, 400).map((l) => String(l)).join('\n');
  }
  return instruction;
}

/* Gemini's responseJsonSchema accepts a JSON-Schema subset; strip the keywords
 * it rejects. Structure (properties/required/enum/items/type) is preserved so
 * the model fills the exact shape the deterministic pipeline expects. */
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

async function callGeminiModel({ model, imageBase64, mediaType, instruction, maxTokens }) {
  const key = geminiApiKey();
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
    throw Object.assign(new Error(`Gemini API error ${resp.status}: ${detail.slice(0, 300)}`), {
      status: resp.status,
      model,
      modelUnavailable: isGeminiModelUnavailable(resp.status, detail),
    });
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

export async function callGemini({ imageBase64, mediaType, instruction, maxTokens = 16000 }) {
  const candidates = geminiModelCandidates();
  let unavailableError = null;
  for (const model of candidates) {
    try {
      return await callGeminiModel({ model, imageBase64, mediaType, instruction, maxTokens });
    } catch (error) {
      if (!error?.modelUnavailable) throw error;
      unavailableError = error;
    }
  }
  throw unavailableError || new Error('No Gemini extraction model is available');
}

export async function callGeminiJson({ instruction, schema, maxTokens = 4000, model = GEMINI_MODEL,
  imageBase64, mediaType, system }) {
  const key = geminiApiKey();
  if (!key) throw new Error('GEMINI_API_KEY unset');
  const parts = [];
  if (imageBase64) parts.push({ inlineData: { mimeType: mediaType || 'image/jpeg', data: imageBase64 } });
  parts.push({ text: instruction });
  const body = {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
      ...(schema ? { responseJsonSchema: geminiSchema(schema) } : {}),
    },
  };
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw Object.assign(new Error(`Gemini API error ${resp.status}`), { status: resp.status });
  const data = await resp.json();
  const candidate = data.candidates && data.candidates[0];
  if (!candidate?.content?.parts) throw new Error(`Gemini returned no candidate (${candidate?.finishReason || 'no finishReason'})`);
  return { json: JSON.parse(candidate.content.parts.map((part) => part.text || '').join('')), model };
}

const norm = (value) => String(value == null ? '' : value).trim().toUpperCase().replace(/[\s\-_/]+/g, '');
const deviceKey = (device) => [norm(device.board_ref), norm(device.way), norm(device.phase)].join('|');

export function crossCheckExtractions(primary, second) {
  const primaryRows = (primary?.devices || []).filter((device) => device.device_class !== 'space');
  const secondRows = (second?.devices || []).filter((device) => device.device_class !== 'space');
  const primaryMap = new Map(primaryRows.map((device) => [deviceKey(device), device]));
  const secondMap = new Map(secondRows.map((device) => [deviceKey(device), device]));
  const mismatches = [];
  for (const [key, device] of secondMap) {
    if (!primaryMap.has(key)) mismatches.push({
      kind: 'missing_in_primary', board: device.board_ref || '', way: device.way ?? '', phase: device.phase || '',
      detail: `Second agent found ${device.device_class || 'a device'}${device.rating_a ? ` ${device.rating_a}A` : ''} that the primary extraction missed`,
      second: { device_class: device.device_class, rating_a: device.rating_a, description: device.description },
    });
  }
  for (const [key, device] of primaryMap) {
    const other = secondMap.get(key);
    if (!other) {
      mismatches.push({ kind: 'missing_in_second', board: device.board_ref || '', way: device.way ?? '', phase: device.phase || '',
        detail: 'Second agent did not corroborate this device' });
      continue;
    }
    for (const field of ['rating_a', 'device_class', 'poles']) {
      if (device[field] != null && other[field] != null && String(device[field]) !== String(other[field])) {
        mismatches.push({ kind: 'field_mismatch', board: device.board_ref || '', way: device.way ?? '', phase: device.phase || '',
          field, primary: device[field], second: other[field], detail: `Agents disagree on ${field}: ${device[field]} vs ${other[field]}` });
      }
    }
  }
  return { agree: mismatches.length === 0, counts: { primary: primaryMap.size, second: secondMap.size }, mismatches };
}

/* Full-page extraction. Fails with 503 semantics when unconfigured so the
 * front-end can fall back to local-only extraction cleanly. */
export async function extractPage({ imageBase64, mediaType, instruction, maxTokens }) {
  if (!providerStatus().configured) {
    throw Object.assign(new Error('AI extraction is not configured: set GEMINI_API_KEY in the hosting environment.'), { http: 503 });
  }
  const primary = await callGemini({ imageBase64, mediaType, instruction, maxTokens });
  return { ...primary, provider: 'gemini' };
}
