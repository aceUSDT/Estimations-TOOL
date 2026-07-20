/* Vercel (req, res) ↔ pure-handler adapter and real dependency wiring.
 *
 * Route files stay tiny: they call `runRoute(handler, req, res)`. Real deps
 * come from `realDeps()`; the pure handlers in handlers.mjs are what the
 * deterministic tests exercise directly with fakes.
 */
import { providerStatus, GEMINI_MODEL, GEMINI_VERIFY_MODEL, extractWithVerification, buildInstruction } from './extraction/providers.mjs';
import { serviceClient, userFromRequest } from './supabase.mjs';
import * as db from './db.mjs';
import { makeProcessJob } from './worker.mjs';
import { newCorrelationId } from './http.mjs';

/* Build the shared server deps once per invocation. Supabase is created lazily
 * so the health route works even before Supabase env vars are set. */
export function realDeps() {
  let sb = null;
  const getSb = () => (sb = sb || serviceClient());
  const authRequired = process.env.AUTH_REQUIRED !== 'false';   // safe-by-default: auth on
  const deps = {
    providerStatus, GEMINI_MODEL, GEMINI_VERIFY_MODEL,
    supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    authRequired,
    db,
    buildInstruction,
    extract: extractWithVerification,
    get sb() { return getSb(); },
    resolveUser: async (input) => {
      const user = await userFromRequest({ headers: { get: (k) => (input.headers || {})[k.toLowerCase()] || null } });
      return user ? user.id : null;
    },
  };
  // Bind a concrete Supabase client at call time (not the lazy getter).
  deps.processJob = (job, payload) => makeProcessJob({ sb: getSb(), db, extract: extractWithVerification, buildInstruction })(job, payload);
  return deps;
}

/* Normalize Vercel's req into the handler `input` shape. */
function toInput(req) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers || {})) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
  return {
    method: req.method,
    query: req.query || {},
    body: req.body && typeof req.body === 'object' ? req.body : (typeof req.body === 'string' && req.body ? safeParse(req.body) : {}),
    headers,
    correlationId: newCorrelationId(),
  };
}
function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

export async function runRoute(handler, req, res, deps) {
  let out;
  try {
    out = await handler(toInput(req), deps || realDeps());
  } catch (e) {
    out = { status: 500, body: { error: { code: 'internal_error', message: 'Unexpected error.', correlation_id: null } } };
  }
  res.status(out.status);
  res.setHeader('cache-control', 'no-store');
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  res.json(out.body);
}
