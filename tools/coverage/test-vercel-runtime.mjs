import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import handler from '../../api/extract.mjs';

const rootUrl = new URL('../../', import.meta.url);
const vercel = JSON.parse(await readFile(new URL('vercel.json', rootUrl), 'utf8'));
const index = await readFile(new URL('index.html', rootUrl), 'utf8');

assert.equal(vercel.functions['api/extract.mjs'].maxDuration, 300);
assert.equal(vercel.functions['api/extract-background.mjs'].maxDuration, 300);
assert.equal(vercel.functions['api/extract-status.mjs'].maxDuration, 30);
assert.deepEqual(vercel.rewrites[0], {
  source: '/.netlify/functions/extract',
  destination: '/api/extract',
});
assert.match(index, /const AI_EXTRACT_ENDPOINT='\/api\/extract';/);
assert.match(index, /const AI_BG_ENDPOINT='\/api\/extract-background';/);
assert.match(index, /const AI_STATUS_ENDPOINT='\/api\/extract-status';/);
assert.match(index, /__aiExecutionMode==='sync'/);
assert.match(index, /const jobId=submission\.jobId;/);

function responseRecorder() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: Buffer.alloc(0),
    setHeader(key, value) { headers.set(String(key).toLowerCase(), String(value)); },
    end(value = '') { this.body = Buffer.isBuffer(value) ? value : Buffer.from(String(value)); },
    get json() { return JSON.parse(this.body.toString('utf8')); },
    get headers() { return headers; },
  };
}

const healthReq = {
  method: 'GET',
  url: '/api/extract',
  headers: { host: 'estimation.io', 'x-forwarded-proto': 'https', 'x-forwarded-for': 'test-health' },
  socket: {},
};
const healthRes = responseRecorder();
const priorVercel = process.env.VERCEL;
const priorBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
process.env.VERCEL = '1';
delete process.env.BLOB_READ_WRITE_TOKEN;
await handler(healthReq, healthRes);
if (priorVercel == null) delete process.env.VERCEL;
else process.env.VERCEL = priorVercel;
assert.equal(healthRes.statusCode, 200);
assert.equal(healthRes.json.executionMode, 'sync');
assert.equal(healthRes.json.backgroundConfigured, false);
assert.equal(healthRes.headers.get('cache-control'), 'no-store');

process.env.VERCEL = '1';
process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
const backgroundHealthRes = responseRecorder();
await handler({ ...healthReq, headers: { ...healthReq.headers, 'x-forwarded-for': 'test-background-health' } }, backgroundHealthRes);
assert.equal(backgroundHealthRes.statusCode, 200);
assert.equal(backgroundHealthRes.json.executionMode, 'background');
assert.equal(backgroundHealthRes.json.backgroundConfigured, true);
if (priorVercel == null) delete process.env.VERCEL;
else process.env.VERCEL = priorVercel;
if (priorBlobToken == null) delete process.env.BLOB_READ_WRITE_TOKEN;
else process.env.BLOB_READ_WRITE_TOKEN = priorBlobToken;

const crossOriginRes = responseRecorder();
await handler({
  ...healthReq,
  method: 'POST',
  headers: { ...healthReq.headers, origin: 'https://example.invalid', 'x-forwarded-for': 'test-origin' },
  body: {},
}, crossOriginRes);
assert.equal(crossOriginRes.statusCode, 403);

const oversizedRes = responseRecorder();
await handler({
  ...healthReq,
  method: 'POST',
  headers: { ...healthReq.headers, origin: 'https://estimation.io', 'content-length': '5000000', 'x-forwarded-for': 'test-size' },
  body: {},
}, oversizedRes);
assert.equal(oversizedRes.statusCode, 413);

console.log('PASS: Vercel extraction routes, runtime capability probe, origin guard, request limit, and legacy rewrites');
