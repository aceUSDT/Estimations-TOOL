/* Shared request guards for the hosted extraction endpoints.
 *
 * The functions spend a paid API key on behalf of anonymous callers, so every
 * entry point checks three things before any provider call:
 *   - the request comes from this deployment's own origin (a cross-site page
 *     cannot forge Origin / Sec-Fetch-Site, so this stops third-party pages
 *     using the deployment as a free proxy);
 *   - the payload is within a page-sized budget;
 *   - the job identifier is an opaque token of our own format, so a caller
 *     cannot address arbitrary keys in the shared Blobs store.
 */

/* One rendered page at ~1500px JPEG is well under 4 MB of base64. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_LINES = 400;
export const MAX_TEXT_LINE_CHARS = 2000;
const JOB_ID = /^[A-Za-z0-9_-]{16,128}$/;
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/* Only the media types the providers accept; the value comes from the client. */
export function safeMediaType(value) {
  return MEDIA_TYPES.includes(value) ? value : 'image/jpeg';
}

export function isValidJobId(value) {
  return typeof value === 'string' && JOB_ID.test(value);
}

/* True when the request is same-origin (or came from a non-browser client that
 * sends neither Origin nor Sec-Fetch-Site). */
export function isSameOrigin(req) {
  const site = req.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export function isOversized(req) {
  const declared = Number(req.headers.get('content-length'));
  return Number.isFinite(declared) && declared > MAX_BODY_BYTES;
}

/* Caps the untrusted text lines so a single request cannot inflate the prompt. */
export function limitTextLines(textLines) {
  if (!Array.isArray(textLines)) return textLines;
  return textLines.slice(0, MAX_TEXT_LINES).map((line) => String(line ?? '').slice(0, MAX_TEXT_LINE_CHARS));
}
