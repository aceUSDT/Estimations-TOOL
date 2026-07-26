/* GET /api/redeem-download-token?token=… — the link inside the restore email.
 *
 * Single use: the hashed record is deleted BEFORE the cookie is issued, so a
 * forwarded/replayed link is dead after first click. On success the browser
 * lands on the normal success page with the signed download cookie set; on
 * failure it lands on the restore page with a generic error (no oracle).
 */
import { commerceState, json, sha256Hex } from '../commerce.mjs';
import { realStore, isActive } from '../entitlements.mjs';
import { cookieHeader } from '../session-cookie.mjs';

const redirect = (location, headers = {}) => new Response(null, {
  status: 302,
  headers: { location, 'cache-control': 'no-store', ...headers },
});

export async function handleRedeemDownloadToken(req, deps) {
  const { env } = deps;
  if (!commerceState(env).enabled) return json(503, { error: 'commerce disabled' });

  const failure = redirect(`${env.SITE_URL}/download/restore/?error=link`);
  const token = new URL(req.url).searchParams.get('token');
  if (!token || token.length > 128) return failure;

  const key = `restore:${sha256Hex(token)}`;
  const grant = await deps.store.get(key, { type: 'json' }).catch(() => null);
  if (!grant) return failure;
  await deps.store.delete(key); // burn before use — single-shot token
  if (typeof grant.expiresAt !== 'number' || grant.expiresAt < Date.now()) return failure;

  const record = await deps.store.get(grant.entitlementKey, { type: 'json' }).catch(() => null);
  if (!isActive(record)) return failure;

  return redirect(
    `${env.SITE_URL}/download/success/?restored=1`,
    { 'set-cookie': cookieHeader(record.checkoutSessionId, env) },
  );
}

