/* Commerce configuration, gating, and shared helpers.
 *
 * COMMERCE IS DISABLED unless COMMERCE_ENABLED === 'true' AND every required
 * production value is present. The store page must show a clear disabled
 * state; no endpoint may half-work. No secret ever leaves the server; no
 * customer electrical document ever reaches the commerce service.
 *
 * Note on dependencies: the signed download cookie uses node:crypto HMAC
 * (see session-cookie.mjs), so the `jose` package from the brief's example
 * install line is intentionally not a dependency.
 */
import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const REQUIRED_ENV = [
  'SITE_URL',
  'SUPPORT_EMAIL',
  'LEGAL_SELLER_NAME',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_ID',
  'DOWNLOAD_TOKEN_SECRET',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'RESEND_API_KEY',
  'MAIL_FROM',
];

export function commerceState(env = process.env) {
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  const enabled = env.COMMERCE_ENABLED === 'true' && missing.length === 0;
  return { enabled, flagOn: env.COMMERCE_ENABLED === 'true', missing };
}

export function productName(env = process.env) {
  return env.PRODUCT_DISPLAY_NAME || 'Estimation Tools';
}

export const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
});

export const disabledResponse = () => json(503, {
  commerceEnabled: false,
  error: 'Purchasing is not available yet.',
});

/* Same-origin guard for state-changing endpoints. Stripe's webhook has its
 * own signature check and is exempt by design. */
export function sameOrigin(req, env = process.env) {
  const site = env.SITE_URL ? new URL(env.SITE_URL).origin : null;
  const origin = req.headers.get('origin');
  if (origin) return site !== null && origin === site;
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none';
  return true;
}

export function clientIp(req) {
  return (req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
}

/* Fixed-window rate limit on the entitlement blob store. Coarse but honest:
 * the goal is stopping enumeration and abuse, not precise QoS. Fails CLOSED
 * for sensitive scopes when failClosed is set. */
export async function rateLimit(store, scope, key, { limit, windowSec, failClosed = false }) {
  const windowId = Math.floor(Date.now() / (windowSec * 1000));
  const blobKey = `rl:${scope}:${hashKey(key)}:${windowId}`;
  try {
    const current = Number(await store.get(blobKey)) || 0;
    if (current >= limit) return { ok: false, remaining: 0 };
    await store.set(blobKey, String(current + 1), { metadata: { expiresAt: (windowId + 2) * windowSec * 1000 } });
    return { ok: true, remaining: limit - current - 1 };
  } catch {
    return { ok: !failClosed, remaining: 0 };
  }
}

export function hashKey(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}

export function hmacEmail(email, env = process.env) {
  const normalised = String(email || '').trim().toLowerCase();
  return createHmac('sha256', env.DOWNLOAD_TOKEN_SECRET || '').update(normalised).digest('hex');
}

export function randomToken() {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  if (!user || !domain) return null;
  const head = user.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

/* Lazily construct the Stripe client so importing this module never needs a
 * key (tests import freely; endpoints construct only after the gate). */
export async function getStripe(env = process.env) {
  const { default: Stripe } = await import('stripe');
  return new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2025-06-30.basil' });
}

/* Read a request body with a hard size cap — commerce endpoints accept only
 * tiny JSON payloads. Returns null when the body is malformed or oversized. */
export async function readSmallJson(req, maxBytes = 4096) {
  try {
    const text = await req.text();
    if (text.length > maxBytes) return null;
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}
