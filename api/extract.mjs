import { buildInstruction, extractWithVerification, providerStatus, CLAUDE_MODEL, GEMINI_MODEL } from './_lib/providers.mjs';
import { MAX_BODY_BYTES, isOversized, isSameOrigin, limitTextLines, safeMediaType } from './_lib/request-guard.mjs';

export const maxDuration = 60;
const json = (status, body) => Response.json(body, { status });

export default async function handler(req) {
  if (req.method === 'GET') {
    const status = providerStatus();
    return json(200, { status: 'ok', configured: status.configured, providers: { anthropic: status.anthropic, gemini: status.gemini }, primary: status.primary, verify: status.verify, model: status.primary === 'gemini' ? GEMINI_MODEL : CLAUDE_MODEL });
  }
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!isSameOrigin(req)) return json(403, { error: 'Cross-origin requests are not accepted' });
  if (isOversized(req)) return json(413, { error: `Payload exceeds ${MAX_BODY_BYTES} bytes` });
  if (!providerStatus().configured) return json(503, { error: 'AI extraction is not configured: set ANTHROPIC_API_KEY or GEMINI_API_KEY in Vercel.' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON body' }); }
  const { filename, page_number: pageNumber, image_base64: imageBase64, media_type: mediaType, text_lines: textLines, hints } = body || {};
  if (!imageBase64 && !(Array.isArray(textLines) && textLines.length)) return json(400, { error: 'Provide image_base64 and/or text_lines' });
  if (typeof imageBase64 === 'string' && imageBase64.length > MAX_BODY_BYTES) return json(413, { error: `Payload exceeds ${MAX_BODY_BYTES} bytes` });

  try {
    const instruction = buildInstruction({ filename, pageNumber, hints, textLines: limitTextLines(textLines) });
    return json(200, await extractWithVerification({ imageBase64, mediaType: safeMediaType(mediaType), instruction, maxTokens: 12000 }));
  } catch (err) {
    if (err?.http) return json(err.http, { error: err.message });
    if (err?.status === 429) return json(429, { error: 'Rate limited — retry shortly' });
    if (err?.status === 401) return json(503, { error: 'API key is invalid — rotate it in Vercel.' });
    return json(502, { error: `Extraction failed: ${err?.message || String(err)}` });
  }
}
