/* Regression test: the AI cross-check (second-opinion) machinery.
 * No network, no keys — exercises the deterministic comparator, the Gemini
 * schema translation, provider selection, and the health-probe contract.
 * The comparison itself must be CODE, never a model (CLAUDE.md: AI extracts,
 * code computes) — these tests pin that behaviour.
 */
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '../../netlify/functions/lib/providers.mjs');
const FN = path.resolve(HERE, '../../netlify/functions/extract.mjs');

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;

const { crossCheckExtractions, geminiSchema, providerStatus, buildInstruction } = await import(pathToFileURL(LIB));
const { default: handler } = await import(pathToFileURL(FN));

let fail = 0;
const check = (name, cond, detail) => {
  if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; }
};

/* ---------- crossCheckExtractions ---------- */
const dev = (over = {}) => ({
  board_ref: 'DB-01', way: '1', phase: 'L1', description: 'Lighting', device_class: 'MCB',
  rating_a: 10, poles: 1, confidence: 0.9, ...over,
});

// identical → agree
let r = crossCheckExtractions({ devices: [dev()] }, { devices: [dev()] });
check('identical extractions agree', r.agree && r.mismatches.length === 0);

// second model saw an extra device → missing_in_primary (the recall case)
r = crossCheckExtractions({ devices: [dev()] }, { devices: [dev(), dev({ way: '2', description: 'Sockets', rating_a: 32 })] });
check('extra device in second → missing_in_primary', r.mismatches.length === 1 && r.mismatches[0].kind === 'missing_in_primary');
check('missing_in_primary carries the device spec', r.mismatches[0].second && r.mismatches[0].second.rating_a === 32);

// primary-only device → missing_in_second
r = crossCheckExtractions({ devices: [dev(), dev({ way: '3' })] }, { devices: [dev()] });
check('extra device in primary → missing_in_second', r.mismatches.length === 1 && r.mismatches[0].kind === 'missing_in_second');

// rating disagreement → field_mismatch
r = crossCheckExtractions({ devices: [dev({ rating_a: 32 })] }, { devices: [dev({ rating_a: 40 })] });
check('rating disagreement flagged', r.mismatches.length === 1 && r.mismatches[0].kind === 'field_mismatch' && r.mismatches[0].field === 'rating_a');

// device_class disagreement → flagged; spare/other are NOT flagged (too fuzzy)
r = crossCheckExtractions({ devices: [dev({ device_class: 'MCB' })] }, { devices: [dev({ device_class: 'RCBO' })] });
check('class disagreement flagged', r.mismatches.some((m) => m.field === 'device_class'));
r = crossCheckExtractions({ devices: [dev({ device_class: 'spare' })] }, { devices: [dev({ device_class: 'MCB' })] });
check('spare-vs-class not flagged', r.mismatches.length === 0);

// blank ways (space) are ignored on both sides
r = crossCheckExtractions({ devices: [] }, { devices: [dev({ device_class: 'space' })] });
check('space rows ignored', r.agree);

// board/way normalisation: "DB-01" way 1 matches "db 01" way "1"
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

/* ---------- provider selection ---------- */
check('no keys → unconfigured', providerStatus().configured === false && providerStatus().primary === null);
process.env.GEMINI_API_KEY = 'test-not-a-real-key';
let st = providerStatus();
check('gemini only → gemini primary, no verify', st.configured && st.primary === 'gemini' && st.verify === false);
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-real-key';
st = providerStatus();
check('both keys → anthropic primary + verify', st.primary === 'anthropic' && st.verify === true);
delete process.env.ANTHROPIC_API_KEY;

/* ---------- health probe with gemini-only ---------- */
const res = await handler(new Request('http://x/extract', { method: 'GET' }));
const body = await res.json();
check('health: gemini-only is configured', body.configured === true && body.primary === 'gemini');
check('health: model reported for gemini primary', typeof body.model === 'string' && body.model.includes('gemini'));
delete process.env.GEMINI_API_KEY;

/* ---------- instruction builder ---------- */
const instr = buildInstruction({ filename: 'a.pdf', pageNumber: 3, hints: { type: 'db_schedule', sub_format: 'bam_epo' }, textLines: ['ROW 1'] });
check('instruction carries filename/page/hint/lines', instr.includes('a.pdf') && instr.includes('page 3') && instr.includes('bam_epo') && instr.includes('ROW 1'));

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: cross-check comparator, Gemini schema translation, provider selection.');
