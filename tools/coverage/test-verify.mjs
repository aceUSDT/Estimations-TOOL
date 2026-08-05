/* Regression test: the Gemini-only extraction runtime.
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
const { geminiSchema, providerStatus, buildInstruction, GEMINI_MODEL } = providers;
const { default: handler } = await import(pathToFileURL(FN));

let fail = 0;
const check = (name, cond, detail) => {
  if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; }
};

/* ---------- Gemini is the ONLY runtime provider ---------- */
check('providers module exports no Claude call', !('callClaude' in providers) && !('CLAUDE_MODEL' in providers));
check('no cross-check machinery in runtime', !('crossCheckExtractions' in providers) && !('extractWithVerification' in providers));
for (const file of ['netlify/functions/lib/providers.mjs', 'netlify/functions/extract.mjs', 'netlify/functions/extract-background.mjs', 'netlify/functions/extract-status.mjs']) {
  const src = fs.readFileSync(path.resolve(ROOT, file), 'utf8');
  check(`${file} has no Anthropic references`, !/anthropic|ANTHROPIC|claude-|CLAUDE_MODEL|EXTRACTION_MODEL/i.test(src));
}
const pkg = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'package.json'), 'utf8'));
check('@anthropic-ai/sdk removed from dependencies', !(pkg.dependencies || {})['@anthropic-ai/sdk']);
check('GEMINI_MODEL is pinned to an exact id, not "latest"', /^gemini-[\w.-]+$/.test(GEMINI_MODEL) && !/latest/i.test(GEMINI_MODEL));

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

/* ---------- instruction builder ---------- */
const instr = buildInstruction({ filename: 'a.pdf', pageNumber: 3, hints: { type: 'db_schedule', sub_format: 'bam_epo' }, textLines: ['ROW 1'] });
check('instruction carries filename/page/hint/lines', instr.includes('a.pdf') && instr.includes('page 3') && instr.includes('bam_epo') && instr.includes('ROW 1'));

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: Gemini-only runtime, schema translation, provider gating, health probe.');
