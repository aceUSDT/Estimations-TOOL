/* POST /api/request-download-link — "restore my purchase" by email.
 *
 * Anti-enumeration by construction: the response is byte-identical whether
 * or not the email has an entitlement, mail is sent only when it does, and
 * the rate limiter FAILS CLOSED (an attacker cannot probe by breaking the
 * limiter). The restore token is single-use, 15-minute, and only ever
 * stored as its SHA-256 hash.
 */
import {
  commerceState, json, disabledResponse, sameOrigin, clientIp,
  rateLimit, randomToken, sha256Hex, readSmallJson, hashKey,
} from '../commerce.mjs';
import { realStore, getByEmail, isActive } from '../entitlements.mjs';
import { sendRestoreEmail, isLocalTestMode } from '../email.mjs';

export const RESTORE_TTL_SECONDS = 15 * 60;

const NEUTRAL = { ok: true, message: 'If that email bought a licence, a download link is on its way.' };

export async function handleRequestDownloadLink(req, deps) {
  const { env } = deps;
  if (!commerceState(env).enabled) return disabledResponse();
  if (!sameOrigin(req, env)) return json(403, { error: 'forbidden' });

  const body = await readSmallJson(req);
  const email = body && typeof body.email === 'string' ? body.email.trim() : '';
  if (!email || email.length > 254 || !email.includes('@')) {
    return json(400, { error: 'a valid email address is required' });
  }

  const byIp = await rateLimit(deps.store, 'restore-ip', clientIp(req), { limit: 5, windowSec: 3600, failClosed: true });
  const byEmail = await rateLimit(deps.store, 'restore-email', hashKey(email.toLowerCase()), { limit: 3, windowSec: 3600, failClosed: true });
  if (!byIp.ok || !byEmail.ok) return json(429, { error: 'too many requests, try again later' });

  const record = await getByEmail(deps.store, email, env);
  if (!isActive(record)) {
    return json(200, NEUTRAL); // identical response; no mail
  }

  const token = randomToken();
  await deps.store.setJSON(`restore:${sha256Hex(token)}`, {
    entitlementKey: `entitlement:${record.checkoutSessionId}`,
    expiresAt: Date.now() + RESTORE_TTL_SECONDS * 1000,
  });
  const restoreUrl = `${env.SITE_URL}/api/redeem-download-token?token=${token}`;
  const mail = await deps.sendRestoreEmail({ to: email, restoreUrl }, env);

  if (isLocalTestMode(env) && mail.localTestUrl) {
    return json(200, { ...NEUTRAL, localTestUrl: mail.localTestUrl });
  }
  return json(200, NEUTRAL);
}

