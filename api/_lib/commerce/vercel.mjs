/* Vercel (req,res) ↔ web-standard commerce handlers.
 *
 * The commerce handlers (ported verbatim from the paid-downloads work) take a
 * WHATWG Request and return a Response. This adapter rebuilds the Request
 * from Vercel's Node req — reading the RAW byte stream, never a re-serialised
 * body, because Stripe webhook signatures verify the exact bytes — and pumps
 * the Response back. Every commerce route disables Vercel's body parser for
 * the same reason (see the `config` export each route re-exports).
 */
import { getStripe, json } from './commerce.mjs';
import { realStore } from './entitlements.mjs';
import { realR2Deps } from './r2.mjs';
import { sendRestoreEmail } from './email.mjs';

export const rawBodyConfig = { api: { bodyParser: false } };

async function rawBody(req) {
  // Stream untouched (bodyParser off) → collect raw bytes.
  if (req.readable === false && req.body != null) {
    // Defensive: if a parser DID run, fall back to the parsed body's bytes.
    return Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export async function toWebRequest(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const url = `${proto}://${host}${req.url}`;
  const method = (req.method || 'GET').toUpperCase();
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(',') : String(v));
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') init.body = await rawBody(req);
  return new Request(url, init);
}

export async function sendWebResponse(res, response) {
  res.status(response.status);
  response.headers.forEach((v, k) => res.setHeader(k, v));
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}

/* Shared real deps: env + Stripe + the Supabase entitlement store + R2 +
 * restore email. Handlers destructure what they need. */
export async function commerceDeps() {
  return {
    env: process.env,
    getStripe,
    store: await realStore(),
    r2: realR2Deps(process.env),
    sendRestoreEmail,
  };
}

/* Route factory: method guard + adapt + run, with the stable JSON error the
 * commerce API uses (never a stack trace, never a secret). */
export function commerceRoute(method, handler) {
  return async function vercelHandler(req, res) {
    try {
      if ((req.method || '').toUpperCase() !== method) {
        return sendWebResponse(res, json(405, { error: 'method not allowed' }));
      }
      const webReq = await toWebRequest(req);
      const deps = await commerceDeps();
      const out = await handler(webReq, deps);
      return sendWebResponse(res, out);
    } catch {
      return sendWebResponse(res, json(500, { error: 'internal error' }));
    }
  };
}
