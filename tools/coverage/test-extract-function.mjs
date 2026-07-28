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
const { providerStatus, buildInstruction, callGemini, GEMINI_MODEL, GEMINI_VERIFY_MODEL } = await import(pathToFileURL(path.resolve(ROOT, 'api/_lib/extraction/providers.mjs')));
const { EXTRACTION_SCHEMA, EXTRACTION_SYSTEM_PROMPT, coerceResult } = await import(pathToFileURL(PACK));

let fail = 0;
const check = (name, cond, detail) => {
  if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; }
};

const healthDeps = () => ({ providerStatus, GEMINI_MODEL, GEMINI_VERIFY_MODEL });
/* authRequired:false keeps these cases about what they are actually asserting
 * (validation, size limits, the spend guard). The auth gate itself is proved
 * in its own block below, with the default — auth ON — left in place. */
const runDeps = (extract) => ({ providerStatus, buildInstruction, extract: extract || (async () => ({ result: {} })), authRequired: false });

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
/* Spend guard on the unauthenticated inline-extract route. */
{
  process.env.GEMINI_API_KEY = 'test-not-a-real-key';
  const body = { image_base64: 'aGk=', filename: 'x.pdf', page_number: 1 };
  const call = (deps) => handleInlineExtract({ method: 'POST', body, headers: { 'x-forwarded-for': '203.0.113.9' } }, deps);
  const guardDeps = (over = {}) => ({
    ...runDeps(),
    env: {},
    store: {},
    clientIp: (input) => (input.headers || {})['x-forwarded-for'],
    ...over,
  });

  let seen = null;
  const allow = guardDeps({ rateLimit: async (store, scope, key, opts) => { seen = { scope, key, opts }; return { ok: true }; } });
  check('spend guard: under the limit extraction proceeds', (await call(allow)).status === 200);
  check('spend guard: keyed per client IP', seen && seen.key === '203.0.113.9');
  check('spend guard: uses its own scope + 1h window', seen && seen.scope === 'extract-run' && seen.opts.windowSec === 3600);
  check('spend guard: generous default ceiling', seen && seen.opts.limit === 240);

  const blocked = guardDeps({ rateLimit: async () => ({ ok: false }) });
  const res429 = await call(blocked);
  check('spend guard: over the limit ⇒ 429, no provider call', res429.status === 429 && res429.body.error.code === 'rate_limited');

  const overridden = guardDeps({ env: { EXTRACT_RATE_LIMIT_PER_HOUR: '10' }, rateLimit: async (s, sc, k, o) => { seen = { opts: o }; return { ok: true }; } });
  await call(overridden);
  check('spend guard: env override respected', seen && seen.opts.limit === 10);

  // Fail OPEN: extraction is the product, so a missing store or a throwing
  // limiter must never block legitimate work.
  check('spend guard: no store configured ⇒ extraction still runs', (await call(guardDeps({ store: null, rateLimit: async () => ({ ok: false }) }))).status === 200);
  delete process.env.GEMINI_API_KEY;
}

/* Auth gate on the inline-extract route. Every call spends real provider
 * budget, so an anonymous caller who finds the URL drains the account. The
 * gate is ON by default and opt-out via AUTH_REQUIRED, matching the durable
 * job routes rather than inventing a second auth rule. */
{
  process.env.GEMINI_API_KEY = 'test-not-a-real-key';
  const body = { image_base64: 'aGk=', filename: 'x.pdf', page_number: 1 };
  let extracted = 0;
  const base = (over = {}) => ({
    providerStatus, buildInstruction,
    extract: async () => { extracted++; return { result: {} }; },
    ...over,
  });
  const call = (deps) => handleInlineExtract({ method: 'POST', body }, deps);

  extracted = 0;
  const anon = await call(base({ resolveUser: async () => null }));
  check('auth: anonymous call is refused by default', anon.status === 401 && anon.body.error.code === 'unauthenticated');
  check('auth: refusal spends no provider budget', extracted === 0);

  const signedIn = await call(base({ resolveUser: async () => 'user-123' }));
  check('auth: signed-in call proceeds', signedIn.status === 200);

  // Fail CLOSED: a deployment that forgets to wire the resolver must not be
  // silently open — absent plumbing means "nobody is signed in", not "auth off".
  const unwired = await call(base());
  check('auth: no resolver wired ⇒ still refused', unwired.status === 401);

  const optedOut = await call(base({ authRequired: false, resolveUser: async () => null }));
  check('auth: AUTH_REQUIRED=false restores the anonymous path', optedOut.status === 200);
  delete process.env.GEMINI_API_KEY;
}

/* Provider error CONTRACT. The worker retries transient failures by testing
 * `e.status` against {429,500,502,503,504}. That check is worthless unless the
 * provider actually attaches a numeric status — a bare Error means a
 * rate-limited page fails permanently on the first 429. The worker tests use
 * fakes that already shape the error correctly, so only a test against the
 * real provider closes this gap. */
{
  const realFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-not-a-real-key';
  for (const status of [429, 503]) {
    globalThis.fetch = async () => ({ ok: false, status, text: async () => 'upstream detail' });
    let caught = null;
    try {
      await callGemini({ instruction: 'x', imageBase64: 'aGk=' });
    } catch (e) { caught = e; }
    check(`callGemini: HTTP ${status} error carries numeric status`, caught && caught.status === status,
      caught ? `status=${JSON.stringify(caught.status)}` : 'no error thrown');
  }
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_API_KEY;
}

check('prompt persists the P-code legend', EXTRACTION_SYSTEM_PROMPT.includes('P1=MCB'));
check('prompt persists the spare phase-slot rule', /Never mark a whole way spare/.test(EXTRACTION_SYSTEM_PROMPT));
check('prompt forbids counting', /NEVER count/.test(EXTRACTION_SYSTEM_PROMPT));

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: inline-extract validation, health probe, and schema invariants.');

/* Dialect and structural knowledge the fixtures proved the prompt needs.
 *
 * The failures behind each: a 110V board numbering ways by device yielded
 * nothing because no dialect described it, and a board stitched across three
 * pages was returned as three fragments. Both are knowledge the model cannot
 * infer from one page in isolation. */
{
  const required = [
    ['device-prefixed circuit refs', /MCB\/21/],
    ['RCD still decides class there', /RCD value still makes it an RCBO/i],
    ['no phase letter invented', /leave phase null rather than inventing/i],
    ['a board may span pages', /ONE board of 54 phase-slots/],
    ['continuation has no header', /no header block of its own/i],
    ['own header starts a new board', /carry its own header block starts a new board|DOES carry its own header block/i],
  ];
  for (const [name, re] of required) {
    check(`system prompt: ${name}`, re.test(EXTRACTION_SYSTEM_PROMPT));
  }
  // the invariant that must never be edited out of it
  check('system prompt still forbids counting', /NEVER count/.test(EXTRACTION_SYSTEM_PROMPT));
}
