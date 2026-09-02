/* Baidu Cloud Unlimited-OCR client — every path through injected fakes.
 *
 * No network, no credentials. The properties that matter to the product:
 *   - unconfigured is a first-class state; nothing is sent anywhere
 *   - the whole submit → poll → fetch cycle works, because that async shape is
 *     the reason this needed its own client instead of a MODEL_REGISTRY entry
 *   - quota exhaustion reads as quota exhaustion. 200 free pages runs out on an
 *     ordinary Tuesday, and an estimator must not see it as a parse failure
 *   - no error, ever, carries the API key, the secret, or the access token
 */
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const load = (p) => import(pathToFileURL(path.resolve(ROOT, '..', p)));

const {
  createUnlimitedOcrCloud, unlimitedOcrCloudConfig, classifyBaiduError,
  BAIDU_TASK_URL, SUPPORTED_EXTENSIONS, MAX_FILE_BYTES,
} = await load('api/_lib/extraction/unlimited-ocr-cloud.mjs');

let fail = 0;
const check = (name, cond, detail) => { if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; } };

const CFG = { apiKey: 'AK-not-a-real-key', secretKey: 'SK-not-a-real-secret' };
const noSleep = async () => {};

/* A fake service. Records every URL so the tests can assert what was sent, and
   so the credential-leak check has something real to scan. */
function fakeBaidu({ tokenBody, submitBody, queryBodies = [], markdown = '# parsed' } = {}) {
  const seen = [];
  let queryCount = 0;
  const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const impl = async (url, init) => {
    seen.push({ url: String(url), body: init && init.body ? String(init.body) : null });
    if (String(url).includes('/oauth/2.0/token')) {
      return json(tokenBody || { access_token: 'TOKEN-abc', expires_in: 2592000 });
    }
    if (String(url).includes('/task/query')) {
      const b = queryBodies[Math.min(queryCount++, queryBodies.length - 1)];
      return json(b || { error_code: 0, result: { status: 'success', markdown_url: 'https://x/md', parse_result_url: 'https://x/json' } });
    }
    if (String(url).includes('/unlimited-ocr-parser/task')) {
      return json(submitBody || { error_code: 0, result: { task_id: 'task-1' } });
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => markdown };
  };
  return { impl, seen };
}

/* ---- configuration ---- */
check('unconfigured when neither key is set', unlimitedOcrCloudConfig({}) === null);
check('unconfigured when only the API key is set',
  unlimitedOcrCloudConfig({ BAIDU_OCR_API_KEY: 'x' }) === null);
check('configured when both are set',
  Boolean(unlimitedOcrCloudConfig({ BAIDU_OCR_API_KEY: 'x', BAIDU_OCR_SECRET_KEY: 'y' })));

{
  /* THE CASE THAT MATTERS MOST: no credentials. Nobody who has not signed up for
     Baidu Cloud may lose anything, and nothing may be sent anywhere. */
  const { impl, seen } = fakeBaidu();
  const client = createUnlimitedOcrCloud({ config: null, fetchImpl: impl, sleep: noSleep });
  check('unconfigured client reports it', client.configured === false);
  let code = null;
  try { await client.submit({ fileBase64: 'AAAA', fileName: 'a.pdf' }); } catch (e) { code = e.code; }
  check('unconfigured submit ⇒ not_configured', code === 'not_configured', String(code));
  check('unconfigured ⇒ nothing sent anywhere', seen.length === 0, JSON.stringify(seen));
}

/* ---- the full async cycle ---- */
{
  const { impl, seen } = fakeBaidu({
    queryBodies: [
      { error_code: 0, result: { status: 'running' } },
      { error_code: 0, result: { status: 'success', markdown_url: 'https://x/md', parse_result_url: 'https://x/json' } },
    ],
  });
  const client = createUnlimitedOcrCloud({ config: CFG, fetchImpl: impl, sleep: noSleep });
  const out = await client.parseDocument({ fileBase64: 'AAAA', fileName: 'tender.pdf' }, { pollMs: 1 });
  check('parseDocument returns the task id', out.taskId === 'task-1', out.taskId);
  check('parseDocument polls past "running" to success', out.status === 'success', out.status);
  check('parseDocument returns the markdown url', out.markdownUrl === 'https://x/md', String(out.markdownUrl));
  check('parseDocument did not time out', out.timedOut === false);
  check('a token was fetched before submitting', seen[0].url.includes('/oauth/2.0/token'));
  check('the document was submitted to the task endpoint', seen[1].url.startsWith(BAIDU_TASK_URL), seen[1].url.split('?')[0]);
  check('the file name is sent (the service requires it)', seen[1].body.includes('file_name=tender.pdf'), seen[1].body.slice(0, 80));

  const md = await client.fetchMarkdown('https://x/md');
  check('the parsed markdown comes back', typeof md === 'string' && md.length > 0);
}

/* ---- a document that will never be accepted ---- */
{
  const { impl, seen } = fakeBaidu();
  const client = createUnlimitedOcrCloud({ config: CFG, fetchImpl: impl, sleep: noSleep });
  for (const [name, why] of [['drawing.dwg', 'an unsupported CAD file'], ['scan', 'no extension at all']]) {
    let code = null;
    try { await client.submit({ fileBase64: 'AAAA', fileName: name }); } catch (e) { code = e.code; }
    check(`rejected before upload: ${why}`, code === 'unsupported_type' || code === 'file_name_required', String(code));
  }
  /* Checked BEFORE sending: learning that 100MB was too big by uploading it is
     slow, and on a metered connection it is not free. */
  let code = null;
  const tooBig = 'A'.repeat(Math.ceil((MAX_FILE_BYTES + 1024) * 4 / 3));
  try { await client.submit({ fileBase64: tooBig, fileName: 'huge.pdf' }); } catch (e) { code = e.code; }
  check('an oversized document is rejected before it is uploaded', code === 'file_too_large', String(code));
  check('nothing was uploaded for any rejected document',
    seen.every((s) => !s.url.includes('/unlimited-ocr-parser/task')), JSON.stringify(seen.map((s) => s.url.split('?')[0])));

  check('the supported list matches what the service documents',
    ['pdf', 'jpg', 'png', 'docx'].every((e) => SUPPORTED_EXTENSIONS.has(e)) && !SUPPORTED_EXTENSIONS.has('dwg'));
}

/* ---- quota, which is an ordinary outcome and not a failure ---- */
{
  const { impl } = fakeBaidu({ submitBody: { error_code: 17, error_msg: 'Open api daily request limit reached' } });
  const client = createUnlimitedOcrCloud({ config: CFG, fetchImpl: impl, sleep: noSleep });
  let err = null;
  try { await client.submit({ fileBase64: 'AAAA', fileName: 'a.pdf' }); } catch (e) { err = e; }
  check('quota exhaustion reads as quota, not as a parse failure',
    err && err.code === 'quota_or_rate_limited', err && err.code);
  check('classifyBaiduError: 0 is not an error', classifyBaiduError(0) === null);
  check('classifyBaiduError: 17/18/19 are quota', ['quota_or_rate_limited'].includes(classifyBaiduError(18)));
  check('classifyBaiduError: an unknown code is still reported', classifyBaiduError(216630) === 'baidu_216630');
}

/* ---- credentials must never appear in an error ---- */
{
  /* The token call must SUCCEED and the submit must fail, or getToken throws
     first and the submit path is never reached — which is exactly how the first
     version of this check passed while a deliberately leaked credential in the
     submit handler went undetected. Found by mutation, not by reading it. */
  const failOnSubmit = async (url) => {
    if (String(url).includes('/oauth/2.0/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'TOKEN-abc', expires_in: 2592000 }) };
    }
    throw new Error('boom');
  };
  const client = createUnlimitedOcrCloud({ config: CFG, fetchImpl: failOnSubmit, sleep: noSleep });
  let err = null;
  try { await client.submit({ fileBase64: 'AAAA', fileName: 'a.pdf' }); } catch (e) { err = e; }
  check('a submit network failure is reported as such', err && err.code === 'network', err && err.code);
  const text = err ? `${err.message} ${err.stack || ''}` : '';
  check('no API key in a submit error', !text.includes(CFG.apiKey), text.slice(0, 120));
  check('no secret in a submit error', !text.includes(CFG.secretKey));

  /* And the token path, which is where the credential actually travels in the
     URL — a raw request URL reaching a message or a log would expose both. */
  const failOnToken = async () => { throw new Error('boom'); };
  const c0 = createUnlimitedOcrCloud({ config: CFG, fetchImpl: failOnToken, sleep: noSleep });
  let e0 = null;
  try { await c0.getToken(); } catch (e) { e0 = e; }
  const t0 = e0 ? `${e0.message} ${e0.stack || ''}` : '';
  check('no credential in a token error', !t0.includes(CFG.apiKey) && !t0.includes(CFG.secretKey));

  /* And on a service-side rejection, where the credential sat in the URL. */
  const { impl } = fakeBaidu({ tokenBody: { error: 'invalid_client', error_description: 'unknown client id' } });
  const c2 = createUnlimitedOcrCloud({ config: CFG, fetchImpl: impl, sleep: noSleep });
  let e2 = null;
  try { await c2.getToken(); } catch (e) { e2 = e; }
  check('a denied token says so', e2 && e2.code === 'token_denied', e2 && e2.code);
  const t2 = e2 ? `${e2.message} ${e2.stack || ''}` : '';
  check('a denied token leaks neither key nor secret',
    !t2.includes(CFG.apiKey) && !t2.includes(CFG.secretKey));
}

/* ---- the token is reused, not re-fetched per call ---- */
{
  const { impl, seen } = fakeBaidu();
  const client = createUnlimitedOcrCloud({ config: CFG, fetchImpl: impl, sleep: noSleep });
  await client.submit({ fileBase64: 'AAAA', fileName: 'a.pdf' });
  await client.submit({ fileBase64: 'AAAA', fileName: 'b.pdf' });
  const tokenCalls = seen.filter((s) => s.url.includes('/oauth/2.0/token')).length;
  check('the token is fetched once and reused', tokenCalls === 1, String(tokenCalls));
}

/* ---- a long parse that never finishes reports WHY ---- */
{
  const { impl } = fakeBaidu({ queryBodies: [{ error_code: 0, result: { status: 'running' } }] });
  let clock = 0;
  const client = createUnlimitedOcrCloud({
    config: CFG, fetchImpl: impl, sleep: async () => { clock += 1000; }, now: () => clock,
  });
  const out = await client.parseDocument({ fileBase64: 'AAAA', fileName: 'big.pdf' }, { maxWaitMs: 5000, pollMs: 1 });
  check('an unfinished parse returns timedOut rather than throwing', out.timedOut === true, JSON.stringify(out));
  check('an unfinished parse still returns its task id to resume from', out.taskId === 'task-1');
}

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: Baidu Cloud Unlimited-OCR client — unconfigured is safe, the async cycle works, quota reads as quota, no credential leaks.');
