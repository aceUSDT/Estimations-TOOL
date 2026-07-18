/* AI extraction provider — Google Gemini is the ONLY runtime AI provider.
 * The key lives ONLY in a Netlify env var — never in the browser, never in
 * this repo.
 *
 *   GEMINI_API_KEY      required — https://aistudio.google.com/apikey
 *   GEMINI_MODEL        optional exact-model override (default pinned below)
 *
 * The model only reads and structures pages ("AI extracts, code computes"):
 * counting, aggregation and pricing stay deterministic in the app.
 */
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_SCHEMA, coerceResult } from './domain-pack.mjs';

/* Pinned to an exact stable model id — never a "latest" alias, so extraction
 * behaviour only changes when the owner deliberately changes this value. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export function providerStatus() {
  const gemini = Boolean(process.env.GEMINI_API_KEY);
  return { gemini, configured: gemini, primary: gemini ? 'gemini' : null };
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

export async function callGemini({ imageBase64, mediaType, instruction, maxTokens = 16000 }) {
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
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
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
    model: GEMINI_MODEL,
    usage: {
      input_tokens: data.usageMetadata ? data.usageMetadata.promptTokenCount : null,
      output_tokens: data.usageMetadata ? data.usageMetadata.candidatesTokenCount : null,
    },
  };
}

/* Full-page extraction. Fails with 503 semantics when unconfigured so the
 * front-end can fall back to local-only extraction cleanly. */
export async function extractPage({ imageBase64, mediaType, instruction, maxTokens }) {
  if (!providerStatus().configured) {
    throw Object.assign(new Error('AI extraction is not configured: set GEMINI_API_KEY in the Netlify environment.'), { http: 503 });
  }
  const primary = await callGemini({ imageBase64, mediaType, instruction, maxTokens });
  return { ...primary, provider: 'gemini' };
}
