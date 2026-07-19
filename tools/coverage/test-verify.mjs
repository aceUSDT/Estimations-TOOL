/* Regression test: the Gemini-only extraction runtime with optional
 * second-opinion verification. No network, no keys — exercises the
 * deterministic comparator, the Gemini schema translation, provider gating,
 * and the health-probe contract. The comparison itself must be CODE, never a
 * model (CLAUDE.md: code computes) — these tests pin that behaviour, and pin
 * the migration requirement that NO Anthropic reference remains in the
 * active runtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const LIB = path.resolve(ROOT, 'netlify/functions/lib/providers.mjs');
const FN = path.resolve(ROOT, 'netlify/functions/extract.mjs');

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;
delete process.env.GEMINI_VERIFY_MODEL;

const providers = await import(pathToFileURL(LIB));
const { crossCheckExtractions, geminiSchema, providerStatus, buildInstruction, GEMINI_MODEL } = providers;
const { default: handler } = await import(pathToFileURL(FN));

let fail = 0;
const check = (name, cond, detail) => {
  if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; }
};

/* ---------- Gemini is the ONLY hosted provider (migration gate 6) ---------- */
check('no Claude call or model export remains', !('callClaude' in providers) && !('CLAUDE_MODEL' in providers));
for (const file of ['netlify/functions/lib/providers.mjs', 'netlify/functions/extract.mjs', 'netlify/functions/extract-background.mjs', 'netlify/functions/extract-status.mjs']) {
  const src = fs.readFileSync(path.resolve(ROOT, file), 'utf8');
  check(`${file} has no Anthropic references`, !/anthropic|ANTHROPIC|claude-|CLAUDE_MODEL|EXTRACTION_MODEL/i.test(src));
}
const pkg = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'package.json'), 'utf8'));
check('@anthropic-ai/sdk removed from dependencies', !(pkg.dependencies || {})['@anthropic-ai/sdk']);
check('GEMINI_MODEL pinned to an exact id, not "latest"', /^gemini-[\w.-]+$/.test(GEMINI_MODEL) && !/latest/i.test(GEMINI_MODEL));

/* ---------- crossCheckExtractions (preserved functionality) ---------- */
const dev = (over = {}) => ({
  board_ref: 'DB-01', way: '1', phase: 'L1', description: 'Lighting', device_class: 'MCB',
  rating_a: 10, poles: 1, confidence: 0.9, ...over,
});

let r = crossCheckExtractions({ devices: [dev()] }, { devices: [dev()] });
check('identical extractions agree', r.agree && r.mismatches.length === 0);

r = crossCheckExtractions({ devices: [dev()] }, { devices: [dev(), dev({ way: '2', description: 'Sockets', rating_a: 32 })] });
check('extra device in second → missing_in_primary', r.mismatches.length === 1 && r.mismatches[0].kind === 'missing_in_primary');
check('missing_in_primary carries the device spec', r.mismatches[0].second && r.mismatches[0].second.rating_a === 32);

r = crossCheckExtractions({ devices: [dev(), dev({ way: '3' })] }, { devices: [dev()] });
check('extra device in primary → missing_in_second', r.mismatches.length === 1 && r.mismatches[0].kind === 'missing_in_second');

r = crossCheckExtractions({ devices: [dev({ rating_a: 32 })] }, { devices: [dev({ rating_a: 40 })] });
check('rating disagreement flagged', r.mismatches.length === 1 && r.mismatches[0].kind === 'field_mismatch' && r.mismatches[0].field === 'rating_a');

r = crossCheckExtractions({ devices: [dev({ device_class: 'MCB' })] }, { devices: [dev({ device_class: 'RCBO' })] });
check('class disagreement flagged', r.mismatches.some((m) => m.field === 'device_class'));
r = crossCheckExtractions({ devices: [dev({ device_class: 'spare' })] }, { devices: [dev({ device_class: 'MCB' })] });
check('spare-vs-class not flagged', r.mismatches.length === 0);

r = crossCheckExtractions({ devices: [] }, { devices: [dev({ device_class: 'space' })] });
check('space rows ignored', r.agree);

r = crossCheckExtractions({ devices: [dev({ board_ref: 'DB-01', way: 1 })] }, { devices: [dev({ board_ref: 'db 01', way: '1' })] });
check('normalised board/way match', r.agree, JSON.stringify(r.mismatches));

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

/* ---------- provider gating: Gemini-only, verify via GEMINI_VERIFY_MODEL ---------- */
check('no key → unconfigured', providerStatus().configured === false && providerStatus().primary === null);
process.env.GEMINI_API_KEY = 'test-not-a-real-key';
let st = providerStatus();
check('gemini key → gemini primary, verify off without verify model', st.configured && st.primary === 'gemini' && st.verify === false);
// GEMINI_VERIFY_MODEL is captured at module load; assert the derivation via a
// fresh module instance with the env var set.
process.env.GEMINI_VERIFY_MODEL = 'gemini-2.5-pro';
const providers2 = await import(pathToFileURL(LIB) + '?verify=1');
st = providers2.providerStatus();
check('verify model set → verify on, still gemini-only', st.primary === 'gemini' && st.verify === true && !('anthropic' in st));
delete process.env.GEMINI_VERIFY_MODEL;

/* ---------- health probe: Gemini-only contract (nullable verification) ---------- */
const res = await handler(new Request('http://x/extract', { method: 'GET' }));
const body = await res.json();
check('health: gemini configured', body.configured === true && body.primary === 'gemini');
check('health: pinned model reported', typeof body.model === 'string' && body.model.includes('gemini'));
check('health: no anthropic provider field', !('anthropic' in (body.providers || {})));
check('health: verify_model nullable when verify off', body.verify === false && body.verify_model === null);
delete process.env.GEMINI_API_KEY;

/* ---------- instruction builder ---------- */
const instr = buildInstruction({ filename: 'a.pdf', pageNumber: 3, hints: { type: 'db_schedule', sub_format: 'bam_epo' }, textLines: ['ROW 1'] });
check('instruction carries filename/page/hint/lines', instr.includes('a.pdf') && instr.includes('page 3') && instr.includes('bam_epo') && instr.includes('ROW 1'));

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: Gemini-only runtime, cross-check comparator, schema translation, health probe.');
