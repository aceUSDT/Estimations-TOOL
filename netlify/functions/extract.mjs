/* AI extraction endpoint — the "AI extracts" half of the architecture.
 *
 * The browser posts one page (rendered image and/or text lines) — only after
 * explicit user opt-in — and this function runs the Gemini extractor. Gemini
 * is the ONLY hosted AI provider. When GEMINI_VERIFY_MODEL is configured, a
 * second Gemini pass runs and the disagreements are computed by deterministic
 * code and surfaced for human review — never auto-resolved.
 * Keys live ONLY in server env vars — never in the repo or browser.
 *
 * Env vars:
 *   GEMINI_API_KEY        required — https://aistudio.google.com/apikey
 *   GEMINI_MODEL          optional exact-model override (pinned default)
 *   GEMINI_VERIFY_MODEL   optional second Gemini verification model
 *
 * Note on timeouts: synchronous serverless functions have a short ceiling
 * (~26s on Netlify); dense pages go through the background/async path.
 */
import { buildInstruction, extractWithVerification, providerStatus, GEMINI_MODEL, GEMINI_VERIFY_MODEL } from './lib/providers.mjs';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

export default async function handler(req) {
  if (req.method === 'GET') {
    // health probe used by the front-end to decide whether AI extraction is on
    const status = providerStatus();
    return json(200, {
      status: 'ok',
      configured: status.configured,
      providers: { gemini: status.gemini },
      primary: status.primary,
      verify: status.verify,
      model: GEMINI_MODEL,
      verify_model: status.verify ? GEMINI_VERIFY_MODEL : null,
    });
  }
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!providerStatus().configured) {
    return json(503, { error: 'AI extraction is not configured: set GEMINI_API_KEY in the server environment.' });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }
  const { filename, page_number: pageNumber, image_base64: imageBase64, media_type: mediaType, text_lines: textLines, hints } = body || {};
  if (!imageBase64 && !(Array.isArray(textLines) && textLines.length)) {
    return json(400, { error: 'Provide image_base64 and/or text_lines' });
  }

  const instruction = buildInstruction({ filename, pageNumber, hints, textLines });
  try {
    const out = await extractWithVerification({ imageBase64, mediaType, instruction, maxTokens: 12000 });
    return json(200, out);
  } catch (err) {
    if (err && err.http) return json(err.http, { error: err.message });
    const msg = err && err.message ? err.message : String(err);
    if (err && err.status === 429) return json(429, { error: 'Rate limited — retry shortly' });
    if (err && err.status === 401) return json(503, { error: 'API key is invalid — rotate it in the Netlify environment' });
    return json(502, { error: `Extraction failed: ${msg}` });
  }
}
