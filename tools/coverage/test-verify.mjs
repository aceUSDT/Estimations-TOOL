/* Regression test: the Gemini master-provider runtime.
 * No network, no keys — exercises the Gemini schema translation, provider
 * gating, the health-probe contract, and the instruction builder. Also pins
 * the addendum's core requirement: NO Anthropic SDK, key, or model name in
 * the runtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
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

/* Every occurrence matters, even when board/way/phase repeat. These synthetic
 * comparisons are offline; agreement never certifies extraction completeness. */
const device = (fields = {}) => ({ board_ref: 'DB-1', way: 1, phase: 'L1', device_class: 'MCB', rating_a: 32, ...fields });
const compare = (primary, second) => providers.crossCheckExtractions({ devices: primary }, { devices: second });
let crossCheckCases = 0;
const crossCheckCase = (name, run) => {
  crossCheckCases++;
  try { run(); } catch (error) { check(`cross-check: ${name}`, false, error.message); }
};
crossCheckCase('unique rows agree regardless of order and numeric representation', () => {
  assert.deepEqual(compare([device(), device({ way: 2, rating_a: 10 })],
    [device({ way: '2', rating_a: '10' }), device({ rating_a: '32' })]),
  { agree: true, counts: { primary: 2, second: 2 }, mismatches: [] });
});
crossCheckCase('identical duplicate occurrences are counted', () => {
  assert.deepEqual(compare([device(), device()], [device(), device()]),
    { agree: true, counts: { primary: 2, second: 2 }, mismatches: [] });
});
crossCheckCase('different duplicate occurrences match independent of order', () => {
  assert.equal(compare([device({ rating_a: 20 }), device()], [device(), device({ rating_a: 20 })]).agree, true);
});
crossCheckCase('extra primary occurrence is never lost behind the last Map entry', () => {
  const result = compare([device({ rating_a: 20 }), device()], [device()]);
  assert.equal(result.agree, false);
  assert.deepEqual(result.counts, { primary: 2, second: 1 });
  assert.deepEqual(result.mismatches.map(item => item.kind), ['missing_in_second']);
  assert.equal(result.mismatches[0].primary.rating_a, 20);
});
crossCheckCase('every extra second occurrence is retained', () => {
  const result = compare([device()], [device(), device({ rating_a: 20 }), device({ rating_a: 20 })]);
  assert.equal(result.agree, false);
  assert.deepEqual(result.counts, { primary: 1, second: 3 });
  assert.equal(result.mismatches.length, 2);
  assert.ok(result.mismatches.every(item => item.kind === 'missing_in_primary' && item.second.rating_a === 20));
});
crossCheckCase('equal counts cannot conceal a duplicate electrical conflict', () => {
  const result = compare([device({ rating_a: 20 }), device()], [device({ rating_a: 25 }), device()]);
  assert.equal(result.agree, false);
  assert.deepEqual(result.counts, { primary: 2, second: 2 });
  assert.equal(result.mismatches.length, 1);
  assert.equal(result.mismatches[0].field, 'rating_a');
  assert.equal(result.mismatches[0].primary, 20);
  assert.equal(result.mismatches[0].second, 25);
});
crossCheckCase('disagreement output is stable under row reordering', () => {
  const first = [device({ rating_a: 20 }), device(), device({ way: 3 })];
  const second = [device({ rating_a: 25 }), device(), device({ way: 2 })];
  assert.deepEqual(compare(first, second), compare([...first].reverse(), [...second].reverse()));
});
crossCheckCase('material protection fields must be corroborated', () => {
  const conflicts = {
    device_class: ['MCB', 'RCBO'], poles: [1, 3], trip_curve: ['B', 'C'],
    breaking_capacity_ka: [6, 10], rcd_protected: [false, true], rcd_ma: [30, 100],
    rcd_arrangement: ['integral', 'separate'], afdd: [false, true],
    is_incomer: [false, true], is_spare: [false, true], is_spd: [false, true],
    protection_standard: ['BS EN 60898', 'BS EN 61009'], trip_unit: ['TM', 'LSI'],
    earth_fault_device: ['', 'Earth fault relay'], arc_flash_device: ['', 'Arc flash relay'],
  };
  for (const [field, [primary, second]] of Object.entries(conflicts)) {
    const result = compare([device({ [field]: primary })], [device({ [field]: second })]);
    assert.ok(!result.agree && result.mismatches.some(item => item.kind === 'field_mismatch' && item.field === field), field);
  }
});
crossCheckCase('known versus missing fields remain disagreement', () => {
  for (const field of ['rating_a', 'poles', 'rcd_protected']) {
    const known = field === 'rcd_protected' ? false : 1;
    const result = compare([device({ [field]: known })], [device({ [field]: null })]);
    assert.ok(!result.agree && result.mismatches.some(item => item.field === field), field);
  }
});
crossCheckCase('description changes alone do not manufacture electrical disagreement', () => {
  assert.equal(compare([device({ description: 'Sockets' })], [device({ description: 'Socket outlets' })]).agree, true);
});
crossCheckCase('blank ways are valid for incomers and remain occurrence-aware', () => {
  const incomer = device({ way: null, phase: '', device_class: 'isolator', is_incomer: true });
  assert.deepEqual(compare([incomer, incomer], [incomer]).counts, { primary: 2, second: 1 });
  assert.equal(compare([incomer, incomer], [incomer]).agree, false);
});
crossCheckCase('spaces are excluded but fitted spares are counted', () => {
  const space = device({ device_class: 'space', rating_a: null });
  const spare = device({ is_spare: true });
  assert.deepEqual(compare([space, spare], [spare]), { agree: true, counts: { primary: 1, second: 1 }, mismatches: [] });
});
crossCheckCase('explicit empty lists agree only as an empty comparison', () => {
  assert.deepEqual(compare([], []), { agree: true, counts: { primary: 0, second: 0 }, mismatches: [] });
});
crossCheckCase('missing or malformed device lists cannot masquerade as empty agreement', () => {
  for (const malformed of [null, {}, { devices: null }, { devices: {} }, { devices: 'invalid' }]) {
    const result = providers.crossCheckExtractions(malformed, { devices: [] });
    assert.equal(result.agree, false);
    assert.ok(result.mismatches.some(item => item.kind === 'invalid_extraction' && item.side === 'primary'));
  }
});
crossCheckCase('malformed rows do not throw or silently disappear', () => {
  for (const malformed of [null, 32, 'MCB', [], {}, device({ board_ref: {} }), device({ device_class: null })]) {
    const result = compare([malformed], [device()]);
    assert.equal(result.agree, false);
    assert.deepEqual(result.counts, { primary: 1, second: 1 });
    assert.ok(result.mismatches.some(item => item.kind === 'invalid_device' && item.side === 'primary'));
  }
});
crossCheckCase('malformed electrical values cannot agree with themselves', () => {
  for (const fields of [{ rating_a: '32A' }, { rating_a: -1 }, { rating_a: Infinity },
    { poles: 1.5 }, { rcd_protected: 'false' }, { trip_curve: {} }]) {
    const row = device(fields);
    const result = compare([row], [row]);
    assert.equal(result.agree, false);
    assert.equal(result.mismatches.filter(item => item.kind === 'invalid_device').length, 2);
  }
});
crossCheckCase('inputs are never mutated', () => {
  const primary = [device({ rating_a: 20 }), device()];
  const second = [device()];
  const before = JSON.stringify([primary, second]);
  compare(primary, second);
  assert.equal(JSON.stringify([primary, second]), before);
});
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
console.log(`PASS: Gemini master runtime, ${crossCheckCases} occurrence-aware cross-check cases, schema translation, provider gating, health probe.`);
