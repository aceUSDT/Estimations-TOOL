/* Regression test: the extraction request contract + structured-output schema.
 * No network, no key. Exercises the stateless inline-extract handler's
 * validation and the health probe (pure handlers, Vercel-agnostic), plus the
 * schema invariants and coerceResult. The live Gemini call needs GEMINI_API_KEY
 * in the server environment and is not tested here.
 */
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PACK = path.resolve(ROOT, 'api/_lib/extraction/domain-pack.mjs');

delete process.env.GEMINI_API_KEY;
const { handleHealth, handleInlineExtract } = await import(pathToFileURL(path.resolve(ROOT, 'api/_lib/handlers.mjs')));
const { providerStatus, buildInstruction, GEMINI_MODEL, GEMINI_VERIFY_MODEL } = await import(pathToFileURL(path.resolve(ROOT, 'api/_lib/extraction/providers.mjs')));
const { EXTRACTION_SCHEMA, EXTRACTION_SYSTEM_PROMPT, coerceResult } = await import(pathToFileURL(PACK));

let fail = 0;
const check = (name, cond, detail) => {
  if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; }
};

const healthDeps = () => ({ providerStatus, GEMINI_MODEL, GEMINI_VERIFY_MODEL });
const runDeps = (extract) => ({ providerStatus, buildInstruction, extract: extract || (async () => ({ result: {} })) });

/* health probe (pure handler) */
let body = handleHealth(healthDeps()).body;
check('health 200 shape', body.status === 'ok');
check('health reports unconfigured without key', body.configured === false);
check('health reports gemini provider only', body.providers && body.providers.gemini === false && !('anthropic' in body.providers));

/* inline-extract handler: method + config + shape validation before any call */
check('method guard: GET → 405', (await handleInlineExtract({ method: 'GET', body: {} }, runDeps())).status === 405);
check('unconfigured POST → 503', (await handleInlineExtract({ method: 'POST', body: { image_base64: 'aGk=' } }, runDeps())).status === 503);
process.env.GEMINI_API_KEY = 'test-not-a-real-key';
check('no image/text → 400', (await handleInlineExtract({ method: 'POST', body: { filename: 'x.pdf' } }, runDeps())).status === 400);
check('oversized image → 413', (await handleInlineExtract({ method: 'POST', body: { image_base64: 'a'.repeat(9 * 1024 * 1024) } }, runDeps())).status === 413);
delete process.env.GEMINI_API_KEY;

/* schema sanity: structured outputs demands additionalProperties:false and
 * required listing every property, recursively */
// Provider structured-output compilers reject union-typed params: stay clear.
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
console.log('PASS: inline-extract validation, health probe, and schema invariants.');
