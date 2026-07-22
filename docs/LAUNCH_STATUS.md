# Launch status — the unified product (single source of truth)

Updated 2026-07-22 on `product/ai-agent-team` (PR #13). Honest status only:
nothing below is claimed that a test, a live probe, or a deploy did not show.

## The product

A Vercel storefront sells access → Stripe writes an entitlement into Supabase
(the system's single database) → the customer downloads a signed desktop
installer through a private, expiring link → the installed app does the
take-off locally and, signed in, calls the hosted **AI agent team**:
**Gemini as master auditor** over free **NVIDIA sub-agents**, with
deterministic code computing every count. Server keys never leave the server.

## Built and verified on this branch

| Piece | State | Evidence |
|---|---|---|
| Platform (Vercel + Supabase, Gemini-only → agent team) | ✅ deployed green | PR #12 phases 1–8; PR #13 previews Ready |
| NVIDIA sub-agent pool (3 keys, chains, pacing, cooldown) | ✅ live-proven | 5 models answered on real prompts; chain answered on every live run |
| Gemini master orchestration (audit + review teeth) | ✅ code+tests | master-found gap ⇒ `needs_review`; skipped master reported honestly |
| Engine selector + honest fallback | ✅ tests + live | `agent-team` mode live; labelled `gemini_direct` fallback |
| Vision OCR (page image → rows) | ✅ live-proven | nano-vl-8b read DB-00-08P 18/18 row lines @2400px (~107s); nemotron-parse zones pages (layout role) |
| Store + checkout + entitlements + restore | ✅ tests green | 30 commerce + 10 gateway + 10 static + 4 browser-flow tests; entitlements in Supabase `commerce_kv` (migration 0004) |
| Download gateway (R2 worker) + release manifest | ✅ tests green | signed-claim verification, allow-listed builds |
| Desktop: local-first + optional cloud service | ✅ tests green | https-only opt-in address; no address ⇒ zero outbound requests |
| Desktop packaging + signed-installer workflow | ✅ scaffolding | electron-builder 4 targets + CI workflow ported; **signing needs owner certs** |
| Accounts (Supabase auth, RLS, browser + desktop) | ✅ code+tests; 🟡 live | RLS written/forced/logic-tested; LIVE proof awaits SQL apply |

## What the owner must do to go live (in order)

1. **Supabase**: run `supabase/migrations/0001–0004` in the SQL editor; turn
   OFF "Confirm email" on the test project; then `npm run test:rls` proves the
   tenant-isolation gate live.
2. **Vercel env** (Project → Settings → Environment Variables): everything in
   `.env.example` — `GEMINI_API_KEY` (master), `NVIDIA_API_KEY_1..3`
   (sub-agents), Supabase server + publishable values, and — when selling —
   the Stripe/R2/Resend commerce set. `COMMERCE_ENABLED` unset keeps the store
   in "coming soon".
3. **Stripe**: activate the account, create the product/price, set the
   webhook to `/api/stripe-webhook`, put the three `STRIPE_*` values in Vercel.
4. **R2 + gateway**: bucket + token, deploy `workers/download-gateway`
   (`wrangler`), same `DOWNLOAD_TOKEN_SECRET` both sides
   (docs/OWNER_LAUNCH_CHECKLIST.md walks every step).
5. **Signing**: Azure Trusted Signing (Windows) + Apple Developer ID + notarisation
   (macOS) credentials into the GitHub `production` environment; the desktop
   workflow then produces signed installers; `tools/release/build-manifest` +
   `publish-r2` ship them.
6. **Domain**: point it at the Vercel project (docs/CUSTOM_DOMAIN_RUNBOOK.md).
7. **Production deploy**: only on explicit owner approval (unchanged rule).

## Known limits (stated, not hidden)

- NVIDIA free tier fluctuates minute to minute; chains + cooldown route
  around it, and the worst case degrades to labelled Gemini-direct — never a
  silent failure. A paid tier can be added for speed later.
- Vision reading is ~107s/page — async path only; per-page inline extraction
  stays on the text agents.
- The 26CC07 regression (≈40 boards / 632 devices) still needs an owner-run
  with the private PDF (never committed).
- Vercel Hobby: ≤12 functions (now 8), daily-only crons (watchdog is
  externally scheduled), 60s route budget (vision jobs need the async path).
