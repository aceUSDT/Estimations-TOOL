/* AI extraction — BACKGROUND function (no 30s sync limit).
 *
 * A full extraction of a dense page runs ~30–45s, past Netlify's ~26s
 * synchronous cap. Netlify *background* functions (the `-background` filename
 * suffix) run up to 15 min: the caller gets an immediate 202, the work
 * continues, and the result is written to a Netlify Blobs store keyed by
 * job_id. The client then polls `extract-status?id=<job_id>`.
 *
 * Provider: Google Gemini only (GEMINI_API_KEY; optional GEMINI_VERIFY_MODEL
 * for a deterministic second-opinion cross-check). Keys stay server-side only.
 */
import { getStore } from '@netlify/blobs';
import { buildInstruction, extractWithVerification } from './lib/providers.mjs';

export default async function handler(req) {
  let body = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const jobId = body.job_id;
  const store = getStore('extractions');
  if (!jobId) return new Response(null, { status: 202 });

  try {
    const { filename, page_number: pageNumber, image_base64: imageBase64, media_type: mediaType, text_lines: textLines, hints } = body;
    if (!imageBase64 && !(Array.isArray(textLines) && textLines.length)) {
      await store.setJSON(jobId, { status: 'error', error: 'Provide image_base64 and/or text_lines' });
      return new Response(null, { status: 202 });
    }
    const instruction = buildInstruction({ filename, pageNumber, hints, textLines });
    const out = await extractWithVerification({ imageBase64, mediaType, instruction, maxTokens: 16000 });
    await store.setJSON(jobId, { status: 'done', ...out });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    try { await store.setJSON(jobId, { status: 'error', error: msg }); } catch { /* store unavailable */ }
  }
  return new Response(null, { status: 202 });
}
