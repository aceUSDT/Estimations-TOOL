/* Baidu Cloud "Unlimited-OCR" document parser — the hosted route.
 *
 * WHY THIS EXISTS SEPARATELY FROM nvidia-pool.mjs
 * The self-hosted model (vLLM/SGLang) speaks OpenAI /chat/completions, so the
 * pool reaches it with a base URL and nothing else. Baidu's HOSTED service does
 * not: it is an asynchronous, proprietary REST API — submit a document, poll for
 * a task, then fetch a markdown result. Same model, different protocol, so it
 * needs its own client rather than another entry in MODEL_REGISTRY.
 *
 * WHY IT IS WORTH HAVING
 * It is the only route that needs no GPU. It also takes a WHOLE PDF — up to 500
 * pages, 100 MB — in a single submission, which is the opposite of the per-page
 * OCR loop this project keeps losing data in (PROJECT_HISTORY §2.13: one
 * unreadable page abandoned the sixteen behind it).
 *
 * CONFIGURE
 *   BAIDU_OCR_API_KEY      client_id  from the Baidu AI Cloud console
 *   BAIDU_OCR_SECRET_KEY   client_secret
 * Unset, every function here reports "not configured" and nothing is sent
 * anywhere. This can never become a hard dependency: the desktop build must keep
 * working from packaged assets with no network at all (CLAUDE.md).
 *
 * Docs: https://cloud.baidu.com/doc/OCR/s/fmr1p39gb
 */

export const BAIDU_TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
export const BAIDU_TASK_URL = 'https://aip.baidubce.com/rest/2.0/brain/online/v2/unlimited-ocr-parser/task';
export const BAIDU_QUERY_URL = `${BAIDU_TASK_URL}/query`;

/* Documented service limits. Submit is the tight one: 2 requests per second,
 * so two documents dropped at once will collide without pacing. */
export const SUBMIT_QPS = 2;
export const QUERY_QPS = 5;
/* Baidu accepts these; anything else is rejected after the upload, which on a
 * 100MB file is an expensive way to learn. Checked before sending. */
export const SUPPORTED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'txt', 'ppt', 'pptx']);
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_PDF_PAGES = 500;

export function unlimitedOcrCloudConfig(env = process.env) {
  const apiKey = String(env.BAIDU_OCR_API_KEY || '').trim();
  const secretKey = String(env.BAIDU_OCR_SECRET_KEY || '').trim();
  if (!apiKey || !secretKey) return null;
  return { apiKey, secretKey };
}

/* Errors carry a stable code and NEVER the key, the secret, the access token, or
 * the document. Baidu echoes error_code/error_msg, which are safe to surface;
 * the credential appears in the request URL, so a raw URL must never reach a
 * message or a log. */
function ocrError(code, detail) {
  const e = new Error(`unlimited-ocr-cloud: ${code}${detail ? ` (${detail})` : ''}`);
  e.code = code;
  return e;
}

/* Baidu's own failure codes, mapped to something a caller can branch on.
 * 17/18/19 are quota and rate limits — the operator's 200 free pages running
 * out is an ordinary Tuesday, not a bug, and must read as one. */
const QUOTA_CODES = new Set([17, 18, 19, 4, 111]);
export function classifyBaiduError(errorCode) {
  const n = Number(errorCode);
  if (!Number.isFinite(n) || n === 0) return null;
  if (QUOTA_CODES.has(n)) return 'quota_or_rate_limited';
  if (n === 110 || n === 111) return 'token_invalid';
  return `baidu_${n}`;
}

export function createUnlimitedOcrCloud(opts = {}) {
  const cfg = opts.config !== undefined ? opts.config : unlimitedOcrCloudConfig();
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now || (() => Date.now());
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  /* Baidu tokens are valid for ~30 days. Cached in memory and refreshed early,
     because a token that expires mid-poll turns a finished 400-page parse into
     a failure. */
  const tokenSkewMs = opts.tokenSkewMs != null ? opts.tokenSkewMs : 5 * 60 * 1000;
  let token = null;                      // { value, expiresAt }
  let lastSubmitAt = 0;

  const configured = Boolean(cfg);

  async function getToken() {
    if (!cfg) throw ocrError('not_configured');
    if (token && token.expiresAt - tokenSkewMs > now()) return token.value;
    const url = `${BAIDU_TOKEN_URL}?grant_type=client_credentials`
      + `&client_id=${encodeURIComponent(cfg.apiKey)}&client_secret=${encodeURIComponent(cfg.secretKey)}`;
    let res;
    try { res = await fetchImpl(url, { method: 'GET' }); }
    catch { throw ocrError('network', 'token'); }
    if (!res.ok) throw ocrError('token_http', String(res.status));
    let body;
    try { body = await res.json(); } catch { throw ocrError('bad_json', 'token'); }
    if (!body || !body.access_token) throw ocrError('token_denied', body && body.error ? String(body.error) : 'no token');
    token = { value: body.access_token, expiresAt: now() + (Number(body.expires_in) || 2592000) * 1000 };
    return token.value;
  }

  /* Submit is capped at 2 QPS by the service. Spacing here rather than
     retrying on 429 keeps a multi-document upload from burning its quota on
     rejected calls. */
  async function paceSubmit() {
    const minGap = Math.ceil(1000 / SUBMIT_QPS);
    const wait = lastSubmitAt + minGap - now();
    if (wait > 0) await sleep(wait);
    lastSubmitAt = now();
  }

  function checkDocument({ fileName, fileBase64 }) {
    const name = String(fileName || '').trim();
    if (!name) throw ocrError('file_name_required');
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    if (!SUPPORTED_EXTENSIONS.has(ext)) throw ocrError('unsupported_type', ext || 'none');
    if (fileBase64) {
      /* base64 inflates by 4/3; check the DECODED size, which is what the
         service limits. Sending 100MB to be told no is slow and, on a metered
         connection, not free. */
      const bytes = Math.floor(String(fileBase64).length * 3 / 4);
      if (bytes > MAX_FILE_BYTES) throw ocrError('file_too_large', `${Math.round(bytes / 1048576)}MB`);
    }
  }

  async function submit({ fileBase64, fileUrl, fileName }) {
    if (!cfg) throw ocrError('not_configured');
    if (!fileBase64 && !fileUrl) throw ocrError('no_document');
    checkDocument({ fileName, fileBase64 });
    const accessToken = await getToken();
    await paceSubmit();
    const form = new URLSearchParams();
    form.set('file_name', String(fileName));
    if (fileBase64) form.set('file_data', String(fileBase64));
    else form.set('file_url', String(fileUrl));

    let res;
    try {
      res = await fetchImpl(`${BAIDU_TASK_URL}?access_token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
    } catch { throw ocrError('network', 'submit'); }
    if (!res.ok) throw ocrError('submit_http', String(res.status));
    let body;
    try { body = await res.json(); } catch { throw ocrError('bad_json', 'submit'); }
    const kind = classifyBaiduError(body && body.error_code);
    if (kind) {
      /* An expired token is recoverable exactly once: drop it and let the
         caller retry against a fresh one. */
      if (kind === 'token_invalid') token = null;
      throw ocrError(kind, body.error_msg ? String(body.error_msg) : '');
    }
    const taskId = body && body.result && body.result.task_id;
    if (!taskId) throw ocrError('no_task_id');
    return { taskId: String(taskId) };
  }

  async function queryTask(taskId) {
    if (!cfg) throw ocrError('not_configured');
    const accessToken = await getToken();
    const form = new URLSearchParams();
    form.set('task_id', String(taskId));
    let res;
    try {
      res = await fetchImpl(`${BAIDU_QUERY_URL}?access_token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
    } catch { throw ocrError('network', 'query'); }
    if (!res.ok) throw ocrError('query_http', String(res.status));
    let body;
    try { body = await res.json(); } catch { throw ocrError('bad_json', 'query'); }
    const kind = classifyBaiduError(body && body.error_code);
    if (kind) { if (kind === 'token_invalid') token = null; throw ocrError(kind, body.error_msg ? String(body.error_msg) : ''); }
    const result = (body && body.result) || {};
    return {
      status: String(result.status || 'unknown'),
      markdownUrl: result.markdown_url || null,
      parseResultUrl: result.parse_result_url || null,
    };
  }

  /* Submit, then poll until the task finishes. A 500-page document is not a
   * quick call, so the wait is bounded by wall time rather than by a poll count
   * — and it returns WHY it stopped instead of throwing a bare timeout, because
   * "still running when we gave up" and "the service refused it" want different
   * responses from a human. */
  async function parseDocument(input, o = {}) {
    const maxWaitMs = o.maxWaitMs != null ? o.maxWaitMs : 15 * 60 * 1000;
    const pollMs = o.pollMs != null ? o.pollMs : Math.ceil(1000 / QUERY_QPS) * 2;
    const { taskId } = await submit(input);
    const startedAt = now();
    let last = null;
    while (now() - startedAt < maxWaitMs) {
      await sleep(pollMs);
      last = await queryTask(taskId);
      const status = last.status.toLowerCase();
      if (status === 'success' || status === 'succeeded' || status === 'done') {
        return { taskId, ...last, timedOut: false };
      }
      if (status === 'failed' || status === 'failure' || status === 'error') {
        throw ocrError('task_failed', taskId);
      }
    }
    return { taskId, ...(last || { status: 'unknown', markdownUrl: null, parseResultUrl: null }), timedOut: true };
  }

  /* The parsed document itself. Kept separate from parseDocument so a caller can
     store the URL and fetch later — Baidu's result URLs are time-limited, so a
     long-running take-off should fetch promptly rather than at export time. */
  async function fetchMarkdown(markdownUrl) {
    if (!markdownUrl) throw ocrError('no_markdown_url');
    let res;
    try { res = await fetchImpl(String(markdownUrl), { method: 'GET' }); }
    catch { throw ocrError('network', 'markdown'); }
    if (!res.ok) throw ocrError('markdown_http', String(res.status));
    try { return await res.text(); } catch { throw ocrError('markdown_unreadable'); }
  }

  return { configured, getToken, submit, queryTask, parseDocument, fetchMarkdown, checkDocument };
}
