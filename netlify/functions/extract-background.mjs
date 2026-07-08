/* AI extraction — BACKGROUND function (no 30s sync limit).
 *
 * A full extraction of a dense page runs ~30–45s, past Netlify's ~26s
 * synchronous cap. Netlify *background* functions (the `-background` filename
 * suffix) run up to 15 min: the caller gets an immediate 202, the work
 * continues, and the result is written to a Netlify Blobs store keyed by
 * job_id. The client then polls `extract-status?id=<job_id>`.
 *
 * The Anthropic key stays server-side only (ANTHROPIC_API_KEY). Model defaults
 * to claude-sonnet-5 (override with EXTRACTION_MODEL, e.g. claude-opus-4-8 for
 * maximum recall — background functions have no latency ceiling).
 */
import { getStore } from '@netlify/blobs';
import Anthropic from '@anthropic-ai/sdk';
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_SCHEMA, coerceResult } from './lib/domain-pack.mjs';

const MODEL = process.env.EXTRACTION_MODEL || 'claude-sonnet-5';

export default async function handler(req) {
  let body = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const jobId = body.job_id;
  const store = getStore('extractions');
  if (!jobId) return new Response(null, { status: 202 });

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      await store.setJSON(jobId, { status: 'error', error: 'AI extraction is not configured (ANTHROPIC_API_KEY unset).' });
      return new Response(null, { status: 202 });
    }
    const { filename, page_number: pageNumber, image_base64: imageBase64, media_type: mediaType, text_lines: textLines, hints } = body;
    if (!imageBase64 && !(Array.isArray(textLines) && textLines.length)) {
      await store.setJSON(jobId, { status: 'error', error: 'Provide image_base64 and/or text_lines' });
      return new Response(null, { status: 202 });
    }

    const content = [];
    if (imageBase64) content.push({ type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } });
    let instruction = `Extract this page into the schema. Document: ${filename || 'unknown'}, page ${pageNumber || '?'}.`;
    if (hints && hints.type) instruction += ` Classifier hint (may be wrong): ${hints.type}${hints.sub_format ? ' / ' + hints.sub_format : ''}.`;
    if (Array.isArray(textLines) && textLines.length) {
      instruction += `\n\nOCR/native text lines from the same page (may contain OCR errors — the image is authoritative where they disagree):\n`
        + textLines.slice(0, 400).map((l) => String(l)).join('\n');
    }
    content.push({ type: 'text', text: instruction });

    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'disabled' },   // pure transcription — thinking only adds latency
      system: [{ type: 'text', text: EXTRACTION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') { await store.setJSON(jobId, { status: 'error', error: 'Model declined the request', stop_reason: 'refusal' }); return new Response(null, { status: 202 }); }
    if (response.stop_reason === 'max_tokens') { await store.setJSON(jobId, { status: 'error', error: 'Extraction output truncated (max_tokens)', stop_reason: 'max_tokens' }); return new Response(null, { status: 202 }); }
    const text = response.content.find((b) => b.type === 'text');
    if (!text) { await store.setJSON(jobId, { status: 'error', error: 'No text block in model response' }); return new Response(null, { status: 202 }); }
    const result = coerceResult(JSON.parse(text.text));
    await store.setJSON(jobId, {
      status: 'done', result, model: response.model,
      usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens, cache_read_input_tokens: response.usage.cache_read_input_tokens },
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    try { await store.setJSON(jobId, { status: 'error', error: msg }); } catch { /* store unavailable */ }
  }
  return new Response(null, { status: 202 });
}
