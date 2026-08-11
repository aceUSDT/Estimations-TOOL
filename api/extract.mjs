import extract from '../netlify/functions/extract.mjs';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 180;
const MAX_BODY_BYTES = 4_250_000;
const requestsByAddress = new Map();

function clientAddress(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function withinRateLimit(req) {
  const key = clientAddress(req);
  const now = Date.now();
  const current = requestsByAddress.get(key);
  if (!current || current.resetAt <= now) {
    requestsByAddress.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  current.count += 1;
  return current.count <= MAX_REQUESTS_PER_WINDOW;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    const requestHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return Boolean(requestHost) && originHost === requestHost;
  } catch {
    return false;
  }
}

function requestUrl(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  const protocol = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return `${protocol}://${host}${req.url || '/api/extract'}`;
}

function requestBody(req) {
  if (req.body == null) return undefined;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return req.body;
  return JSON.stringify(req.body);
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method || '')) return sendJson(res, 405, { error: 'GET or POST only' });
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Cross-origin requests are not allowed' });
  if (!withinRateLimit(req)) return sendJson(res, 429, { error: 'Request limit reached; retry shortly' });

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_BODY_BYTES) return sendJson(res, 413, { error: 'Request body is too large' });

  const body = req.method === 'POST' ? requestBody(req) : undefined;
  if (body && Buffer.byteLength(body) > MAX_BODY_BYTES) return sendJson(res, 413, { error: 'Request body is too large' });

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (value != null) headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  const webRequest = new Request(requestUrl(req), { method: req.method, headers, body });
  const response = await extract(webRequest);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.setHeader('cache-control', 'no-store');
  res.end(Buffer.from(await response.arrayBuffer()));
}
