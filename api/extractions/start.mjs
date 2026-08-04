import { handleStart } from '../_lib/handlers.mjs';
import { runRoute } from '../_lib/route.mjs';

// Per-page extraction runs ~30–45s; 60s gives headroom and fits every Vercel
// plan (Hobby ceiling 300s). Whole-document batch would move to Supabase
// Queues — see docs/MIGRATION_VERCEL_SUPABASE.md §6.
export const config = { runtime: 'nodejs', maxDuration: 60 };

export default function handler(req, res) {
  return runRoute(handleStart, req, res);
}
