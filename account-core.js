/* account-core.js — optional cloud account layer for the multi-tenant path.
 *
 * The default experience stays LOCAL-FIRST and account-free: documents never
 * leave the device unless the user opts into cloud extraction, and no account
 * is required for any of that. This module only powers the *durable*,
 * multi-tenant job routes (api/extractions/{start,status,result}) which are
 * ownership-checked server-side and therefore need a Supabase session JWT.
 *
 * Design:
 *  - The publishable (anon) key + URL are fetched at runtime from
 *    /api/public-config (a static SPA has no build step to substitute env
 *    vars). That key is browser-safe by design and guarded by RLS. The
 *    service-role key NEVER reaches the browser.
 *  - Everything is dependency-injected (createClient, fetch, config URL) so the
 *    pure request/token logic is unit-testable in Node with no network.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EstimationAccount = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  /* Pure: safely read an access token from a Supabase session object. Returns
   * null (not "undefined"/"null") when absent, so callers stay anonymous. */
  function accessTokenFrom(session) {
    return session && typeof session.access_token === 'string' && session.access_token
      ? session.access_token : null;
  }

  /* Pure: merge a Bearer token into a fetch init without clobbering existing
   * headers. When there's no token we send NO Authorization header (an
   * anonymous request), never a literal "Bearer null". */
  function authedInit(token, init) {
    const base = init ? Object.assign({}, init) : {};
    const headers = Object.assign({}, base.headers || {});
    if (token) headers.Authorization = 'Bearer ' + token;
    base.headers = headers;
    return base;
  }

  /* Factory over injected deps:
   *   createClient : supabase.createClient (UMD global in the browser)
   *   fetchImpl    : fetch implementation (window.fetch in the browser)
   *   configUrl    : browser-safe config endpoint (default /api/public-config)
   */
  function createAccount(deps) {
    deps = deps || {};
    const createClient = deps.createClient;
    const fetchImpl = deps.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    const configUrl = deps.configUrl || '/api/public-config';

    let client = null;
    let config = null;
    let loaded = false;

    async function loadConfig() {
      if (loaded) return config;
      loaded = true;
      try {
        const r = await fetchImpl(configUrl, { method: 'GET' });
        config = r && r.ok ? await r.json() : { configured: false };
      } catch (_e) {
        config = { configured: false };
      }
      return config;
    }

    /* Create the browser client once, if the server says auth is available and
     * a createClient implementation was supplied. Idempotent. */
    async function init() {
      await loadConfig();
      if (client) return { configured: true };
      if (!config || !config.configured || typeof createClient !== 'function') {
        return { configured: false };
      }
      client = createClient(config.supabase_url, config.supabase_publishable_key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      return { configured: true };
    }

    function available() { return Boolean(client); }

    async function getAccessToken() {
      if (!client) return null;
      const { data } = await client.auth.getSession();
      return accessTokenFrom(data && data.session);
    }

    async function currentUser() {
      if (!client) return null;
      const { data } = await client.auth.getSession();
      const s = data && data.session;
      return s && s.user ? s.user : null;
    }

    async function signUp(email, password) {
      if (!client) return { error: 'Cloud accounts are not configured.' };
      const { data, error } = await client.auth.signUp({ email, password });
      return { data, error: error ? error.message : null };
    }

    async function signIn(email, password) {
      if (!client) return { error: 'Cloud accounts are not configured.' };
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      return { data, error: error ? error.message : null };
    }

    async function signOut() {
      if (!client) return { error: null };
      const { error } = await client.auth.signOut();
      return { error: error ? error.message : null };
    }

    function onChange(cb) {
      if (!client || typeof cb !== 'function') return () => {};
      const { data } = client.auth.onAuthStateChange((_event, session) => cb(session ? session.user : null));
      return () => { try { data.subscription.unsubscribe(); } catch (_e) {} };
    }

    /* Attach the current session JWT to a durable-route request. Without a
     * session it sends the request anonymously (the server will 401), which is
     * exactly what an ownership-checked route should see. */
    async function authedFetch(url, init) {
      const token = await getAccessToken();
      return fetchImpl(url, authedInit(token, init));
    }

    return { init, available, getAccessToken, currentUser, signUp, signIn, signOut, onChange, authedFetch };
  }

  return { createAccount, accessTokenFrom, authedInit };
});
