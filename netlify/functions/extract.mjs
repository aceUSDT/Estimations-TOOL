/* Hosted extraction endpoint — the "AI extracts" half of the architecture.
 *
 * The browser posts one page (rendered image and/or text lines) — only after
 * the user has explicitly enabled online extraction. The engine selects the
 * independent NVIDIA team with Gemini master audit when those server-side keys
 * exist, otherwise it falls back honestly to direct Gemini extraction.
 *
 * Env vars:
 *   GEMINI_API_KEY   Gemini extractor/master auditor
 *   GEMINI_MODEL     optional exact-model override (pinned default in providers)
 *   NVIDIA_API_KEY_1..7 optional independent sub-agents
 *   AGENT_TEAM       set to off to force direct Gemini extraction
 *
 * Note on timeouts: Netlify synchronous functions cap at ~26s; dense pages
 * go through the background function instead (no such ceiling).
 */
import { buildInstruction, GEMINI_MODEL, geminiModelCandidates } from './lib/providers.mjs';
import { engineStatus, extractSmart } from './lib/extraction-engine.mjs';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

export default async function handler(req) {
  if (req.method === 'GET') {
    // health probe used by the front-end to decide whether AI extraction is on
    const status = engineStatus();
    const vercelBackgroundReady = Boolean(
      process.env.EXTRACTION_BLOB_READ_WRITE_TOKEN
      || process.env.BLOB_READ_WRITE_TOKEN
      || ((process.env.EXTRACTION_BLOB_STORE_ID || process.env.BLOB_STORE_ID) && process.env.VERCEL_OIDC_TOKEN)
    );
    return json(200, {
      status: 'ok',
      configured: status.configured,
      mode: status.mode,
      providers: { gemini: status.gemini, nvidia: status.nvidia },
      providerDiagnostics: {
        geminiConfigurationWarning: status.geminiConfigurationWarning,
        nvidiaKeyCount: status.nvidiaKeyCount,
        nvidiaKeySlots: status.nvidiaKeySlots,
      },
      primary: status.primary,
      model: GEMINI_MODEL,
      fallbackModels: geminiModelCandidates().slice(1),
      executionMode: process.env.VERCEL && !vercelBackgroundReady ? 'sync' : 'background',
      backgroundConfigured: process.env.VERCEL ? vercelBackgroundReady : true,
    });
  }
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!engineStatus().configured) {
    return json(503, { error: 'AI extraction is not configured: set GEMINI_API_KEY or NVIDIA_API_KEY_1..7 in the hosting environment.' });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }
  const { filename, page_number: pageNumber, image_base64: imageBase64, media_type: mediaType, text_lines: textLines,
    layout_hint: layoutHint, hints } = body || {};
  if (!imageBase64 && !(Array.isArray(textLines) && textLines.length)) {
    return json(400, { error: 'Provide image_base64 and/or text_lines' });
  }

  const instruction = buildInstruction({ filename, pageNumber, hints, textLines, layoutHint });
  try {
    const out = await extractSmart({ imageBase64, mediaType, instruction, maxTokens: 12000,
      textLines, filename, pageNumber, hints, layoutHint });
    return json(200, out);
  } catch (err) {
    if (err && err.http) return json(err.http, { error: err.message });
    const msg = err && err.message ? err.message : String(err);
    if (err && err.status === 429) return json(429, { error: 'Rate limited — retry shortly' });
    if (err && err.status === 401) return json(503, { error: 'API key is invalid — rotate it in the hosting environment' });
    return json(502, { error: `Extraction failed: ${msg}` });
  }
}

export const config = { path: '/api/extract' };
