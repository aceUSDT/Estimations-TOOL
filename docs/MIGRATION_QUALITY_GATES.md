# Migration quality gates — evidence walkthrough (Phase 8)

Status of the 13 acceptance gates for the Netlify → Vercel + Supabase migration
(`platform/vercel-supabase`, PR #12). Evidence is deterministic and re-runnable;
`npm test` passes end-to-end (exit 0) with the suite below. Honest status only:
gates that are proven at the code/fake-test level but **not yet verified live** are
marked 🟡, and owner-gated items are marked ⏳ — they are **not** claimed as done.

Legend: ✅ met with evidence · 🟡 code-verified, live proof pending · ⏳ owner-gated.

| # | Gate | Status | Evidence |
|---|------|:---:|----------|
| 1 | Existing deterministic suite still passes (with justified test updates) | ✅ | `npm test` exit 0 — board-refs, reconciliation, TBA schedule, OCR pipeline, report-core, device-consolidation, verify, extract-function, vercel-routes (22), account-core, dialect probe, desktop asset verify all green. |
| 2 | 26CC07 regression ≈ **40 boards / 632 devices** | ⏳ | The 62-page PDF was supplied privately and is **not** in the repo (correctly — never commit private source docs). Destination is a gitignored `.private-fixtures/`. Owner-run; recorded here once executed. |
| 3 | Analysis-health honesty — an incomplete analysis **cannot** produce a normal issue-ready export | ✅ | `issueReady(state)` returns true only for `complete` (`api/_lib/handlers.mjs`); `handleResult` withholds the payload for queued/running/failed/incomplete and flags `needs_review` as *not* issue-ready. Tests: `result: incomplete ⇒ not issue-ready, no payload`, `failed ⇒ …`, `needs_review ⇒ result present but NOT issue-ready`. |
| 4 | Zero-device / incomplete gating — a schedule board with **0 devices is never `complete`** | ✅ | `deriveState({boardCount>0, deviceCount===0}) → 'incomplete'` (`handlers.mjs`). Tests: `deriveState: boards>0 & devices=0 ⇒ incomplete (never complete)` and `worker: boards>0 & devices=0 ⇒ job incomplete (zero-device guard), result stored`. |
| 5 | Gemini structured-output schema is valid & deterministic | ✅ | `test-extract-function.mjs` walks the schema: `additionalProperties:false` everywhere, `required` covers every property, **no union-typed params** (API compilation limit); `coerceResult` turns model strings back into numbers/null deterministically. |
| 6 | No active Anthropic reference — **Gemini is the only hosted provider** | ✅ | `test-verify.mjs` (“Gemini is the ONLY hosted provider”), `providerStatus()` returns `{gemini,…}` with no `anthropic` key; repo grep for `@anthropic-ai` / `x-api-key` / `anthropic.com/v1` in `api/`, `index.html`, `package.json` returns nothing. |
| 7 | No Netlify functions / `@netlify/blobs` on the prod endpoint | ✅ | `netlify/functions/*`, `netlify.toml`, and the `@netlify/blobs` dependency were removed (Phase 6, `368082d`). `test-extract-function.mjs` / `test-verify.mjs` assert the netlify dir and dependency are absent. The stateless `/api/extract/run` route stores nothing (no Blobs, no polling). |
| 8 | **No cross-tenant reads** (RLS) | 🟡 | Policies written and forced: `supabase/migrations/0001–0003` (RLS enable + FORCE, membership policies, `enrol_org_creator` bootstrap). Ownership logic proven with fakes: `status: cross-tenant guess ⇒ 404`, `result: cross-tenant guess ⇒ 404`, `start: project not owned ⇒ 404 (does not confirm existence)`. **LIVE proof pending:** `npm run test:rls` (two ephemeral signups, anon key only) needs the owner to apply `0001–0003` and disable “Confirm email” on the test project. Until then this gate is **not** claimed live. |
| 9 | No secrets in code, logs, tests, or commits | ✅ | `.env.example` lists names only; `.env`/`.env.*` gitignored; repo secret sweep (`sb_secret_`, service-role literals, `AIza…`, PEM headers) is clean. `/api/public-config` returns only the publishable key and **refuses any `service_role`-looking value** (`test-account-core.mjs`). Error envelope `{code,message,correlation_id}` carries no provider internals or key material. |
| 10 | Deterministic, testable route responses | ✅ | All route logic is in pure, dependency-injected handlers; `test-vercel-routes.mjs` exercises 22 cases (auth, ownership→404, idempotency, state machine, worker retry, watchdog) with in-memory fakes — no Vercel runtime, no network, no Supabase. |
| 11 | Desktop stays offline / local-first preserved | ✅ | `LOCAL_DESKTOP` disables online extraction **and** the cloud-account layer in `index.html`; the account row only appears when the server reports auth configured. `/api/extract/run` is stateless and account-free so the local-first browser path needs no login. `desktop/verify-assets.cjs` green (13 required files). |
| 12 | SQL is reviewable and repeatable (idempotent migrations) | ✅ | `supabase/migrations/0001–0003` use `create … if not exists`, `create or replace`, `drop trigger if exists`, and `on conflict … do nothing`; re-running them is a no-op. No destructive/reset statements. |
| 13 | Deploys to Vercel preview; no Netlify dependency | 🟡 ⏳ | **Vercel preview deploy is green** on PR #12 (`e014d21`, status “Deployment has completed”) after removing the Hobby-incompatible cron. Repo has no Netlify functions/config. The Netlify *site* still auto-builds the static SPA (a green preview) because the project is still connected — **owner to disconnect**. **Production** deploy remains **owner-gated** (explicit approval required). |

## Summary

- **10 of 13 gates ✅ met** with re-runnable evidence.
- **Gate 8 🟡** — RLS is written, forced, and logic-tested; the *live* cross-tenant
  proof is one owner action away (apply `0001–0003` + disable email confirmation →
  `npm run test:rls`).
- **Gate 2 ⏳** — 26CC07 regression is owner-run (private PDF, never committed).
- **Gate 13 🟡 ⏳** — Vercel preview is green; production deploy and the final
  Netlify disconnect are owner decisions.

No gate is over-claimed. The system is not described as “bulletproof”; the two
security-critical items that depend on live infrastructure (gate 8 live proof,
gate 13 production) are explicitly left to owner verification.
