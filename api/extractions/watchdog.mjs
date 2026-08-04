import { handleWatchdog, makeReclaimStale } from '../_lib/watchdog.mjs';
import { runRoute, realDeps } from '../_lib/route.mjs';
import * as db from '../_lib/db.mjs';
import { serviceClient } from '../_lib/supabase.mjs';

export const config = { runtime: 'nodejs', maxDuration: 30 };

export default function handler(req, res) {
  const base = realDeps();
  const deps = {
    ...base,
    correlationId: undefined,
    cronSecret: process.env.CRON_SECRET || null,
    reclaimStale: makeReclaimStale({ sb: serviceClient(), db }),
  };
  return runRoute(handleWatchdog, req, res, deps);
}
