/* Regression test: WS0.4 serverless extraction function (no network, no key).
 * Exercises the handler's request validation and health probe, and sanity-
 * checks the structured-output schema. The live Claude call needs
 * ANTHROPIC_API_KEY in the Netlify environment and is not tested here.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FN = path.resolve(HERE, '../../netlify/functions/extract.mjs');
const PACK = path.resolve(HERE, '../../netlify/functions/lib/domain-pack.mjs');

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
const { default: handler } = await import(pathToFileURL(FN));
const { EXTRACTION_SCHEMA, EXTRACTION_SYSTEM_PROMPT, coerceResult } = await import(pathToFileURL(PACK));

let fail = 0;
const check = (name, cond, detail) => {
  if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; }
};

/* health probe */
let res = await handler(new Request('http://x/extract', { method: 'GET' }));
let body = await res.json();
check('GET health 200', res.status === 200);
check('GET reports unconfigured without key', body.configured === false);

/* method guard */
res = await handler(new Request('http://x/extract', { method: 'DELETE' }));
check('DELETE → 405', res.status === 405);

/* unconfigured POST */
res = await handler(new Request('http://x/extract', { method: 'POST', body: '{}' }));
check('POST without key → 503', res.status === 503);

/* with a (fake) key, validation runs before any network call */
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-real-key';
res = await handler(new Request('http://x/extract', { method: 'POST', body: 'not json' }));
check('bad JSON → 400', res.status === 400);
res = await handler(new Request('http://x/extract', { method: 'POST', body: JSON.stringify({ filename: 'x.pdf' }) }));
check('no image/text → 400', res.status === 400);
delete process.env.ANTHROPIC_API_KEY;

/* schema sanity: structured outputs demands additionalProperties:false and
 * required listing every property, recursively */
// The Messages API rejects >~32 union/array-typed params: assert we stay clear.
let unionCount = 0;
(function countUnions(s) {
  if (!s || typeof s !== 'object') return;
  if (s.anyOf || Array.isArray(s.type)) unionCount++;
  if (s.properties) Object.values(s.properties).forEach(countUnions);
  if (s.items) countUnions(s.items);
})(EXTRACTION_SCHEMA);
check('schema has no union-typed params (API compilation limit)', unionCount === 0, `found ${unionCount}`);

// coerceResult turns the model's all-string output back into numbers/null
const co = coerceResult({
  classification: { type: 'db_schedule', sub_format: 'bam_epo', confidence: '0.9' },
  boards: [{ ref: 'DB-00-08P', ways_total: '18', incomer_rating_a: '160', fault_ka: '', confidence: '0.95' }],
  devices: [{ board_ref: 'DB-00-08P', way: '13', rating_a: '32', cpc_csa_mm2: 'SWA', phase_csa_mm2: '6', confidence: '0.9', is_spare: false }],
  feeds: [{ to_ref: 'DB-00-08P', cable_csa_mm2: '70', cable_cpc_mm2: '', rating_a: '160', confidence: '0.8' }],
  flags: [],
});
check('coerce: ways_total "18" → 18', co.boards[0].ways_total === 18);
check('coerce: empty "" → null', co.boards[0].fault_ka === null);
check('coerce: device way "13" → 13', co.devices[0].way === 13);
check('coerce: cpc "SWA" stays string', co.devices[0].cpc_csa_mm2 === 'SWA');
check('coerce: feed cable_csa "70" → 70', co.feeds[0].cable_csa_mm2 === 70);
check('coerce: booleans untouched', co.devices[0].is_spare === false);

function walk(schema, where) {
  if (schema.anyOf) { schema.anyOf.forEach((s) => walk(s, where)); return; }
  if (schema.type === 'object') {
    check(`additionalProperties false @ ${where}`, schema.additionalProperties === false);
    const props = Object.keys(schema.properties || {});
    const req = schema.required || [];
    check(`required covers all props @ ${where}`, props.length === req.length && props.every((p) => req.includes(p)),
      `props=${props.length} required=${req.length}`);
    for (const [k, v] of Object.entries(schema.properties || {})) walk(v, `${where}.${k}`);
  }
  if (schema.type === 'array') walk(schema.items, `${where}[]`);
}
walk(EXTRACTION_SCHEMA, '$');
check('prompt persists the P-code legend', EXTRACTION_SYSTEM_PROMPT.includes('P1=MCB'));
check('prompt persists the spare phase-slot rule', /Never mark a whole way spare/.test(EXTRACTION_SYSTEM_PROMPT));
check('prompt forbids counting', /NEVER count/.test(EXTRACTION_SYSTEM_PROMPT));

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: extract function validation, health probe, and schema invariants.');
