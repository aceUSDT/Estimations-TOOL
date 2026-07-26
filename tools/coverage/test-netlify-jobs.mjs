/* Regression test: the hosted extraction endpoints — background job writer
 * (extract-background.mjs), poll endpoint (extract-status.mjs), and the
 * synchronous endpoint's provider-error mapping (extract.mjs).
 *
 * No network and no API key: @netlify/blobs and the provider module are
 * redirected to the stubs in ./stubs, so the handlers themselves run as
 * shipped. What is pinned here is the contract the browser depends on — a
 * terminal record is always written, a poll never leaks a partial result, and
 * a provider failure maps to a stable HTTP status.
 */
import path from 'node:path';
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
register('./stubs/loader.mjs', import.meta.url);

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;

const { default: background } = await import(pathToFileURL(path.resolve(HERE, '../../netlify/functions/extract-background.mjs')));
const { default: status } = await import(pathToFileURL(path.resolve(HERE, '../../netlify/functions/extract-status.mjs')));
const { default: extract } = await import(pathToFileURL(path.resolve(HERE, '../../netlify/functions/extract.mjs')));

let fail = 0;
const check = (name, cond, detail) => {
  if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; }
};

const store = () => globalThis.__blobs.records.get('extractions') || new Map();
const post = (url, body) => new Request(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const reset = () => {
  globalThis.__blobs.records.clear();
  globalThis.__blobs.fail = { setJSON: false, get: false, delete: false };
  globalThis.__extraction = {};
  globalThis.__extractionCalls = [];
};

/* ---------- extract-background: always 202, result lands in the store ---- */
reset();
let res = await background(post('http://x/extract-background', 'not json'));
check('background: unparseable body → 202', res.status === 202);
check('background: no job id → nothing stored', store().size === 0);

reset();
res = await background(post('http://x/extract-background', { job_id: 'job-empty', filename: 'a.pdf' }));
check('background: page with no image and no text → 202', res.status === 202);
let rec = store().get('job-empty');
check('background: empty page recorded as error', rec && rec.status === 'error' && /image_base64/.test(rec.error), JSON.stringify(rec));

reset();
res = await background(post('http://x/extract-background', { job_id: 'job-blank-lines', text_lines: [] }));
check('background: empty text_lines is not a page', store().get('job-blank-lines')?.status === 'error');

reset();
globalThis.__extraction = { result: { result: { devices: [{ way: 1 }] }, model: 'test-model', provider: 'anthropic', verification: null } };
res = await background(post('http://x/extract-background', {
  job_id: 'job-ok', filename: 'schedule.pdf', page_number: 4, text_lines: ['WAY 1 32A MCB'], hints: { type: 'db_schedule' },
}));
rec = store().get('job-ok');
check('background: success recorded as done', res.status === 202 && rec && rec.status === 'done');
check('background: result carried into the record', rec.result && rec.result.devices.length === 1 && rec.model === 'test-model');
const args = globalThis.__extractionCalls[0];
check('background: instruction built from filename/page/hint/lines',
  args.instruction.includes('schedule.pdf') && args.instruction.includes('page 4')
  && args.instruction.includes('db_schedule') && args.instruction.includes('WAY 1 32A MCB'));
check('background: text-only page sends no image', args.imageBase64 === undefined);
check('background: background budget is the larger one', args.maxTokens === 16000);

reset();
globalThis.__extraction = { result: { result: { devices: [] } } };
await background(post('http://x/extract-background', { job_id: 'job-image', image_base64: 'AAAA', media_type: 'image/png' }));
check('background: image-only page accepted', store().get('job-image')?.status === 'done');
check('background: image forwarded to the provider', globalThis.__extractionCalls[0].imageBase64 === 'AAAA');

reset();
globalThis.__extraction = { error: new Error('provider exploded') };
await background(post('http://x/extract-background', { job_id: 'job-fail', text_lines: ['ROW'] }));
rec = store().get('job-fail');
check('background: provider failure recorded as error', rec && rec.status === 'error' && rec.error === 'provider exploded');

reset();
globalThis.__blobs.fail.setJSON = true;
globalThis.__extraction = { result: { result: { devices: [] } } };
res = await background(post('http://x/extract-background', { job_id: 'job-store-down', text_lines: ['ROW'] }));
check('background: unwritable store still answers 202', res.status === 202);

/* ---------- extract-status: pending until terminal, then one-shot -------- */
reset();
res = await status(new Request('http://x/extract-status'));
check('status: missing id → 400', res.status === 400);

res = await status(new Request('http://x/extract-status?id=unknown'));
check('status: unknown job → pending', res.status === 200 && (await res.json()).status === 'pending');

store().set('job-pending', { status: 'pending' });
res = await status(new Request('http://x/extract-status?id=job-pending'));
check('status: in-flight job stays in the store', (await res.json()).status === 'pending' && store().has('job-pending'));

store().set('job-done', { status: 'done', result: { devices: [] }, model: 'test-model' });
res = await status(new Request('http://x/extract-status?id=job-done'));
let body = await res.json();
check('status: done record returned', body.status === 'done' && body.model === 'test-model');
check('status: terminal record deleted after collection', !store().has('job-done'));
check('status: content-type is json', res.headers.get('content-type') === 'application/json');
res = await status(new Request('http://x/extract-status?id=job-done'));
check('status: collected job reads as pending, never a stale result', (await res.json()).status === 'pending');

store().set('job-error', { status: 'error', error: 'provider exploded' });
res = await status(new Request('http://x/extract-status?id=job-error'));
body = await res.json();
check('status: error record returned and cleaned up', body.error === 'provider exploded' && !store().has('job-error'));

store().set('job-undeletable', { status: 'done', result: { devices: [] } });
globalThis.__blobs.fail.delete = true;
res = await status(new Request('http://x/extract-status?id=job-undeletable'));
check('status: failed cleanup does not lose the result', (await res.json()).status === 'done');
globalThis.__blobs.fail.delete = false;

globalThis.__blobs.fail.get = true;
res = await status(new Request('http://x/extract-status?id=job-done'));
check('status: unreadable store → pending, not an error', res.status === 200 && (await res.json()).status === 'pending');
globalThis.__blobs.fail.get = false;

/* ---------- extract: provider failures map to stable statuses ------------ */
reset();
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-real-key';
const page = { filename: 'a.pdf', page_number: 1, text_lines: ['WAY 1 32A MCB'] };

globalThis.__extraction = { result: { result: { devices: [{ way: 1 }] }, provider: 'anthropic', verification: null } };
res = await extract(post('http://x/extract', page));
body = await res.json();
check('extract: success → 200 with the extraction', res.status === 200 && body.result.devices.length === 1);
check('extract: synchronous budget stays under the Netlify cap', globalThis.__extractionCalls[0].maxTokens === 12000);

globalThis.__extraction = { error: Object.assign(new Error('not configured'), { http: 503 }) };
res = await extract(post('http://x/extract', page));
check('extract: err.http honoured', res.status === 503 && (await res.json()).error === 'not configured');

globalThis.__extraction = { error: Object.assign(new Error('slow down'), { status: 429 }) };
res = await extract(post('http://x/extract', page));
check('extract: 429 → 429 retry hint', res.status === 429 && /retry/i.test((await res.json()).error));

globalThis.__extraction = { error: Object.assign(new Error('bad key'), { status: 401 }) };
res = await extract(post('http://x/extract', page));
check('extract: 401 → 503 rotate-the-key', res.status === 503 && /rotate/i.test((await res.json()).error));

globalThis.__extraction = { error: new Error('socket hang up') };
res = await extract(post('http://x/extract', page));
check('extract: unknown failure → 502', res.status === 502 && /socket hang up/.test((await res.json()).error));

globalThis.__extraction = { error: 'thrown string' };
res = await extract(post('http://x/extract', page));
check('extract: non-Error failure still maps to 502', res.status === 502);
delete process.env.ANTHROPIC_API_KEY;

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: background job writer, poll endpoint, and extract error mapping.');
