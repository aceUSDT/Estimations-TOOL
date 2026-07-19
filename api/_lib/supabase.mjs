/* Server-side Supabase client for Vercel Node routes. SERVER ONLY.
 *
 * Uses the SERVICE ROLE key, which bypasses RLS — so every route that uses
 * this client MUST perform its own explicit authorization (job/project/org
 * ownership checks) before reading or writing. Never import this from
 * anything the browser can load; the frontend gets only the publishable key
 * via its own client when Supabase Auth ships (Phase 7).
 */
import { createClient } from '@supabase/supabase-js';

export function serviceClient(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw Object.assign(
      new Error('Supabase is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server environment.'),
      { http: 503, code: 'supabase_unconfigured' },
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* Verify a caller's Supabase access token (sent as `Authorization: Bearer`)
 * and return the user, or null. Routes decide whether auth is mandatory —
 * production always is; the flag exists so local development before Phase 7
 * is possible without pretending it is authenticated. */
export async function userFromRequest(req, env = process.env) {
  const header = req.headers.get ? req.headers.get('authorization') : req.headers['authorization'];
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const anon = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

/* Stable JSON error envelope shared by all /api routes. */
export function apiError(status, code, message, correlationId) {
  return new Response(JSON.stringify({ error: { code, message, correlation_id: correlationId || null } }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export function apiJson(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
