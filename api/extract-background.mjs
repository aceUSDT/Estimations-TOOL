import { buildInstruction, extractWithVerification } from './_lib/providers.mjs';
import { MAX_BODY_BYTES, isOversized, isSameOrigin, isValidJobId, limitTextLines, safeMediaType } from './_lib/request-guard.mjs';
import { writeResult } from './_lib/results.mjs';

export const maxDuration = 300;

export default async function handler(req) {
  if (!isSameOrigin(req) || isOversized(req)) return new Response(null, { status: 403 });
  let body = {};
  try { body = await req.json(); } catch { return new Response(null, { status: 400 }); }
  const jobId = body.job_id;
  if (!isValidJobId(jobId)) return new Response(null, { status: 400 });

  try {
    const { filename, page_number: pageNumber, image_base64: imageBase64, media_type: mediaType, text_lines: textLines, hints } = body;
    if (!imageBase64 && !(Array.isArray(textLines) && textLines.length)) {
      await writeResult(jobId, { status: 'error', error: 'Provide image_base64 and/or text_lines' });
      return new Response(null, { status: 202 });
    }
    if (typeof imageBase64 === 'string' && imageBase64.length > MAX_BODY_BYTES) {
      await writeResult(jobId, { status: 'error', error: 'Page payload is too large' });
      return new Response(null, { status: 202 });
    }
    const instruction = buildInstruction({ filename, pageNumber, hints, textLines: limitTextLines(textLines) });
    const out = await extractWithVerification({ imageBase64, mediaType: safeMediaType(mediaType), instruction, maxTokens: 16000 });
    await writeResult(jobId, { status: 'done', ...out });
  } catch (err) {
    await writeResult(jobId, { status: 'error', error: err?.message || String(err) }).catch(() => {});
  }
  return new Response(null, { status: 202 });
}
