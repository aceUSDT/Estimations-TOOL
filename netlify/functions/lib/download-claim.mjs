/* Signed download claims for the files.{ROOT_DOMAIN} gateway Worker.
 *
 * A claim authorises exactly one build of one release version for a few
 * minutes. It is signed with HMAC-SHA256 over a compact payload and carried
 * as a query token on the branded download URL:
 *
 *   https://files.{ROOT_DOMAIN}/<objectKey>?token=<claim>
 *
 * Payload fields:
 *   aud   audience — the files hostname (Worker refuses other audiences)
 *   ent   entitlement id (checkout session id)
 *   bld   allow-listed build id (e.g. windows-x64)
 *   ver   release version
 *   key   exact object key the claim covers
 *   exp   unix seconds expiry (≤ 300 s from issue)
 *   jti   unique token id (random)
 *
 * Implemented with Web Crypto (crypto.subtle) so the identical module runs
 * in Netlify Functions (Node 18+) and the Cloudflare Worker without shims.
 * The Worker never sees the Stripe/R2 secrets — only DOWNLOAD_TOKEN_SECRET.
 */

export const CLAIM_TTL_SECONDS = 300;

const encoder = new TextEncoder();

function b64url(bytes) {
  let str = '';
  for (const b of new Uint8Array(bytes)) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(text) {
  const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4));
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signClaim({ audience, entitlementId, buildId, version, objectKey }, secret, now = Date.now()) {
  const payload = b64url(encoder.encode(JSON.stringify({
    aud: audience,
    ent: entitlementId,
    bld: buildId,
    ver: version,
    key: objectKey,
    exp: Math.floor(now / 1000) + CLAIM_TTL_SECONDS,
    jti: b64url(crypto.getRandomValues(new Uint8Array(12))),
  })));
  const signature = b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload)));
  return `${payload}.${signature}`;
}

/* Verify signature + audience + expiry + (optionally) the requested path.
 * Returns the parsed claim or null — never throws on malformed input. */
export async function verifyClaim(token, { audience, requestedKey = null }, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  try {
    const ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      b64urlDecode(signature),
      encoder.encode(payload),
    );
    if (!ok) return null;
    const claim = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    if (!claim || claim.aud !== audience) return null;
    if (typeof claim.exp !== 'number' || claim.exp * 1000 < now) return null;
    if (typeof claim.key !== 'string' || claim.key.includes('..')) return null;
    if (requestedKey !== null && claim.key !== requestedKey) return null;
    return claim;
  } catch {
    return null;
  }
}
