const WINDOW_MS = 10 * 60 * 1000;
const requestsByAddress = new Map();

export const MAX_BODY_BYTES = 4_250_000;

function clientAddress(req) {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
}

export function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    const requestHost = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '')
      .split(',')[0].trim();
    return Boolean(requestHost) && originHost === requestHost;
  } catch {
    return false;
  }
}

export function withinRateLimit(req, scope, limit) {
  const key = `${scope}:${clientAddress(req)}`;
  const now = Date.now();
  const current = requestsByAddress.get(key);
  if (!current || current.resetAt <= now) {
    requestsByAddress.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export function requestBodyBytes(req) {
  if (req.body == null) return 0;
  if (Buffer.isBuffer(req.body)) return req.body.byteLength;
  if (typeof req.body === 'string') return Buffer.byteLength(req.body);
  return Buffer.byteLength(JSON.stringify(req.body));
}

export function readJsonBody(req) {
  if (req.body == null) return {};
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
  if (typeof req.body === 'string') return JSON.parse(req.body);
  if (typeof req.body === 'object') return req.body;
  throw new TypeError('Invalid JSON body');
}

export function guardRequest(req, res, options = {}) {
  const methods = options.methods || ['GET'];
  const method = String(req.method || '').toUpperCase();
  if (!methods.includes(method)) {
    sendJson(res, 405, { error: `${methods.join(' or ')} only` });
    return false;
  }
  if (!sameOrigin(req)) {
    sendJson(res, 403, { error: 'Cross-origin requests are not allowed' });
    return false;
  }
  if (!withinRateLimit(req, options.scope || 'api', options.limit || 180)) {
    sendJson(res, 429, { error: 'Request limit reached; retry shortly' });
    return false;
  }
  const contentLength = Number(req.headers?.['content-length'] || 0);
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  if (contentLength > maxBodyBytes || requestBodyBytes(req) > maxBodyBytes) {
    sendJson(res, 413, { error: 'Request body is too large' });
    return false;
  }
  return true;
}
