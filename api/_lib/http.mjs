/* Shared HTTP helpers for the Vercel /api routes.
 *
 * Handlers are written as pure functions over a normalized `input`
 * ({ method, query, body, headers }) returning a plain
 * { status, body, headers? } — so they are unit-testable with no Vercel
 * runtime and no network. The thin route files adapt Vercel's (req, res) to
 * this shape. Every response carries a correlation id for diagnostics; no
 * response ever includes a secret or provider internal.
 */
import { randomUUID } from 'node:crypto';

export const MAX_BODY_BYTES = 10 * 1024 * 1024;       // 10 MB hard cap (page image + text)
export const MAX_IMAGE_B64 = 8 * 1024 * 1024;         // ~6 MB decoded image ceiling
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }

export function newCorrelationId() { return `cor_${randomUUID()}`; }

export function ok(status, body, headers) {
  return { status, body, headers: headers || {} };
}

/* Stable error envelope: { error: { code, message, correlation_id } }.
 * `code` is a stable machine string; `message` is safe for humans and never
 * contains keys, tokens, or upstream provider payloads. */
export function err(status, code, message, correlationId) {
  return { status, body: { error: { code, message, correlation_id: correlationId || null } } };
}

/* Byte length of a JSON-serialisable body without trusting a Content-Length
 * header (which the client controls). */
export function jsonByteLength(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

/* Bearer token from an Authorization header (case-insensitive lookup). */
export function bearerToken(headers = {}) {
  const h = headers.authorization || headers.Authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}
