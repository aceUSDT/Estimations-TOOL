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
const comparisonFields = ['rating_a', 'device_class', 'poles', 'trip_curve', 'breaking_capacity_ka',
  'rcd_protected', 'rcd_ma', 'rcd_arrangement', 'afdd', 'is_incomer', 'is_spare', 'is_spd',
  'protection_standard', 'trip_unit', 'earth_fault_device', 'arc_flash_device'];
const numericFields = new Set(['rating_a', 'poles', 'breaking_capacity_ka', 'rcd_ma']);
const booleanFields = new Set(['rcd_protected', 'afdd', 'is_incomer', 'is_spare', 'is_spd']);
const absent = (value) => value == null || value === '';
const comparable = (field, value) => absent(value) ? ''
  : numericFields.has(field) ? String(Number(value)) : String(value).trim().toUpperCase();
const electricalSignature = (device) => JSON.stringify(comparisonFields.map(field => comparable(field, device[field])));
const sourceIdentity = (device) => ({ board: device.board_ref || '', way: device.way ?? '', phase: device.phase || '' });
const deviceSummary = (device) => ({ device_class: device.device_class, rating_a: device.rating_a, description: device.description });

function invalidDeviceField(device) {
  if (!device || typeof device !== 'object' || Array.isArray(device)) return 'row';
  if (typeof device.board_ref !== 'string' || !device.board_ref.trim()) return 'board_ref';
  if (typeof device.device_class !== 'string' || !device.device_class.trim()) return 'device_class';
  if (!absent(device.way) && !(typeof device.way === 'string'
    || (typeof device.way === 'number' && Number.isFinite(device.way)))) return 'way';
  if (!absent(device.phase) && typeof device.phase !== 'string') return 'phase';
  for (const field of comparisonFields) {
    const value = device[field];
    if (absent(value)) continue;
    if (numericFields.has(field)) {
      if (!['string', 'number'].includes(typeof value) || !/^\d+(?:\.\d+)?$/.test(String(value).trim())
        || !Number.isFinite(Number(value)) || Number(value) <= 0
        || (field === 'poles' && !Number.isInteger(Number(value)))) return field;
    } else if (booleanFields.has(field)) {
      if (typeof value !== 'boolean') return field;
    } else if (typeof value !== 'string') return field;
  }
  return null;
}

function comparisonGroups(extraction, side, mismatches) {
  const groups = new Map();
  let count = 0;
  if (!Array.isArray(extraction?.devices)) {
    mismatches.push({ kind: 'invalid_extraction', side, board: '', way: '', phase: '',
      detail: `${side} extraction has no valid device list; independent comparison requires review` });
    return { groups, count };
  }
  for (const device of extraction.devices) {
    if (device?.device_class === 'space') continue;
    count++;
    const field = invalidDeviceField(device);
    if (field) {
      // Never echo malformed objects or silently discard a purported occurrence.
      mismatches.push({ kind: 'invalid_device', side, field, board: typeof device?.board_ref === 'string' ? device.board_ref : '',
        way: ['string', 'number'].includes(typeof device?.way) ? device.way : '',
        phase: typeof device?.phase === 'string' ? device.phase : '',
        detail: `${side} extraction contains an invalid ${field}; independent comparison requires review` });
      continue;
    }
    const key = deviceKey(device);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(device);
  }
  return { groups, count };
}

function sortedOccurrences(rows = []) {
  // Sort a copy. The electrical signature governs matching; the remaining
  // source fields make the reported extra occurrence stable under reordering.
  const sortKey = device => JSON.stringify([electricalSignature(device), device.board_ref, device.way, device.phase,
    comparisonFields.map(field => device[field]), device.description]);
  return rows.map(device => ({ device, key: sortKey(device) }))
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(item => item.device);
}

export function crossCheckExtractions(primary, second) {
  const mismatches = [];
  const a = comparisonGroups(primary, 'primary', mismatches);
  const b = comparisonGroups(second, 'second', mismatches);
  for (const key of [...new Set([...a.groups.keys(), ...b.groups.keys()])].sort()) {
    const remainingPrimary = [];
    const remainingSecond = sortedOccurrences(b.groups.get(key));
    // Match identical occurrences first. A later duplicate must not overwrite
    // an earlier one, and provider row order cannot create a disagreement.
    for (const device of sortedOccurrences(a.groups.get(key))) {
      const signature = electricalSignature(device);
      const match = remainingSecond.findIndex(other => electricalSignature(other) === signature);
      if (match === -1) remainingPrimary.push(device);
      else remainingSecond.splice(match, 1);
    }
    const paired = Math.min(remainingPrimary.length, remainingSecond.length);
    for (let index = 0; index < paired; index++) {
      const device = remainingPrimary[index], other = remainingSecond[index];
      for (const field of comparisonFields) {
        if (comparable(field, device[field]) !== comparable(field, other[field])) {
          mismatches.push({ kind: 'field_mismatch', ...sourceIdentity(device), field,
            primary: device[field] ?? null, second: other[field] ?? null,
            detail: `Agents disagree on ${field}: ${absent(device[field]) ? 'unknown' : device[field]} vs ${absent(other[field]) ? 'unknown' : other[field]}` });
        }
      }
    }
    for (const device of remainingSecond.slice(paired)) mismatches.push({
      kind: 'missing_in_primary', ...sourceIdentity(device),
      detail: `Second agent found ${device.device_class}${device.rating_a ? ` ${device.rating_a}A` : ''} that the primary extraction missed`,
      second: deviceSummary(device),
    });
    for (const device of remainingPrimary.slice(paired)) mismatches.push({
      kind: 'missing_in_second', ...sourceIdentity(device),
      detail: 'Second agent did not corroborate this device occurrence', primary: deviceSummary(device),
    });
  }
  return { agree: mismatches.length === 0, counts: { primary: a.count, second: b.count }, mismatches };
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
