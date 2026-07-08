/* AI extraction endpoint — the "AI extracts" half of the architecture.
 *
 * The browser posts one page (rendered image and/or text lines); this function
 * calls Claude with the domain pack + a structured-output schema and returns
 * the canonical extraction JSON. The API key lives ONLY in the Netlify
 * environment variable ANTHROPIC_API_KEY (Site configuration → Environment
 * variables) — never in the repo, never in the browser bundle (CLAUDE.md §8).
 *
 * Env vars:
 *   ANTHROPIC_API_KEY   required for extraction (GET /health reports state)
 *   EXTRACTION_MODEL    optional override, default claude-sonnet-5
 *
 * Note on timeouts: Netlify synchronous functions cap at ~26s. A full Opus
 * extraction of a dense page image exceeds that (measured ~30s → 502), so the
 * default is claude-sonnet-5 — near-Opus quality on this structured-extraction
 * task at roughly half the latency, which fits the sync budget. For maximum
 * recall on the hardest sheets without a latency ceiling, move this to a
 * background function + polling and set EXTRACTION_MODEL=claude-opus-4-8.
 * One page per request keeps latency bounded.
 */
import Anthropic from '@anthropic-ai/sdk';
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_SCHEMA, coerceResult } from './lib/domain-pack.mjs';

const MODEL = process.env.EXTRACTION_MODEL || 'claude-sonnet-5';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

export default async function handler(req) {
  if (req.method === 'GET') {
    // health probe used by the front-end to decide whether AI extraction is on
    return json(200, { status: 'ok', configured: Boolean(process.env.ANTHROPIC_API_KEY), model: MODEL });
  }
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(503, { error: 'AI extraction is not configured: set ANTHROPIC_API_KEY in the Netlify environment.' });
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

  const content = [];
  if (imageBase64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 },
    });
  }
  let instruction = `Extract this page into the schema. Document: ${filename || 'unknown'}, page ${pageNumber || '?'}.`;
  if (hints && hints.type) instruction += ` Classifier hint (may be wrong): ${hints.type}${hints.sub_format ? ' / ' + hints.sub_format : ''}.`;
  if (Array.isArray(textLines) && textLines.length) {
    instruction += `\n\nOCR/native text lines from the same page (may contain OCR errors — the image is authoritative where they disagree):\n`
      + textLines.slice(0, 400).map((l) => String(l)).join('\n');
  }
  content.push({ type: 'text', text: instruction });

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 12000,
      // Structured extraction, not reasoning — disable thinking. Sonnet 5 runs
      // adaptive thinking by DEFAULT when this is omitted, which pushed the call
      // past Netlify's ~30s sync limit (measured 30s → 502). Disabling it drops
      // latency to well within budget with no loss on this transcription task.
      thinking: { type: 'disabled' },
      system: [{ type: 'text', text: EXTRACTION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') {
      return json(502, { error: 'Model declined the request', stop_reason: 'refusal' });
    }
    if (response.stop_reason === 'max_tokens') {
      return json(502, { error: 'Extraction output truncated (max_tokens) — page too dense for one call', stop_reason: 'max_tokens' });
    }
    const text = response.content.find((b) => b.type === 'text');
    if (!text) return json(502, { error: 'No text block in model response' });
    const result = coerceResult(JSON.parse(text.text));
    return json(200, {
      result,
      model: response.model,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens,
      },
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json(429, { error: 'Rate limited — retry shortly' });
    if (err instanceof Anthropic.AuthenticationError) return json(503, { error: 'ANTHROPIC_API_KEY is invalid — rotate it in the Netlify environment' });
    if (err instanceof Anthropic.APIError) return json(502, { error: `Claude API error ${err.status}: ${err.message}` });
    return json(502, { error: `Extraction failed: ${err && err.message ? err.message : String(err)}` });
  }
}
