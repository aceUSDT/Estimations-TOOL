/* POST /api/download-link — mint a short-lived authorised URL for ONE build.
 *
 * Authorisation chain, every hop server-controlled:
 *   signed cookie → entitlement re-read (refunds revoke instantly) →
 *   {platform, arch} mapped through the validated release manifest →
 *   branded files.{ROOT_DOMAIN} claim URL (or presigned R2 fallback).
 *
 * The browser never supplies a file name or object key, and the response
 * includes size + sha256 so the store page can show verifiable metadata.
 */
import {
  commerceState, json, disabledResponse, sameOrigin, clientIp,
  rateLimit, readSmallJson,
} from '../commerce.mjs';
import { realStore, getBySessionId, isActive } from '../entitlements.mjs';
import { verifyCookie } from '../session-cookie.mjs';
import { loadManifest, resolveBuild } from '../release-store.mjs';
import { realR2Deps, DOWNLOAD_URL_TTL_SECONDS } from '../r2.mjs';
import { signClaim, CLAIM_TTL_SECONDS } from '../download-claim.mjs';

export async function handleDownloadLink(req, deps) {
  const { env } = deps;
  if (!commerceState(env).enabled) return disabledResponse();
  if (!sameOrigin(req, env)) return json(403, { error: 'forbidden' });

  const cookie = verifyCookie(req, env);
  if (!cookie) return json(401, { error: 'no active download session — restore your purchase first' });

  const record = await getBySessionId(deps.store, cookie.sessionId);
  if (!isActive(record)) return json(403, { error: 'this purchase is not active' });

  const limited = await rateLimit(deps.store, 'download', cookie.sessionId, { limit: 30, windowSec: 3600 });
  if (!limited.ok) return json(429, { error: 'too many download requests, try again later' });

  const body = await readSmallJson(req);
  const platform = body && body.platform;
  const arch = body && body.arch;

  let manifest;
  try {
    manifest = await loadManifest(deps.r2);
  } catch {
    return json(503, { error: 'downloads are temporarily unavailable' });
  }
  const build = resolveBuild(manifest, platform, arch);
  if (!build) return json(400, { error: 'unknown platform/arch' });

  let url;
  let expiresIn;
  if (env.FILES_DOWNLOAD_HOST) {
    const token = await signClaim({
      audience: env.FILES_DOWNLOAD_HOST,
      entitlementId: cookie.sessionId,
      buildId: build.id,
      version: manifest.version,
      objectKey: build.objectKey,
    }, env.DOWNLOAD_TOKEN_SECRET);
    url = `https://${env.FILES_DOWNLOAD_HOST}/${build.objectKey}?token=${token}`;
    expiresIn = CLAIM_TTL_SECONDS;
  } else {
    url = await deps.r2.presignDownload({ objectKey: build.objectKey, fileName: build.fileName });
    expiresIn = DOWNLOAD_URL_TTL_SECONDS;
  }

  return json(200, {
    url,
    fileName: build.fileName,
    version: manifest.version,
    size: build.size,
    sha256: build.sha256,
    signed: build.signed,
    minimumOs: build.minimumOs,
    expiresIn,
  });
}

