import assert from 'node:assert/strict';
import { handleBackgroundExtraction } from '../../api/extract-background.mjs';
import { handleExtractionStatus } from '../../api/extract-status.mjs';
import {
  JOB_TTL_MS, extractionBlobToken, extractionJobStoreConfigured, makeExtractionJobStore,
} from '../../api/_lib/extraction-job-store.mjs';

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

const blobs = new Map();
const blobOptions = [];
const extractionToken = 'vercel_blob_rw_test_token';
const store = makeExtractionJobStore({
  env: { EXTRACTION_BLOB_READ_WRITE_TOKEN: extractionToken },
  now: (() => { let value = Date.parse('2026-08-25T10:00:00Z'); return () => (value += 10); })(),
  async putBlob(path, body, options) {
    assert.equal(options.access, 'private');
    assert.equal(options.addRandomSuffix, false);
    assert.equal(options.token, extractionToken);
    blobOptions.push({ path, options });
    blobs.set(path, String(body));
  },
  async getBlob(path, options) {
    assert.equal(options.access, 'private');
    assert.equal(options.useCache, false);
    assert.equal(options.token, extractionToken);
    const body = blobs.get(path);
    return body == null ? null : { stream: new Response(body).body };
  },
  async deleteBlob(paths, options) {
    assert.equal(options.token, extractionToken);
    for (const path of Array.isArray(paths) ? paths : [paths]) blobs.delete(path);
  },
});

assert.equal(extractionBlobToken({ EXTRACTION_BLOB_READ_WRITE_TOKEN: extractionToken }), extractionToken);
assert.equal(extractionBlobToken({ BLOB_READ_WRITE_TOKEN: 'legacy-token' }), 'legacy-token');
assert.equal(extractionJobStoreConfigured({ EXTRACTION_BLOB_READ_WRITE_TOKEN: extractionToken }), true);
assert.equal(extractionJobStoreConfigured({ EXTRACTION_BLOB_STORE_ID: 'store', VERCEL_OIDC_TOKEN: 'oidc' }), true);

const scheduled = [];
const submitReq = {
  method: 'POST',
  url: '/api/extract-background',
  headers: {
    host: 'estimation.io',
    origin: 'https://estimation.io',
    'x-forwarded-proto': 'https',
    'x-forwarded-for': 'background-submit',
  },
  socket: {},
  body: {
    filename: 'schedule.pdf',
    page_number: 4,
    text_lines: ['Board reference DB-L1', 'Way 1 MCB C 20A'],
    hints: { type: 'db_schedule' },
  },
};
const submitRes = responseRecorder();
await handleBackgroundExtraction(submitReq, submitRes, {
  configured: () => true,
  engineStatus: () => ({ configured: true }),
  store,
  waitUntil(task) { scheduled.push(task); },
  async extract(request) {
    assert.match(request.instruction, /schedule\.pdf/);
    return { boards: [{ ref: 'DB-L1' }], devices: [{ board_ref: 'DB-L1', way: 1, device_class: 'MCB' }] };
  },
});

assert.equal(submitRes.statusCode, 202);
assert.equal(submitRes.json.status, 'pending');
assert.match(submitRes.json.jobId, /^[a-z0-9_-]{32,96}$/i);
assert.equal(scheduled.length, 1);
await scheduled[0];

const id = submitRes.json.jobId;
const statusReq = {
  method: 'GET',
  url: `/api/extract-status?id=${encodeURIComponent(id)}`,
  headers: { host: 'estimation.io', 'x-forwarded-proto': 'https', 'x-forwarded-for': 'background-status' },
  socket: {},
};
const statusRes = responseRecorder();
await handleExtractionStatus(statusReq, statusRes, { store });
assert.equal(statusRes.statusCode, 200);
assert.equal(statusRes.json.status, 'done');
assert.equal(statusRes.json.result.boards[0].ref, 'DB-L1');
assert.ok(Date.parse(statusRes.json.expiresAt) > Date.parse(statusRes.json.completedAt));
assert.ok([...blobs.keys()].every((path) => !path.endsWith('/pending.json')));
assert.ok([...blobs.values()].every((value) => !value.includes('Way 1 MCB C 20A')), 'source text is not persisted in job records');
assert.ok(blobOptions.every(({ path }) => path.includes('/estimation-extraction-jobs/v1/') || path.startsWith('estimation-extraction-jobs/v1/')));

const acknowledgeRes = responseRecorder();
await handleExtractionStatus({ ...statusReq, method: 'DELETE', headers: { ...statusReq.headers, 'x-forwarded-for': 'background-ack' } }, acknowledgeRes, { store });
assert.equal(acknowledgeRes.statusCode, 200);
assert.equal(acknowledgeRes.json.status, 'deleted');

const missingRes = responseRecorder();
await handleExtractionStatus({ ...statusReq, headers: { ...statusReq.headers, 'x-forwarded-for': 'background-missing' } }, missingRes, { store });
assert.equal(missingRes.statusCode, 404);
assert.equal(missingRes.json.status, 'missing');

const crossOriginRes = responseRecorder();
await handleBackgroundExtraction({
  ...submitReq,
  headers: { ...submitReq.headers, origin: 'https://example.invalid', 'x-forwarded-for': 'background-origin' },
}, crossOriginRes, { configured: () => true, engineStatus: () => ({ configured: true }), store, waitUntil() {} });
assert.equal(crossOriginRes.statusCode, 403);

const invalidStatusRes = responseRecorder();
await handleExtractionStatus({ ...statusReq, url: '/api/extract-status?id=../private', headers: { ...statusReq.headers, 'x-forwarded-for': 'background-invalid' } }, invalidStatusRes, { store });
assert.equal(invalidStatusRes.statusCode, 400);

let terminalClock = Date.parse('2026-08-25T11:00:00Z');
const expiringBlobs = new Map();
const expiringStore = makeExtractionJobStore({
  now: () => terminalClock,
  async putBlob(path, body) { expiringBlobs.set(path, String(body)); },
  async getBlob(path) {
    const body = expiringBlobs.get(path);
    return body == null ? null : { stream: new Response(body).body };
  },
  async deleteBlob(paths) {
    for (const path of Array.isArray(paths) ? paths : [paths]) expiringBlobs.delete(path);
  },
});
const expiringId = 'terminal_result_expiry_000000000001';
await expiringStore.create(expiringId);
await expiringStore.complete(expiringId, { boards: [] });
await expiringStore.finishProcessing(expiringId);
terminalClock += JOB_TTL_MS + 1;
assert.equal((await expiringStore.status(expiringId)).status, 'missing');
assert.equal(expiringBlobs.size, 0, 'an expired terminal result must be deleted on the next status read');

console.log('PASS: private Vercel background extraction lifecycle, durable delivery, acknowledgement, and guards');
