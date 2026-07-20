# Migration notes — Netlify → Vercel + Supabase

**Branch:** `platform/vercel-supabase` (created from `main` @ `454f1f5`).
**Rule zero:** `main` is never modified; every change lands on this branch in small,
tested phases. No deploy, no production infrastructure change without explicit owner
approval. No secret is ever committed, printed, or logged.

---

## 1. Repository audit (verified 2026-07-19, evidence-based)

All facts below were verified directly against `origin/main @ 454f1f5`, not assumed.

| Claim | Verified | Evidence |
|---|---|---|
| Static `index.html` app + local JS modules | ✅ | `index.html` (~4.3k lines), `extractor-core.js`, `report-core.js`, `vendor/` (pinned pdf.js + Tesseract) |
| Server functions under `netlify/functions` | ✅ | `extract.mjs`, `extract-background.mjs`, `extract-status.mjs`, `lib/domain-pack.mjs`, `lib/providers.mjs` |
| Anthropic/Claude runtime code present | ✅ | `@anthropic-ai/sdk` in `package.json`; `callClaude`, `CLAUDE_MODEL`, `EXTRACTION_MODEL`, `ANTHROPIC_API_KEY` in `lib/providers.mjs`, `extract*.mjs`; provider-selection UI text in `index.html` |
| Gemini fallback logic | ✅ | `providerStatus()` → `primary: anthropic ? 'anthropic' : gemini`, `verify: anthropic && gemini`; "Gemini free tier" wording in README + providers |
| Netlify Blobs | ✅ | `getStore('extractions')` in `extract-background.mjs` + `extract-status.mjs`; `@netlify/blobs` dependency |
| Netlify-specific endpoints in frontend | ✅ | `index.html:1861-1863` — `AI_EXTRACT_ENDPOINT/AI_BG_ENDPOINT/AI_STATUS_ENDPOINT = './.netlify/functions/…'` |
| Tests cover OCR/extraction/reconciliation/reports/consolidation/verification/desktop assets | ✅ | 9-suite chain in `package.json` `test` script; **baseline run on this branch: PASSES, zero failures** |
| Desktop offline behaviour | ✅ | `LOCAL_DESKTOP` (protocol `estimation:`) forces `onlineExtraction=false` and disables the toggle (`index.html:874-877, 2340-2356`) |
| `.env.local` ignored | ✅ | `.gitignore` has `.env` + `.env.*` |

### Audit findings that affect the plan

- **F1 — 26CC07 regression document is NOT in the repo.** `STATUS.md` and
  `docs/OCR_AND_REPORTING.md` record its historical result (40 boards, 632 countable
  devices) but the 62-page PDF was supplied privately and never committed. **Quality gate
  #2 cannot be re-measured in this environment** until the owner re-supplies the document
  (destination: a gitignored `.private-fixtures/` folder). Gate #2 is tracked as
  *owner-verified* until then; the committed proxy is `tools/coverage/ground-truth.json`
  + the dialect suites, which do run.
- **F2 — no auth exists anywhere today.** The Netlify functions are unauthenticated;
  the local PIN is a UI lock only. Multi-tenant safety starts at zero.
- **F3 — `extract-background.mjs` relies on the Netlify `-background` filename
  convention** (fire-and-forget 202 + Blobs). Vercel has no direct equivalent —
  this is the one architectural piece that must be redesigned, not ported.
- **F4 — an open draft PR #10 (`fable/paid-downloads`)** carries 6 commits: signed
  4-target installers + release manifest, Stripe commerce (ships disabled), R2 download
  gateway, **Gemini-only provider refactor**, and the **analysis-health/export-gating**
  work. See §7 for the cherry-pick decision.

## 2. Dependency & runtime map

| Component | Runtime | Depends on | Migration impact |
|---|---|---|---|
| `index.html` + `extractor-core.js` + `report-core.js` + `vendor/` | Browser / Electron renderer | pdf.js, Tesseract (vendored), ExcelJS | **Unchanged** — deterministic engine stays put |
| `netlify/functions/extract.mjs` | Netlify Node function | providers, domain-pack | Replaced by Vercel route(s) |
| `netlify/functions/extract-background.mjs` | Netlify **background** function | providers, `@netlify/blobs` | Replaced by durable-job design (§6) |
| `netlify/functions/extract-status.mjs` | Netlify Node function | `@netlify/blobs` | Replaced by Supabase-backed status route |
| `lib/providers.mjs` | Node (bundled) | `@anthropic-ai/sdk`, fetch→Gemini | Becomes Gemini-only, moved to shared server lib |
| `lib/domain-pack.mjs` | Node (bundled) | none | **Unchanged** (schema + prompt + coerceResult) |
| `desktop/` | Electron | packaged assets | **Unchanged**; hosted extraction stays disabled |
| Deps to remove | — | `@anthropic-ai/sdk`, `@netlify/blobs` | Phase 2 / Phase 4 |
| Deps to add | server only | `@supabase/supabase-js` | Phase 3 (`@supabase/ssr` NOT added — no Next.js/SSR layer; static frontend is kept, per platform decision) |

**Framework decision:** keep the static frontend. No concrete requirement (SSR, routing,
SEO, server components) justifies Next.js; Vercel serves static files + `api/*.mjs`
Node routes from a plain repo. `@supabase/ssr` is therefore out of scope. Browser auth,
when introduced (Phase 7), uses `@supabase/supabase-js` with the publishable key only.

## 3. Current → target route map

| Current (Netlify) | Target (Vercel, Node runtime) | Notes |
|---|---|---|
| `GET ./.netlify/functions/extract` (health) | `GET /api/extract/health` | Reports Gemini-only config: `{configured, provider:'gemini', model}`; never echoes key material |
| `POST ./.netlify/functions/extract` (sync extract) | *(absorbed into start/status/result)* | Sync path removed; one canonical async flow |
| `POST ./.netlify/functions/extract-background` | `POST /api/extractions/start` | Validates shape + payload cap; creates **durable job row first**; idempotency via client-supplied `Idempotency-Key` → unique constraint |
| `GET ./.netlify/functions/extract-status?id=` | `GET /api/extractions/status?id=<job-id>` | Reads Supabase; states `queued/running/complete/needs_review/incomplete/failed`; stable error codes; correlation id echoed |
| *(result embedded in status blob)* | `GET /api/extractions/result?id=<job-id>` | Separate, authorised result fetch; a `failed`/`incomplete` job never returns an issue-ready result |

Route invariants (all routes): request-shape + size validation → auth (Supabase JWT when
Phase 7 lands; until then, deploy-protection only and documented as such) → ownership
authorisation on job/project/document → stable JSON error envelope
`{error: {code, message, correlation_id}}` → no provider internals or secrets in
responses. Job IDs are UUIDs **and** every read is ownership-checked — unguessable IDs
are not the security boundary.

## 4. Database schema proposal (Supabase, versioned SQL in `supabase/migrations/`)

Eleven tables; all user-owned tables have RLS **enabled + forced**, UUID PKs,
`created_at`/`updated_at` (trigger-maintained), FKs, and indexes on every FK + lookup
path. JSONB only for genuinely variable payloads (raw model output, diagnostics).

- `organizations` — id, name, owner. `organization_members` — org_id, user_id, role
  (unique org+user).
- `profiles` — 1:1 with `auth.users` (id = auth.uid()).
- `projects` — org_id, name, status.
- `documents` — project_id, filename, byte_size, sha256, page_count, mime,
  `local_ref` (client-side handle), `cloud_consent` (bool + timestamp), **no file
  bytes** — originals stay local by default; any later cloud copy goes to a
  **private** Storage bucket with RLS + expiring signed URLs, never public.
- `extraction_jobs` — project_id, document_id, page_number, state
  (`queued|running|complete|needs_review|incomplete|failed`), `idempotency_key`
  (unique per project), `correlation_id`, provider+model recorded per run,
  `error_code`, `error_detail`, `attempt`, `heartbeat_at`, timings.
- `extraction_results` — job_id (unique), document_id, page_number, structured JSONB
  (model output post-`coerceResult`), validation status.
- `boards` — project_id, result provenance (job_id), ref, ways, ratings; normalised.
- `devices` — board_id, way, device_class, rating_a, poles, curve, qty, confidence,
  provenance: document_id + page + source region/line.
- `review_items` — project_id, kind, reason_code, linked board/device/job, state.
- `audit_events` — org_id, actor, action, entity, before/after summary (no document
  content), correlation_id.

RLS policy shape: membership-based (`org_id in (select org_id from organization_members
where user_id = auth.uid())`); no public/anon policies on customer data; the
service-role key is used **only** inside Vercel server routes and never shipped to the
browser.

## 5. Data-flow & privacy review

- Documents are ingested and parsed **locally** (browser/Electron). Nothing leaves the
  device by default. Desktop cannot enable cloud extraction (unchanged).
- Cloud-assisted extraction is **explicit opt-in**, with a consent dialog that states
  precisely what is transmitted: the rendered page image + detected text lines, to our
  server route and onward to Google Gemini. Consent state is recorded per document.
- What Supabase stores: account/org metadata, project/document *metadata* (name, hash,
  sizes — not bytes), job state, structured extraction results, review items, audit
  events. What it never stores: raw PDFs (in Postgres), card data, provider keys.
- Secrets: `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` exist only as Vercel server
  env vars. Browser receives at most `NEXT_PUBLIC_SUPABASE_URL` +
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (publishable by design, still never committed).
  `.env.local` is gitignored (verified). `.env.example` carries names only.
- Silent-failure posture: job states include `incomplete`/`needs_review`; a zero-device
  result against detected boards can never be marked `complete` (enforced server-side at
  result-write time and client-side by the analysis-health gate ported in Phase 6).

## 6. Asynchronous extraction — worker strategy (decision)

Evidence: a dense page extraction runs ~30–45 s (documented in
`extract-background.mjs`); the client already treats extraction as job-id + polling.

**Chosen: Vercel Node function with configured `maxDuration`, backed by a durable
Supabase job row.** `POST /api/extractions/start` inserts the job (`queued`) and
returns the id immediately, then processes within the same invocation
(`running` + heartbeats → terminal state). **Verified against Vercel's function-duration
docs (2026-07-01):** with fluid compute (default on), Node `maxDuration` ceilings are
**Hobby 300 s; Pro/Enterprise 800 s GA, up to 1800 s (beta)** — so the ~30–45 s per-page
workload fits comfortably even on Hobby. The start route sets `maxDuration: 60` (headroom
over 45 s) via `export const config` in the route file. Whole-document server-side batch
extraction would exceed this and is the documented trigger to move to Supabase Queues (or
Pro's extended duration). Status/result routes read only Supabase, so they keep
working if the worker crashes: a watchdog rule (`running` + stale `heartbeat_at`) is
reported as `failed:worker_lost`, and a retried start with the same idempotency key
resumes cleanly instead of duplicating.

**Not chosen (for now):** Supabase Queues + standalone worker — strictly more moving
parts than the workload needs at single-page granularity. Trigger to revisit: batch
jobs > `maxDuration` budget, sustained concurrency limits, or fan-out extraction of
whole documents server-side.

**Crash safety (Phase 5).** The worker writes a `heartbeat_at` every ~10 s while
extracting. A watchdog (`api/extractions/watchdog.mjs`, cron-authenticated via
`CRON_SECRET`) reclaims `running` jobs whose heartbeat is older than 120 s as
`failed:worker_lost`, so a crashed/evicted/timed-out worker never leaves a job polling
forever; a fresh start with a new idempotency key retries. Transient provider errors
(429/5xx) get a bounded in-worker retry (default 2 attempts, small backoff). **Plan note:**
the `vercel.json` cron is `*/5 * * * *`; Vercel Hobby limits crons to once per day, so
sub-daily reclaim needs Pro — on Hobby the watchdog can also be triggered manually or the
schedule relaxed to daily.

## 7. PR #10 (`fable/paid-downloads`) — cherry-pick decision

Inspected (6 commits): signed 4-target installer workflow + release manifest
(`16aa107`), Stripe entitlements + download endpoints (`a61d1c4`), store pages
(`d247caa`), **analysis-health/export gating** (`07b126f`), **Gemini-only provider
refactor + R2 gateway** (`ffacb5f`), docs (`8130ec1`).

**Decision recorded:**
- **Commerce/installer work: IN LAUNCH SCOPE (owner-confirmed 2026-07-19).** Paid desktop
  downloads are part of launch. The release-manifest + installer commits from PR #10
  (`16aa107`) are cleanly portable (they touch `desktop/`, `.github/workflows/`,
  `tools/release/` — disjoint from this branch's server work) and will be ported after the
  platform migration lands; the R2/Stripe endpoints will be re-hosted as Vercel routes at
  that point (a follow-on phase, tracked here). They are **not** cherry-picked mid-migration
  to avoid destabilising the platform change.
- **Two pieces are selectively re-implemented here because they directly serve the
  quality gates:** the Gemini-only provider cleanup (gates 5–6, Phase 2) and the
  analysis-health/export-gating model (gates 3–4, Phase 6). They are ported as focused
  changes on this branch, not wholesale cherry-picks, to avoid dragging commerce files
  along.

## 8. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | 26CC07 gate unverifiable here (fixture not in repo) | certain | medium | Owner re-runs against the real PDF before sign-off; proxy suites + ground-truth.json guard the parsers meanwhile (F1) |
| R2 | Unauthenticated window between Phase 4 (routes live in preview) and Phase 7 (auth) | high | high | Keep preview deploy-protected; routes reject when `AUTH_REQUIRED=true` unset only in local dev; document loudly; no production deploy before Phase 7 |
| R3 | Worker dies mid-job → stuck `running` | medium | medium | Heartbeats + stale-watchdog → `failed:worker_lost`; idempotent restart |
| R4 | RLS policy gap leaks cross-tenant data | low | critical | Phase 7 includes negative authorization tests (user B reads user A's job → 404/403) run against a real Supabase instance before any production use |
| R5 | Secret leakage via logs/frontend | low | critical | Names-only `.env.example`; grep gate in CI/tests for key patterns; service-role used only in server routes |
| R6 | Divergence with open PR #10 (same files: providers, extract) | high | low-med | Conflicts are expected and mechanical; migration notes flag them; owner chooses merge order |
| R7 | Vercel plan limits below assumed `maxDuration` | low | medium | Verify plan ceiling before first preview deploy; fall back to Supabase Queues per §6 trigger |
| R8 | Container resets losing work | proven | medium | Commit + push at every phase boundary |

## 9. Phased implementation plan

- **Phase 1 — baseline + branch (THIS COMMIT):** facts verified; baseline `npm test`
  run on this branch: **passes, zero failures**; branch `platform/vercel-supabase`
  created from `main@454f1f5`; these notes recorded.
- **Phase 2 — Gemini-only cleanup:** remove `@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`,
  `EXTRACTION_MODEL`, Claude selection, "free tier" wording, fallback UI; keep
  structured-output validation + nullable verification fields; keep current
  `gemini-2.5-flash` default (no silent model change); health reports Gemini-only.
  Tests updated with justification; suite green.
- **Phase 3 — Supabase server lib + SQL migrations:** `@supabase/supabase-js` (server
  only), `api/_lib/supabase.mjs`, `supabase/migrations/0001_*.sql` per §4 with RLS.
  No remote execution — SQL is reviewable/repeatable; applied by owner or CI later.
- **Phase 4 — Vercel routes:** `api/extract/health.mjs`, `api/extractions/{start,
  status,result}.mjs` + `vercel.json` (Node runtime, `maxDuration`); Netlify functions
  left in place until Phase 6 proves the replacement (safety rule 3).
- **Phase 5 — durable jobs:** §6 design implemented; injected-deps tests for crash/
  retry/idempotency paths.
- **Phase 6 — frontend switch + consent + honesty:** endpoint constants → `/api/...`;
  consent dialog; port analysis-health + export gating; diagnostics download; remove
  Netlify functions + `@netlify/blobs` (their replacement now tested); `netlify.toml`
  retired.
- **Phase 7 — auth + RLS + authorization tests:** Supabase Auth in the browser
  (publishable key), JWT verification in routes, ownership checks, negative tests.
- **Phase 8 — regression + deploy readiness:** full suite; quality-gate checklist
  walked item-by-item with evidence; Vercel preview deploy **only with owner
  approval**; 26CC07 owner-run recorded.

Each phase ends with: changed files, decisions, test results (honest), remaining risks.

## 10. Environment variables (names only — values never committed)

Server-side (Vercel project settings): `GEMINI_API_KEY`, `GEMINI_MODEL`,
`GEMINI_VERIFY_MODEL` (only if a second verification model is enabled),
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
Browser-safe (only when Phase 7 introduces auth): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
Local dev: `.env.local` (gitignored — verified) — never the service-role key in
anything the browser can load.
