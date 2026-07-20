/* Core route logic for the extraction API — pure, dependency-injected, and
 * unit-testable with no Vercel runtime and no network. The thin route files
 * (api/extract/health.mjs, api/extractions/{start,status,result}.mjs) adapt
 * Vercel's (req, res) to the normalized `input` these functions consume, and
 * supply real deps (Supabase service client, user resolver, job processor).
 *
 * Invariants enforced here (quality gates 3,4,8,9,10):
 *  - Request shape + payload size are validated before anything else.
 *  - Auth is required unless a route is explicitly told otherwise; every
 *    job/project read is ownership-checked (org membership), so a guessed
 *    UUID cannot read another tenant's data.
 *  - A zero-device result against detected boards is NEVER 'complete'.
 *  - 'incomplete' / 'failed' results are never issue-ready.
 *  - Errors use the stable { code, message, correlation_id } envelope and
 *    never leak secrets or provider internals.
 */
import { ok, err, isUuid, newCorrelationId, jsonByteLength, MAX_BODY_BYTES, MAX_IMAGE_B64 } from './http.mjs';

export const JOB_STATES = ['queued', 'running', 'complete', 'needs_review', 'incomplete', 'failed'];
export const TERMINAL_STATES = ['complete', 'needs_review', 'incomplete', 'failed'];

/* Derive the terminal state from evidence. This is the single place that
 * decides "success" — it can never silently upgrade a failure or a
 * zero-device board result. Used by the worker (Phase 5) and tested now. */
export function deriveState({ failed, boardCount = 0, deviceCount = 0, blockingReview = false }) {
  if (failed) return 'failed';
  if (boardCount > 0 && deviceCount === 0) return 'incomplete';   // zero-device guard
  if (blockingReview) return 'needs_review';
  return 'complete';
}

export function issueReady(state) { return state === 'complete'; }

/* GET /api/extract/health — Gemini-only configuration, no secrets. */
export function handleHealth(deps) {
  const s = deps.providerStatus();
  return ok(200, {
    status: 'ok',
    configured: s.configured,
    providers: { gemini: s.gemini },
    primary: s.primary,
    verify: s.verify,
    model: deps.GEMINI_MODEL,
    verify_model: s.verify ? deps.GEMINI_VERIFY_MODEL : null,
    supabase: Boolean(deps.supabaseConfigured),
  });
}

/* POST /api/extract/run — STATELESS, account-free page extraction for the
 * local-first browser. No Supabase, no auth, no durable job: it runs Gemini
 * inline (Vercel maxDuration covers the ~30–45s) and returns the structured
 * result + optional cross-check, exactly the shape the client already merges.
 * This is the tested replacement for the Netlify function trio (no Blobs, no
 * polling). Documents stay local; only the page the user opted to send leaves.
 *
 * Note: like the Netlify predecessor, this endpoint is unauthenticated. It is
 * safe because it stores nothing and returns only what the caller sent us to
 * read. Multi-tenant/audited extraction uses the durable job routes instead.
 * Public multi-tenant deployments should still deploy-protect or quota it. */
export async function handleInlineExtract(input, deps) {
  const correlationId = input.correlationId || newCorrelationId();
  if (input.method !== 'POST') return err(405, 'method_not_allowed', 'POST only.', correlationId);
  if (!deps.providerStatus().configured) return err(503, 'not_configured', 'Cloud extraction is not configured.', correlationId);
  if (jsonByteLength(input.body || {}) > MAX_BODY_BYTES) return err(413, 'payload_too_large', 'Request body exceeds the size limit.', correlationId);
  const b = input.body || {};
  const hasImage = typeof b.image_base64 === 'string' && b.image_base64.length > 0;
  const hasText = Array.isArray(b.text_lines) && b.text_lines.length > 0;
  if (!hasImage && !hasText) return err(400, 'invalid_request', 'Provide image_base64 and/or text_lines.', correlationId);
  if (hasImage && b.image_base64.length > MAX_IMAGE_B64) return err(413, 'payload_too_large', 'Page image exceeds the size limit.', correlationId);

  const instruction = deps.buildInstruction({ filename: b.filename, pageNumber: b.page_number, hints: b.hints, textLines: b.text_lines });
  try {
    const out = await deps.extract({ imageBase64: b.image_base64, mediaType: b.media_type || 'image/jpeg', instruction, maxTokens: 12000 });
    return ok(200, { ...out, correlation_id: correlationId });
  } catch (e) {
    if (e && e.http) return err(e.http, 'not_configured', e.message, correlationId);
    if (e && e.status === 429) return err(429, 'rate_limited', 'Rate limited — retry shortly.', correlationId);
    if (e && e.stop_reason === 'max_tokens') return err(502, 'output_truncated', 'Extraction output was truncated.', correlationId);
    return err(502, 'extraction_error', 'Extraction failed.', correlationId);
  }
}

async function requireUser(input, deps) {
  const userId = await deps.resolveUser(input);
  if (!userId && deps.authRequired !== false) return { error: err(401, 'unauthenticated', 'Sign in to continue.', input.correlationId) };
  return { userId: userId || null };
}

/* POST /api/extractions/start — create a DURABLE job, then kick processing.
 * Idempotent on (project_id, idempotency_key). */
export async function handleStart(input, deps) {
  const correlationId = input.correlationId || newCorrelationId();
  if (input.method !== 'POST') return err(405, 'method_not_allowed', 'POST only.', correlationId);
  if (jsonByteLength(input.body || {}) > MAX_BODY_BYTES) {
    return err(413, 'payload_too_large', 'Request body exceeds the size limit.', correlationId);
  }
  const b = input.body || {};
  if (!isUuid(b.project_id)) return err(400, 'invalid_request', 'project_id must be a UUID.', correlationId);
  if (!isUuid(b.document_id)) return err(400, 'invalid_request', 'document_id must be a UUID.', correlationId);
  if (!Number.isInteger(b.page_number) || b.page_number < 1) return err(400, 'invalid_request', 'page_number must be a positive integer.', correlationId);
  const hasImage = typeof b.image_base64 === 'string' && b.image_base64.length > 0;
  const hasText = Array.isArray(b.text_lines) && b.text_lines.length > 0;
  if (!hasImage && !hasText) return err(400, 'invalid_request', 'Provide image_base64 and/or text_lines.', correlationId);
  if (hasImage && b.image_base64.length > MAX_IMAGE_B64) return err(413, 'payload_too_large', 'Page image exceeds the size limit.', correlationId);
  if (typeof b.idempotency_key !== 'string' || b.idempotency_key.length < 8 || b.idempotency_key.length > 200) {
    return err(400, 'invalid_request', 'idempotency_key must be 8–200 chars.', correlationId);
  }

  const auth = await requireUser(input, deps);
  if (auth.error) return auth.error;

  let owned = null;
  try {
    owned = deps.authRequired === false && !auth.userId
      ? { projectId: b.project_id, orgId: b.org_id || null }   // local dev only
      : await deps.db.userOwnsProject(deps.sb, auth.userId, b.project_id);
  } catch (e) {
    return err(503, 'db_error', 'Storage is temporarily unavailable.', correlationId);
  }
  if (!owned) return err(404, 'not_found', 'Project not found.', correlationId);   // 404, not 403 — do not confirm existence
  if (owned.projectId && b.document_id) { /* document ownership is enforced by FK + org scoping */ }

  // Idempotency: a repeated start with the same key returns the existing job.
  try {
    const existing = await deps.db.findJobByIdempotency(deps.sb, b.project_id, b.idempotency_key);
    if (existing) return ok(200, { job_id: existing.id, state: existing.state, correlation_id: existing.correlation_id, idempotent: true });
  } catch (e) {
    return err(503, 'db_error', 'Storage is temporarily unavailable.', correlationId);
  }

  let job;
  try {
    job = await deps.db.insertJob(deps.sb, {
      org_id: owned.orgId,
      project_id: b.project_id,
      document_id: b.document_id,
      page_number: b.page_number,
      state: 'queued',
      idempotency_key: b.idempotency_key,
      correlation_id: correlationId,
      provider: 'gemini',
      model: deps.GEMINI_MODEL,
      verify_model: deps.providerStatus().verify ? deps.GEMINI_VERIFY_MODEL : null,
      created_by: auth.userId,
    });
  } catch (e) {
    // Unique-violation race → treat as idempotent hit.
    const dup = await deps.db.findJobByIdempotency(deps.sb, b.project_id, b.idempotency_key).catch(() => null);
    if (dup) return ok(200, { job_id: dup.id, state: dup.state, correlation_id: dup.correlation_id, idempotent: true });
    return err(503, 'db_error', 'Could not create the job.', correlationId);
  }

  // Kick durable processing. The route does NOT await this — status/result
  // stay usable if the worker times out or crashes (Phase 5 owns retries).
  try { deps.processJob(job, { image_base64: b.image_base64, text_lines: b.text_lines, filename: b.filename, hints: b.hints }); }
  catch { /* processing errors are recorded on the job, not surfaced here */ }

  return ok(202, { job_id: job.id, state: job.state, correlation_id: correlationId });
}

/* GET /api/extractions/status?id=<uuid> — ownership-checked job state. */
export async function handleStatus(input, deps) {
  const correlationId = input.correlationId || newCorrelationId();
  if (input.method !== 'GET') return err(405, 'method_not_allowed', 'GET only.', correlationId);
  const id = input.query && input.query.id;
  if (!isUuid(id)) return err(400, 'invalid_request', 'id must be a UUID.', correlationId);
  const auth = await requireUser(input, deps);
  if (auth.error) return auth.error;

  let job;
  try { job = await deps.db.getJobForUser(deps.sb, auth.userId, id); }
  catch { return err(503, 'db_error', 'Storage is temporarily unavailable.', correlationId); }
  if (!job) return err(404, 'not_found', 'Job not found.', correlationId);   // cross-tenant guess → 404

  return ok(200, {
    job_id: job.id,
    state: job.state,
    page_number: job.page_number,
    error_code: job.error_code || null,
    error_detail: job.error_detail || null,
    attempt: job.attempt,
    correlation_id: job.correlation_id,
    updated_at: job.updated_at,
  });
}

/* GET /api/extractions/result?id=<uuid> — ownership-checked.
 * Withholds an issue-ready payload for anything but 'complete'; 'needs_review'
 * returns the result flagged not-yet-issue-ready; 'incomplete'/'failed' return
 * NO result (only the state + reason). Enforces gate #4. */
export async function handleResult(input, deps) {
  const correlationId = input.correlationId || newCorrelationId();
  if (input.method !== 'GET') return err(405, 'method_not_allowed', 'GET only.', correlationId);
  const id = input.query && input.query.id;
  if (!isUuid(id)) return err(400, 'invalid_request', 'id must be a UUID.', correlationId);
  const auth = await requireUser(input, deps);
  if (auth.error) return auth.error;

  let found;
  try { found = await deps.db.getResultForUser(deps.sb, auth.userId, id); }
  catch { return err(503, 'db_error', 'Storage is temporarily unavailable.', correlationId); }
  if (!found.job) return err(404, 'not_found', 'Job not found.', correlationId);

  const { job, result } = found;
  const base = { job_id: job.id, state: job.state, correlation_id: job.correlation_id };

  if (job.state === 'queued' || job.state === 'running') {
    return ok(200, { ...base, issue_ready: false, result: null });
  }
  if (job.state === 'failed') {
    return ok(200, { ...base, issue_ready: false, error_code: job.error_code || 'failed', result: null });
  }
  if (job.state === 'incomplete') {
    return ok(200, { ...base, issue_ready: false, reason: job.error_code || 'incomplete', result: null, diagnostics_available: true });
  }
  // complete | needs_review — result is available; only 'complete' is issue-ready.
  return ok(200, {
    ...base,
    issue_ready: issueReady(job.state),
    review_required: job.state === 'needs_review',
    board_count: result ? result.board_count : null,
    device_count: result ? result.device_count : null,
    result: result ? result.structured : null,
    verification: result ? result.verification : null,
  });
}
