/* AI extraction endpoint — the "AI extracts" half of the architecture.
 *
 * The browser posts one page (rendered image and/or text lines); this function
 * runs the primary extractor (Claude when ANTHROPIC_API_KEY is set, else the
 * Gemini free tier when GEMINI_API_KEY is set) and, when BOTH providers are
 * configured, a second-opinion pass whose disagreements are computed by
 * deterministic code and surfaced for human review — never auto-resolved.
 * Keys live ONLY in Netlify env vars — never in the repo or browser (CLAUDE.md §8).
 *
 * Env vars:
 *   ANTHROPIC_API_KEY   Claude — primary extractor
 *   GEMINI_API_KEY      Gemini free tier (https://aistudio.google.com/apikey) —
 *                       second opinion, or primary fallback if no Anthropic key
 *   EXTRACTION_MODEL    optional Claude model override (default claude-sonnet-5)
 *   GEMINI_MODEL        optional Gemini model override (default gemini-2.5-flash)
 *
 * Note on timeouts: Netlify synchronous functions cap at ~26s; the second
 * opinion runs in PARALLEL with the primary so verification adds no latency
 * beyond max(primary, second). The background function has no such ceiling.
 */
import { buildInstruction, extractWithVerification, providerStatus, CLAUDE_MODEL, GEMINI_MODEL } from './lib/providers.mjs';

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
      providers: { anthropic: status.anthropic, gemini: status.gemini },
      primary: status.primary,
      verify: status.verify,
      model: status.primary === 'gemini' ? GEMINI_MODEL : CLAUDE_MODEL,
    });
  }
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!providerStatus().configured) {
    return json(503, { error: 'AI extraction is not configured: set ANTHROPIC_API_KEY (or GEMINI_API_KEY) in the Netlify environment.' });
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
