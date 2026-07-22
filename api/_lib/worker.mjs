/* Durable job processor. `processJob` is kicked (not awaited) by the start
 * route; status/result routes read Supabase independently, so they keep
 * working if this crashes or times out.
 *
 * Phase 5 hardening:
 *  - heartbeat writes while the extraction is in flight, so the watchdog can
 *    detect a crashed/timed-out worker (see watchdog.mjs);
 *  - bounded retries for transient provider errors (429 / 5xx), with a small
 *    backoff, recorded on the job's attempt counter;
 *  - failures are recorded as `failed` with a stable machine code — never
 *    silently converted into a successful result, and never leaking provider
 *    internals.
 *
 * "AI extracts, code computes": the model returns structured page data; the
 * terminal state is decided by deterministic code (deriveState), which can
 * never upgrade a zero-device-with-boards page to `complete`.
 */
import { deriveState } from './handlers.mjs';

const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const DEFAULT_HEARTBEAT_MS = 10000;
const DEFAULT_MAX_ATTEMPTS = 2;

function countPage(result) {
  const boards = Array.isArray(result && result.boards) ? result.boards : [];
  const devices = Array.isArray(result && result.devices) ? result.devices : [];
  const countable = devices.filter((d) => d && d.device_class && !['space', 'spare'].includes(d.device_class));
  return { boardCount: boards.length, deviceCount: countable.length };
}

const realTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export function makeProcessJob(deps) {
  // deps: { sb, db, extract, buildInstruction, now?, timers?, heartbeatMs?, maxAttempts? }
  const now = deps.now || (() => new Date().toISOString());
  const timers = deps.timers || realTimers;
  const heartbeatMs = deps.heartbeatMs != null ? deps.heartbeatMs : DEFAULT_HEARTBEAT_MS;
  const maxAttempts = deps.maxAttempts != null ? deps.maxAttempts : DEFAULT_MAX_ATTEMPTS;

  async function extractWithRetry(args, job) {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt > (job._attempt || 1)) await deps.db.updateJob(deps.sb, job.id, { attempt });
        return await deps.extract(args);
      } catch (e) {
        lastErr = e;
        const transient = e && TRANSIENT.has(e.status);
        if (!transient || attempt === maxAttempts) throw e;
        await timers.sleep(Math.min(2000, 250 * 2 ** attempt));
      }
    }
    throw lastErr;
  }

  return async function processJob(job, payload) {
    let heartbeat = null;
    try {
      await deps.db.updateJob(deps.sb, job.id, { state: 'running', attempt: (job.attempt || 0) + 1, started_at: now(), heartbeat_at: now() });
      job._attempt = (job.attempt || 0) + 1;
      if (heartbeatMs > 0) {
        heartbeat = timers.setInterval(() => { deps.db.updateJob(deps.sb, job.id, { heartbeat_at: now() }).catch(() => {}); }, heartbeatMs);
      }

      const instruction = deps.buildInstruction({
        filename: payload.filename, pageNumber: job.page_number, hints: payload.hints, textLines: payload.text_lines,
      });
      const out = await extractWithRetry({
        imageBase64: payload.image_base64, mediaType: 'image/jpeg', instruction, maxTokens: 12000,
        // Raw page fields for the agent-team engine (Gemini engine ignores them).
        textLines: payload.text_lines, filename: payload.filename, pageNumber: job.page_number, hints: payload.hints,
      }, job);

      const { boardCount, deviceCount } = countPage(out.result);
      // Review is forced by EITHER disagreeing sub-agents OR the master
      // auditor finding something both of them missed — that's the teeth
      // behind "nothing is complete until it clears the master's pass".
      const crossCheckHit = Boolean(out.verification && out.verification.status === 'done' && out.verification.mismatches && out.verification.mismatches.length > 0);
      const masterHit = Boolean(out.master && out.master.status === 'reviewed' && out.master.complete === false && (out.master.missed || []).length > 0);
      const blockingReview = crossCheckHit || masterHit;
      const state = deriveState({ failed: false, boardCount, deviceCount, blockingReview });

      const verificationBlob = out.verification || out.master
        ? { ...(out.verification || {}), ...(out.master ? { master: out.master } : {}) }
        : null;
      await deps.db.insertResult(deps.sb, {
        org_id: job.org_id, job_id: job.id, document_id: job.document_id, page_number: job.page_number,
        structured: out.result, verification: verificationBlob, schema_valid: true,
        board_count: boardCount, device_count: deviceCount,
      });
      await deps.db.updateJob(deps.sb, job.id, {
        state, error_code: state === 'incomplete' ? 'zero_devices_with_boards' : null,
        error_detail: state === 'incomplete' ? 'Boards detected but no devices captured on this page.' : null,
        heartbeat_at: now(), finished_at: now(),
      });
      return { state };
    } catch (e) {
      const code = e && e.stop_reason === 'max_tokens' ? 'output_truncated'
        : (e && TRANSIENT.has(e.status)) ? 'provider_unavailable'
        : 'extraction_error';
      await deps.db.updateJob(deps.sb, job.id, {
        state: 'failed', error_code: code,
        error_detail: (e && e.message ? String(e.message) : 'extraction failed').slice(0, 500),
        heartbeat_at: now(), finished_at: now(),
      }).catch(() => {});
      return { state: 'failed', error_code: code };
    } finally {
      if (heartbeat) timers.clearInterval(heartbeat);
    }
  };
}
