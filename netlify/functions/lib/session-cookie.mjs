/* Signed download-session cookie: `__Host-estimation_download`.
 *
 * Value: base64url(JSON payload) + "." + HMAC-SHA256 signature.
 * Payload: { sid: <checkout session id>, exp: <unix seconds> }.
 * The __Host- prefix enforces Secure, Path=/, and no Domain at the browser
 * level; we set them explicitly as well. HttpOnly + SameSite=Lax. Short
 * expiry: the cookie only bridges "paid" → "download my files" — the
 * entitlement record in Blobs is the durable truth (and is re-read on every
 * download-link call so refunds revoke immediately).
 */
import { createHmac } from 'node:crypto';
import { safeEqual } from './commerce.mjs';

export const COOKIE_NAME = '__Host-estimation_download';
export const COOKIE_TTL_SECONDS = 60 * 60 * 24; // 24h

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createCookieValue(sessionId, env = process.env, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    sid: sessionId,
    exp: Math.floor(now / 1000) + COOKIE_TTL_SECONDS,
  })).toString('base64url');
  return `${payload}.${sign(payload, env.DOWNLOAD_TOKEN_SECRET)}`;
}

export function cookieHeader(sessionId, env = process.env) {
  return [
    `${COOKIE_NAME}=${createCookieValue(sessionId, env)}`,
    'Secure',
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${COOKIE_TTL_SECONDS}`,
  ].join('; ');
}

export function verifyCookie(req, env = process.env, now = Date.now()) {
  const header = req.headers.get('cookie') || '';
  const match = header.split(/;\s*/).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const value = match.slice(COOKIE_NAME.length + 1);
  const dot = value.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!safeEqual(signature, sign(payload, env.DOWNLOAD_TOKEN_SECRET))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.sid !== 'string' || typeof parsed.exp !== 'number') return null;
    if (parsed.exp * 1000 < now) return null;
    return { sessionId: parsed.sid };
  } catch {
    return null;
  }
}
