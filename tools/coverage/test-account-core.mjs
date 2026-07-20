/* Unit test: the optional cloud-account layer.
 *   - account-core.js pure helpers (token extraction, header merge) and the
 *     dependency-injected factory (config gating, JWT attachment) with fakes;
 *   - the public-config handler's browser-safe contract, incl. the guard that
 *     it can NEVER echo a service-role secret (quality gates #5, #11).
 * No network, no Supabase, no key.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
// account-core.js is a UMD script (the repo is "type":"module", so it is loaded
// the same way the other core files are in these tests: in a fresh vm context).
const source = await fs.readFile(path.resolve(ROOT, 'account-core.js'), 'utf8');
const ctx = vm.createContext({ console, fetch: undefined });
vm.runInContext(source, ctx, { filename: 'account-core.js' });
const { createAccount, accessTokenFrom, authedInit } = ctx.EstimationAccount;
const { handlePublicConfig } = await import(pathToFileURL(path.resolve(ROOT, 'api/_lib/handlers.mjs')));

let fail = 0;
const check = (name, cond, detail) => { if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; } };

/* ---- pure helpers ---- */
check('accessTokenFrom: valid session', accessTokenFrom({ access_token: 'abc' }) === 'abc');
check('accessTokenFrom: no session → null', accessTokenFrom(null) === null);
check('accessTokenFrom: empty token → null', accessTokenFrom({ access_token: '' }) === null);

const init1 = authedInit('tok', { method: 'POST', headers: { 'content-type': 'application/json' } });
check('authedInit: adds Bearer', init1.headers.Authorization === 'Bearer tok');
check('authedInit: preserves existing headers', init1.headers['content-type'] === 'application/json');
check('authedInit: preserves method', init1.method === 'POST');
const src = { headers: { a: '1' } };
authedInit('tok', src);
check('authedInit: does not mutate caller headers', !('Authorization' in src.headers));
const anon = authedInit(null, { method: 'GET' });
check('authedInit: no token → no Authorization header', !('Authorization' in anon.headers));

/* ---- factory with fakes ---- */
function fakeFetch(configured, key) {
  return async (url) => ({ ok: true, json: async () => ({ configured, supabase_url: 'https://x.supabase.co', supabase_publishable_key: key || 'sb_publishable_x' }) });
}
function fakeClient(session) {
  return () => ({ auth: {
    getSession: async () => ({ data: { session } }),
    signInWithPassword: async () => ({ data: {}, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  } });
}

{ // unconfigured server → no client
  const acc = createAccount({ createClient: fakeClient(null), fetchImpl: fakeFetch(false) });
  check('available() false before init', acc.available() === false);
  const r = await acc.init();
  check('init unconfigured → configured:false', r.configured === false);
  check('available() stays false when server unconfigured', acc.available() === false);
}

{ // configured + active session → authedFetch carries the JWT
  const calls = [];
  const withCapture = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({}) }; };
  const cfg = fakeFetch(true);
  const fetchImpl = async (url, init) => (url.includes('public-config') ? cfg(url) : withCapture(url, init));
  const acc = createAccount({ createClient: fakeClient({ access_token: 'JWT123', user: { id: 'u1' } }), fetchImpl });
  const r = await acc.init();
  check('init configured → configured:true', r.configured === true);
  check('available() true after configured init', acc.available() === true);
  check('getAccessToken returns session JWT', (await acc.getAccessToken()) === 'JWT123');
  await acc.authedFetch('/api/extractions/status?id=x', { method: 'GET' });
  check('authedFetch attaches Bearer JWT', calls[0] && calls[0].init.headers.Authorization === 'Bearer JWT123');
}

{ // configured but signed out → anonymous request (no bogus Bearer)
  const calls = [];
  const cfg = fakeFetch(true);
  const fetchImpl = async (url, init) => { if (url.includes('public-config')) return cfg(url); calls.push(init); return { ok: true, json: async () => ({}) }; };
  const acc = createAccount({ createClient: fakeClient(null), fetchImpl });
  await acc.init();
  await acc.authedFetch('/api/extractions/status?id=x', { method: 'GET' });
  check('authedFetch anonymous when signed out', calls[0] && !('Authorization' in calls[0].headers));
}

/* ---- public-config handler: browser-safe contract + secret guard ---- */
{
  const good = handlePublicConfig({ publicConfig: { url: 'https://x.supabase.co', publishableKey: 'sb_publishable_abc' }, authRequired: true }).body;
  check('public-config: configured with publishable key', good.configured === true);
  check('public-config: echoes url', good.supabase_url === 'https://x.supabase.co');
  check('public-config: echoes publishable key', good.supabase_publishable_key === 'sb_publishable_abc');
  check('public-config: reports auth_required', good.auth_required === true);

  const empty = handlePublicConfig({ publicConfig: {}, authRequired: false }).body;
  check('public-config: unset → not configured', empty.configured === false);
  check('public-config: unset → null url', empty.supabase_url === null);
  check('public-config: unset → null key', empty.supabase_publishable_key === null);
  check('public-config: auth_required false honoured', empty.auth_required === false);

  // A service-role JWT must NEVER be echoed even if misconfigured into the browser var.
  const leak = handlePublicConfig({ publicConfig: { url: 'https://x.supabase.co', publishableKey: 'eyJ.role.service_role.sig' } }).body;
  check('public-config: refuses service_role-looking key', leak.configured === false && leak.supabase_publishable_key === null);
}

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: account-core helpers/factory + public-config browser-safe contract.');
