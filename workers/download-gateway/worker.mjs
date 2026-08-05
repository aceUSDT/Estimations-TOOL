/* files.{ROOT_DOMAIN} — Cloudflare Worker download gateway.
 *
 * Serves paid installer downloads from the PRIVATE R2 bucket on a branded
 * hostname (R2 presigned URLs cannot use custom domains). Every request must
 * carry a short-lived HMAC claim minted by /api/download-link; the claim
 * pins the exact object key, so one token can never fetch another file.
 *
 * The Worker holds ONE secret (DOWNLOAD_TOKEN_SECRET) — never Stripe, never
 * the R2 API keys (the bucket is a binding). Bucket listing is impossible:
 * only exact-key GET/HEAD with a valid claim is served.
 *
 * Deploy: see wrangler.toml + docs/CUSTOM_DOMAIN_RUNBOOK.md.
 */
import { verifyClaim } from '../../netlify/functions/lib/download-claim.mjs';

const deny = (status, message) => new Response(message, {
  status,
  headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
});

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {                       // suffix: last N bytes
    const length = Math.min(size, Number(m[2]));
    return { offset: size - length, length };
  }
  const offset = Number(m[1]);
  if (offset >= size) return { invalid: true };
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  return { offset, length: end - offset + 1 };
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return deny(405, 'method not allowed');
    }
    const url = new URL(request.url);
    const objectKey = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!objectKey || objectKey.includes('..') || !objectKey.startsWith('releases/')) {
      return deny(404, 'not found');
    }
    const claim = await verifyClaim(url.searchParams.get('token'), {
      audience: url.hostname,
      requestedKey: objectKey,
    }, env.DOWNLOAD_TOKEN_SECRET);
    if (!claim) return deny(403, 'download link is invalid or has expired — request a fresh one from your downloads page');

    const head = await env.RELEASES.head(objectKey);
    if (!head) return deny(404, 'not found');
    const fileName = objectKey.split('/').pop();
    const baseHeaders = {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
      'accept-ranges': 'bytes',
      etag: head.httpEtag,
    };

    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers: { ...baseHeaders, 'content-length': String(head.size) } });
    }

    const range = parseRange(request.headers.get('range'), head.size);
    if (range && range.invalid) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${head.size}` } });
    }
    if (range) {
      const object = await env.RELEASES.get(objectKey, { range: { offset: range.offset, length: range.length } });
      if (!object) return deny(404, 'not found');
      return new Response(object.body, {
        status: 206,
        headers: {
          ...baseHeaders,
          'content-length': String(range.length),
          'content-range': `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`,
        },
      });
    }
    const object = await env.RELEASES.get(objectKey);
    if (!object) return deny(404, 'not found');
    return new Response(object.body, {
      status: 200,
      headers: { ...baseHeaders, 'content-length': String(head.size) },
    });
  },
};
