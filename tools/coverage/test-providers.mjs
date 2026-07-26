/* Regression test: the provider layer (netlify/functions/lib/providers.mjs).
 *
 * No real API traffic: Claude is pointed at a throwaway localhost server via
 * ANTHROPIC_BASE_URL and Gemini's `fetch` is intercepted, so the request the
 * app would send and the way each response is decoded are both pinned —
 * including the failures that must not be mistaken for an empty page
 * (refusal, truncation, transport errors) and the rule that a second-opinion
 * failure never fails the page.
 */
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '../../netlify/functions/lib/providers.mjs');

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;

let fail = 0;
const check = (name, cond, detail) => {
  if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; }
};
const rejects = async (name, fn, matcher) => {
  try {
    await fn();
    check(name, false, 'did not throw');
    return null;
  } catch (err) {
    check(name, matcher(err), err && err.message);
    return err;
  }
};

const PAGE = {
  classification: { type: 'db_schedule', sub_format: 'bam_epo', confidence: '0.9' },
  boards: [{ ref: 'DB-01', ways_total: '12', fault_ka: '' }],
  devices: [{ board_ref: 'DB-01', way: '1', phase: 'L1', device_class: 'MCB', rating_a: '32', poles: '1', description: 'Sockets' }],
  feeds: [],
  flags: [],
};

/* ---------- Claude, served from localhost ------------------------------- */
let claudeReply = () => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-test-model', stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(PAGE) }],
  usage: { input_tokens: 11, output_tokens: 22, cache_read_input_tokens: 33 },
});
const claudeRequests = [];
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    claudeRequests.push({ url: req.url, body: JSON.parse(raw || '{}') });
    const payload = JSON.stringify(claudeReply());
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(payload);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-real-key';

const { callClaude, callGemini, extractWithVerification, providerStatus, GEMINI_MODEL } = await import(pathToFileURL(LIB));

let out = await callClaude({ imageBase64: 'AAAA', mediaType: 'image/png', instruction: 'Extract page 1', maxTokens: 4096 });
check('claude: result coerced to numbers', out.result.boards[0].ways_total === 12 && out.result.devices[0].rating_a === 32);
check('claude: model and usage reported', out.model === 'claude-test-model' && out.usage.input_tokens === 11 && out.usage.cache_read_input_tokens === 33);
let sent = claudeRequests.at(-1).body;
check('claude: thinking disabled (transcription, not reasoning)', sent.thinking.type === 'disabled');
check('claude: system prompt cached', sent.system[0].cache_control.type === 'ephemeral');
check('claude: structured output schema attached', sent.output_config.format.type === 'json_schema' && Boolean(sent.output_config.format.schema));
check('claude: image sent as base64 block ahead of the instruction',
  sent.messages[0].content[0].source.data === 'AAAA' && sent.messages[0].content[0].source.media_type === 'image/png'
  && sent.messages[0].content[1].text === 'Extract page 1');
check('claude: max_tokens honoured', sent.max_tokens === 4096);

await callClaude({ instruction: 'text only' });
sent = claudeRequests.at(-1).body;
check('claude: text-only page sends no image block', sent.messages[0].content.length === 1 && sent.messages[0].content[0].type === 'text');

claudeReply = () => ({ id: 'm', type: 'message', model: 'claude-test-model', stop_reason: 'refusal', content: [], usage: {} });
await rejects('claude: refusal surfaces as an error', () => callClaude({ instruction: 'x' }), (e) => e.stop_reason === 'refusal');

claudeReply = () => ({ id: 'm', type: 'message', model: 'claude-test-model', stop_reason: 'max_tokens', content: [], usage: {} });
await rejects('claude: truncation is never a partial page', () => callClaude({ instruction: 'x' }), (e) => e.stop_reason === 'max_tokens');

claudeReply = () => ({ id: 'm', type: 'message', model: 'claude-test-model', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }], usage: {} });
await rejects('claude: missing text block errors', () => callClaude({ instruction: 'x' }), (e) => /No text block/.test(e.message));

/* ---------- Gemini, with fetch intercepted ------------------------------ */
const realFetch = globalThis.fetch;
let geminiReply = { ok: true, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(PAGE) }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7 } } };
const geminiRequests = [];
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('generativelanguage.googleapis.com')) return realFetch(url, init);
  geminiRequests.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
  return {
    ok: geminiReply.ok,
    status: geminiReply.status || (geminiReply.ok ? 200 : 500),
    json: async () => geminiReply.body,
    text: async () => JSON.stringify(geminiReply.body),
  };
};

delete process.env.GEMINI_API_KEY;
await rejects('gemini: unset key fails loudly', () => callGemini({ instruction: 'x' }), (e) => /GEMINI_API_KEY unset/.test(e.message));

process.env.GEMINI_API_KEY = 'test-not-a-real-key';
out = await callGemini({ imageBase64: 'BBBB', mediaType: 'image/webp', instruction: 'Extract page 2', maxTokens: 8000 });
check('gemini: result coerced to numbers', out.result.devices[0].way === 1 && out.result.boards[0].fault_ka === null);
check('gemini: usage mapped from usageMetadata', out.model === GEMINI_MODEL && out.usage.input_tokens === 5 && out.usage.output_tokens === 7);
let g = geminiRequests.at(-1);
check('gemini: model in the endpoint, key in the header', g.url.includes(`${GEMINI_MODEL}:generateContent`) && g.headers['x-goog-api-key'] === 'test-not-a-real-key');
check('gemini: deterministic decoding', g.body.generationConfig.temperature === 0 && g.body.generationConfig.maxOutputTokens === 8000);
check('gemini: schema translated for responseJsonSchema', !JSON.stringify(g.body.generationConfig.responseJsonSchema).includes('additionalProperties'));
check('gemini: image sent inline', g.body.contents[0].parts[0].inlineData.mimeType === 'image/webp');

geminiReply = { ok: false, status: 429, body: { error: 'rate limited' } };
await rejects('gemini: transport error carries the status', () => callGemini({ instruction: 'x' }), (e) => /Gemini API error 429/.test(e.message));

geminiReply = { ok: true, body: { candidates: [] } };
await rejects('gemini: no candidate errors', () => callGemini({ instruction: 'x' }), (e) => /no candidate/.test(e.message));

geminiReply = { ok: true, body: { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }] } };
await rejects('gemini: truncation is never a partial page', () => callGemini({ instruction: 'x' }), (e) => e.stop_reason === 'max_tokens');

geminiReply = { ok: true, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(PAGE) }] } }] } };

/* ---------- extractWithVerification -------------------------------------- */
const keys = { ...process.env };
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
const unconfigured = await rejects('verify: no provider → 503', () => extractWithVerification({ instruction: 'x' }), (e) => /not configured/.test(e.message));
check('verify: unconfigured error carries the HTTP status', unconfigured.http === 503);

process.env.GEMINI_API_KEY = keys.GEMINI_API_KEY;
out = await extractWithVerification({ instruction: 'x' });
check('verify: gemini-only runs as primary with no second opinion', out.provider === 'gemini' && out.verification === null && providerStatus().verify === false);

process.env.ANTHROPIC_API_KEY = keys.ANTHROPIC_API_KEY;
claudeReply = () => ({
  id: 'm', type: 'message', model: 'claude-test-model', stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(PAGE) }], usage: { input_tokens: 1, output_tokens: 2 },
});
out = await extractWithVerification({ instruction: 'x' });
check('verify: both keys → claude primary, gemini second opinion', out.provider === 'anthropic' && out.verification.status === 'done' && out.verification.provider === 'gemini');
check('verify: agreeing models produce no review items', out.verification.agree === true && out.verification.counts.primary === 1);

const disagreeing = JSON.parse(JSON.stringify(PAGE));
disagreeing.devices.push({ board_ref: 'DB-01', way: '2', phase: 'L2', device_class: 'RCBO', rating_a: '16' });
geminiReply = { ok: true, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(disagreeing) }] } }] } };
out = await extractWithVerification({ instruction: 'x' });
check('verify: a device only the second model saw is routed to review',
  out.verification.agree === false && out.verification.mismatches[0].kind === 'missing_in_primary');
check('verify: the primary result is still returned in full', out.result.devices.length === 1);

geminiReply = { ok: false, status: 500, body: { error: 'boom' } };
out = await extractWithVerification({ instruction: 'x' });
check('verify: second-opinion failure never fails the page',
  out.result.devices.length === 1 && out.verification.status === 'error' && /Gemini API error 500/.test(out.verification.error));

globalThis.fetch = realFetch;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.ANTHROPIC_BASE_URL;
server.close();

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: Claude/Gemini request shape, response decoding, and second-opinion fallback.');
