/* Regression test: the Gemini master-provider runtime.
 * No network, no keys — exercises the Gemini schema translation, provider
 * gating, the health-probe contract, and the instruction builder. Also pins
 * the addendum's core requirement: NO Anthropic SDK, key, or model name in
 * the runtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const LIB = path.resolve(ROOT, 'netlify/functions/lib/providers.mjs');
const FN = path.resolve(ROOT, 'netlify/functions/extract.mjs');

delete process.env.GEMINI_API_KEY;

const providers = await import(pathToFileURL(LIB));
const { geminiSchema, providerStatus, buildInstruction, GEMINI_MODEL, geminiModelCandidates, isGeminiModelUnavailable } = providers;
const { default: handler } = await import(pathToFileURL(FN));

let fail = 0;
const check = (name, cond, detail) => {
  if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; }
};

/* ---------- Gemini remains the only master/provider outside the optional NVIDIA team ---------- */
check('providers module exports no Claude call', !('callClaude' in providers) && !('CLAUDE_MODEL' in providers));
check('deterministic cross-check is available', typeof providers.crossCheckExtractions === 'function');
const disagreement=providers.crossCheckExtractions(
  {devices:[{board_ref:'DB-1',way:1,phase:'L1',device_class:'MCB',rating_a:10}]},
  {devices:[{board_ref:'DB-1',way:1,phase:'L1',device_class:'MCB',rating_a:16}]},
);
check('cross-check exposes disagreements without resolving them', disagreement.agree===false
  && disagreement.mismatches.some(item=>item.kind==='field_mismatch'&&item.primary===10&&item.second===16));
for (const file of ['netlify/functions/lib/providers.mjs', 'netlify/functions/extract.mjs', 'netlify/functions/extract-background.mjs', 'netlify/functions/extract-status.mjs']) {
  const src = fs.readFileSync(path.resolve(ROOT, file), 'utf8');
  check(`${file} has no Anthropic references`, !/anthropic|ANTHROPIC|claude-|CLAUDE_MODEL|EXTRACTION_MODEL/i.test(src));
}
const pkg = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'package.json'), 'utf8'));
check('@anthropic-ai/sdk removed from dependencies', !(pkg.dependencies || {})['@anthropic-ai/sdk']);
check('GEMINI_MODEL is pinned to an exact id, not "latest"', /^gemini-[\w.-]+$/.test(GEMINI_MODEL) && !/latest/i.test(GEMINI_MODEL));
check('all compatibility models are exact ids', geminiModelCandidates().every((model) => /^gemini-[\w.-]+$/.test(model) && !/latest/i.test(model)));
check('model retirement errors permit compatibility fallback', isGeminiModelUnavailable(404, 'no longer available') && isGeminiModelUnavailable(400, 'model is unsupported'));
check('quota and auth failures do not change models', !isGeminiModelUnavailable(429, 'quota') && !isGeminiModelUnavailable(401, 'invalid key'));

/* ---------- geminiSchema translation ---------- */
const translated = geminiSchema({
  $schema: 'x', type: 'object', additionalProperties: false,
  properties: { a: { type: 'string', enum: ['x', 'y'], default: 'x' }, b: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {}, required: [] } } },
  required: ['a', 'b'],
});
const flat = JSON.stringify(translated);
check('geminiSchema strips additionalProperties', !flat.includes('additionalProperties'));
check('geminiSchema strips $schema and default', !flat.includes('$schema') && !flat.includes('default'));
check('geminiSchema keeps enum/required/items', translated.properties.a.enum.length === 2 && translated.required.length === 2 && translated.properties.b.items);

/* ---------- provider gating ---------- */
check('no key → unconfigured', providerStatus().configured === false && providerStatus().primary === null);
check('legacy Vercel Gemini variable remains functional but is diagnosed',
  providerStatus({ Gemini: 'test-not-a-real-key' }).configured === true
  && providerStatus({ Gemini: 'test-not-a-real-key' }).configurationWarning === 'legacy_gemini_variable_name');
let unconfigured = await handler(new Request('http://x/extract', { method: 'GET' }));
let body = await unconfigured.json();
check('health: unconfigured reported honestly', body.configured === false);
const post = await handler(new Request('http://x/extract', { method: 'POST', body: JSON.stringify({ text_lines: ['x'] }) }));
check('POST without key → 503, never a silent success', post.status === 503);

process.env.GEMINI_API_KEY = 'test-not-a-real-key';
const st = providerStatus();
check('gemini key → configured, gemini primary', st.configured && st.primary === 'gemini');
const res = await handler(new Request('http://x/extract', { method: 'GET' }));
body = await res.json();
check('health: gemini configured', body.configured === true && body.primary === 'gemini');
check('health: pinned model reported', typeof body.model === 'string' && body.model.includes('gemini'));
check('health: no anthropic field in probe', !('anthropic' in (body.providers || {})));
delete process.env.GEMINI_API_KEY;

/* ---------- compatibility fallback ---------- */
process.env.GEMINI_API_KEY = 'test-not-a-real-key';
const originalFetch = globalThis.fetch;
const modelCalls = [];
globalThis.fetch = async (url) => {
  modelCalls.push(String(url));
  if (modelCalls.length === 1) return new Response('model no longer available', { status: 404 });
  const result = {
    classification: { type: 'other', sub_format: 'unknown', confidence: '1' },
    boards: [], devices: [], feeds: [], flags: [],
  };
  return new Response(JSON.stringify({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
try {
  const fallback = await providers.callGemini({ instruction: 'test', maxTokens: 100 });
  check('retired primary retries a stable compatibility model', modelCalls.length === 2 && fallback.model === geminiModelCandidates()[1]);
} finally {
  globalThis.fetch = originalFetch;
  delete process.env.GEMINI_API_KEY;
}

/* ---------- instruction builder ---------- */
const instr = buildInstruction({ filename: 'a.pdf', pageNumber: 3, hints: { type: 'db_schedule', sub_format: 'bam_epo' }, textLines: ['ROW 1'] });
check('instruction carries filename/page/hint/lines', instr.includes('a.pdf') && instr.includes('page 3') && instr.includes('bam_epo') && instr.includes('ROW 1'));
const calibratedInstr = buildInstruction({ filename: 'trimble.pdf', pageNumber: 1,
  hints: { type: 'db_schedule', deterministic_primary_board: '01 MAIN LV SWITCHBOARD', calibration_roles: ['board_ref', 'device_class'] },
  layoutHint: { calibration: { regions: [{ role: 'board_ref', bbox: [10, 10, 100, 20] }] } } });
check('instruction preserves source-board ownership and calibration guidance', calibratedInstr.includes('01 MAIN LV SWITCHBOARD')
  && calibratedInstr.includes('downstream circuit_reference') && calibratedInstr.includes('board_ref, device_class'));

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: Gemini master runtime, deterministic cross-check, schema translation, provider gating, health probe.');
