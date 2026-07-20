/* Stale-job watchdog. A `running` job whose heartbeat has not advanced within
 * the stale window means the worker crashed, was evicted, or exceeded
 * maxDuration. The watchdog reclaims such jobs as `failed:worker_lost` so the
 * client never polls a job that will never finish, and so a fresh start
 * (new idempotency key) can be issued. Idempotent: re-running it changes
 * nothing once jobs are terminal.
 *
 * Invoked by any external scheduler (Supabase pg_cron, an uptime pinger, or a
 * Vercel Pro cron), authenticated with CRON_SECRET. No auto-cron ships in
 * vercel.json: Vercel Hobby permits only daily crons, so scheduling is left an
 * explicit ops choice per plan (see docs/MIGRATION_VERCEL_SUPABASE.md §6).
 * Never exposes job contents.
 */
import { ok, err } from './http.mjs';

export const DEFAULT_STALE_SECONDS = 120;   // > start route maxDuration (60s) + margin

export function makeReclaimStale(deps) {
  // deps: { sb, db, now?, staleSeconds? }
  const now = deps.now || (() => Date.now());
  const staleSeconds = deps.staleSeconds != null ? deps.staleSeconds : DEFAULT_STALE_SECONDS;
  return async function reclaim() {
    const cutoff = new Date(now() - staleSeconds * 1000).toISOString();
    const stale = await deps.db.findStaleRunningJobs(deps.sb, cutoff);
    let reclaimed = 0;
    for (const j of stale) {
      await deps.db.updateJob(deps.sb, j.id, {
        state: 'failed', error_code: 'worker_lost',
        error_detail: 'Worker stopped reporting progress; reclaimed by watchdog.',
        finished_at: new Date(now()).toISOString(),
      });
      reclaimed++;
    }
    return { scanned: stale.length, reclaimed };
  };
}

/* GET/POST /api/extractions/watchdog — cron-authenticated. */
export async function handleWatchdog(input, deps) {
  const provided = (input.headers && (input.headers.authorization || '')).replace(/^Bearer\s+/, '');
  if (!deps.cronSecret || provided !== deps.cronSecret) {
    return err(401, 'unauthorized', 'Watchdog requires the cron secret.', input.correlationId);
  }
  try {
    const summary = await deps.reclaimStale();
    return ok(200, { ok: true, ...summary });
  } catch {
    return err(503, 'db_error', 'Watchdog could not run.', input.correlationId);
  }
}
