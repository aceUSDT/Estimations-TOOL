import { handleInlineExtract } from '../_lib/handlers.mjs';
import { runRoute } from '../_lib/route.mjs';

// Stateless per-page extraction for the local-first browser. 60s covers the
// ~30–45s dense-page workload inline (no background function, no Netlify
// Blobs, no polling). See docs/MIGRATION_VERCEL_SUPABASE.md §6.
export const config = { runtime: 'nodejs', maxDuration: 60 };

export default function handler(req, res) {
  return runRoute(handleInlineExtract, req, res);
}
