/* Durable job processor. `processJob` is kicked (not awaited) by the start
 * route; status/result routes read Supabase independently, so they keep
 * working if this crashes or times out.
 *
 * Phase 4 delivers the core running→extract→derive→persist path. Phase 5
 * hardens it: periodic heartbeat writes, a stale-job watchdog that reclaims
 * `running` jobs whose heartbeat has expired as `failed:worker_lost`, and
 * bounded idempotent retries. Those hooks are marked below.
 *
 * "AI extracts, code computes": the model returns structured page data; the
 * terminal state is decided by deterministic code (deriveState), which can
 * never upgrade a zero-device-with-boards page to `complete`.
 */
import { deriveState } from './handlers.mjs';

/* Count a single page's evidence for the state guard. The authoritative
 * take-off aggregation still happens in the deterministic client/report core;
 * these counts exist only to drive the honest state machine. */
function countPage(result) {
  const boards = Array.isArray(result && result.boards) ? result.boards : [];
  const devices = Array.isArray(result && result.devices) ? result.devices : [];
  const countable = devices.filter((d) => d && d.device_class && !['space', 'spare'].includes(d.device_class));
  return { boardCount: boards.length, deviceCount: countable.length };
}

export function makeProcessJob(deps) {
  // deps: { sb, db, extract (extractWithVerification), buildInstruction, now }
  return async function processJob(job, payload) {
    const now = deps.now || (() => new Date().toISOString());
    try {
      await deps.db.updateJob(deps.sb, job.id, { state: 'running', attempt: (job.attempt || 0) + 1, started_at: now(), heartbeat_at: now() });
      // Phase 5: start a heartbeat interval here.

      const instruction = deps.buildInstruction({
        filename: payload.filename, pageNumber: job.page_number, hints: payload.hints, textLines: payload.text_lines,
      });
      const out = await deps.extract({
        imageBase64: payload.image_base64, mediaType: 'image/jpeg', instruction, maxTokens: 12000,
      });

      const { boardCount, deviceCount } = countPage(out.result);
      const blockingReview = Boolean(out.verification && out.verification.status === 'done' && out.verification.mismatches && out.verification.mismatches.length > 0);
      const state = deriveState({ failed: false, boardCount, deviceCount, blockingReview });

      await deps.db.insertResult(deps.sb, {
        org_id: job.org_id, job_id: job.id, document_id: job.document_id, page_number: job.page_number,
        structured: out.result, verification: out.verification || null, schema_valid: true,
        board_count: boardCount, device_count: deviceCount,
      });
      await deps.db.updateJob(deps.sb, job.id, {
        state, error_code: state === 'incomplete' ? 'zero_devices_with_boards' : null,
        error_detail: state === 'incomplete' ? 'Boards detected but no devices captured on this page.' : null,
        heartbeat_at: now(), finished_at: now(),
      });
      return { state };
    } catch (e) {
      // A failure is recorded as `failed` with a safe code — never silently
      // converted into a successful result. Provider internals are not stored.
      const code = e && e.stop_reason === 'max_tokens' ? 'output_truncated' : 'extraction_error';
      await deps.db.updateJob(deps.sb, job.id, {
        state: 'failed', error_code: code, error_detail: (e && e.message ? String(e.message) : 'extraction failed').slice(0, 500),
        heartbeat_at: now(), finished_at: now(),
      }).catch(() => {});
      return { state: 'failed', error_code: code };
    }
  };
}
