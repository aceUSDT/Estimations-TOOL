/* AI extraction — BACKGROUND function (no 30s sync limit).
 *
 * A full extraction of a dense page runs ~30–45s, past Netlify's ~26s
 * synchronous cap. Netlify *background* functions (the `-background` filename
 * suffix) run up to 15 min: the caller gets an immediate 202, the work
 * continues, and the result is written to a Netlify Blobs store keyed by
 * job_id. The client then polls `extract-status?id=<job_id>`.
 *
 * Providers: Claude primary (ANTHROPIC_API_KEY), Gemini free tier as second
 * opinion or primary fallback (GEMINI_API_KEY). Disagreements between the two
 * are computed by deterministic code and routed to the human Review queue.
 * Keys stay server-side only.
 */
import { getStore } from '@netlify/blobs';
import { buildInstruction, extractWithVerification } from './lib/providers.mjs';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default async function handler(req) {
  let body = {};
  try {
    body = await req.json();
  } catch (err) {
    console.error('extract-background: invalid JSON body:', err);
    return json(400, { error: 'Invalid JSON body' });
  }
  const jobId = body.job_id;
  const store = getStore('extractions');
  // Without a job id nothing can be polled, so fail the enqueue instead of
  // leaving the client polling a result that will never be written.
  if (!jobId) return json(400, { error: 'Missing job_id' });

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
    console.error(`extract-background: job ${jobId} failed:`, err);
    try {
      await store.setJSON(jobId, { status: 'error', error: msg });
    } catch (storeErr) {
      // The client can only time out now; log both so the cause is recoverable.
      console.error(`extract-background: could not record failure for job ${jobId}:`, storeErr);
    }
  }
  return new Response(null, { status: 202 });
}
