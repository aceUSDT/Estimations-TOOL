# PROJECT MEMORY — read this first in a new session

**Purpose:** everything a fresh session needs to continue this project without
re-deriving context or hallucinating state. Written 2026-07-26.
**Verify before trusting:** this file is a snapshot. Always run the
"First five minutes" checks below — the container resets often and git is the
source of truth, not this document.

---

## 1. The product (what we are building)

**Estimation Tools** — a commercial product for UK electrical estimators.

The finish line, in the owner's words: *a Vercel landing page where users pay,
then download a desktop tool that installs on their computer, filled with a team
of AI agents and powerful OCR, and that can also reach the internet/browser.*

The flow:

```
Buyer → Vercel storefront (/download) → Stripe payment
      → entitlement written to Supabase (the ONE database for the whole system)
      → private, expiring link to a signed desktop installer (via Cloudflare R2)
      → installed Electron app does the take-off LOCALLY
      → signed in, it calls the hosted AI agent team:
           Gemini = MASTER agent (orchestrates + audits)
           NVIDIA free models = SUB-AGENTS (extract, second opinion, vision/OCR)
      → deterministic code computes every count. Always.
```

**Owner decisions already made (do not re-litigate):**
- Gemini is the **master** agent overseeing NVIDIA sub-agents. Owner's explicit design.
- **The backend runs the AI server-side, metered per plan** — customers just get
  results. (Not bring-your-own-key.)
- Supabase is the **single database** for the whole system: accounts, auth, plans,
  entitlements, job state, audit.
- The store/commerce work and the platform migration were **unified into one product**,
  not kept as separate tracks.

---

## 2. Where the code is

| Branch | State | Contains |
|---|---|---|
| `main` | untouched, pre-migration | Original Netlify + Anthropic app. **Never modified — rule zero.** |
| `product/ai-agent-team` | **THE ACTIVE BRANCH** — 21 commits ahead of main | Everything below. Tip at time of writing: `19fce54`. PR **#13** (draft, green). |
| `platform/vercel-supabase` | superseded (its work is inside #13's history) | PR #12, the Vercel+Supabase migration. |
| `fable/paid-downloads` | superseded (ported into #13) | PR #10, the original commerce work. |
| `claude/electrical-estimating-tool-h68ums` | separate | PR #11, Obsidian knowledge system. |

**Always work on `product/ai-agent-team`.** PR #13 targets
`platform/vercel-supabase` as its base so the diff stays readable.

---

## 3. Architecture map (key files)

**Extraction / AI**
- `api/_lib/extraction/engine.mjs` — the selector. `engineStatus()` reports mode
  (`agent-team` | `gemini` | `unconfigured`); `extractSmart()` routes. On total
  NVIDIA chain failure it falls back to Gemini **and labels it**
  (`fallback: 'gemini_direct'`) — silent degradation is forbidden.
- `api/_lib/extraction/agent-team.mjs` — `runAgentTeam()`. Sub-agent extracts →
  a **different** model second-opinions → `crossCheckExtractions` computes
  disagreements deterministically → **Gemini master audits completeness** under
  `MASTER_VERDICT_SCHEMA`. No master configured ⇒ `status:'skipped'`, reported
  honestly, never faked.
- `api/_lib/extraction/nvidia-pool.mjs` — the workforce. 3 free keys (one per
  NVIDIA account = 3 separate ~40 RPM budgets), `MODEL_REGISTRY` with live-probed
  `verified` flags, `ROLE_CHAINS` (extract / second_opinion / audit / vision_parse /
  layout), per-key pacing, per-model cooldown + auto-recovery, sanitized errors
  (never key material).
- `api/_lib/extraction/providers.mjs` — Gemini calls (`callGemini` for extraction,
  `callGeminiJson` for the master verdict) + `crossCheckExtractions`.
- `api/_lib/worker.mjs` — durable job processor. **The master has teeth here:**
  review is forced by disagreeing sub-agents *or* the master finding something both
  missed ⇒ `needs_review`, never silently `complete`.

**Commerce** (all under `api/_lib/commerce/`, routed via ONE function
`api/commerce/[action].mjs` + rewrites in `vercel.json` — Vercel Hobby caps at 12
functions; we're at 8.)
- `kv.mjs` — entitlements in Supabase `commerce_kv` (service-role only), replacing
  Netlify Blobs.
- `vercel.mjs` — web-Request adapter. **Reads the RAW byte stream** (bodyParser off)
  because Stripe webhook signatures verify exact bytes.
- `handlers/` — store-config, create-checkout-session, checkout-status,
  stripe-webhook, download-link, request-download-link, redeem-download-token.

**Frontend / desktop**
- `index.html` — the whole SPA (~4.5k lines). Local-first. `LOCAL_DESKTOP` +
  `cloudBase()` + `apiUrl()` gate all network calls.
- `account-core.js` + `vendor/supabase.min.js` — optional cloud-account layer.
- `desktop/main.cjs` — Electron shell, custom `estimation://` protocol, CSP.

**Database**
- `supabase/migrations/0001…0005` — all applied to the live project.

---

## 4. What is DONE and verified (with evidence)

| Piece | Evidence |
|---|---|
| Vercel + Supabase platform | PR #12 phases 1–8; every preview deploy Ready |
| Gemini-only runtime (no Anthropic) | `test-verify.mjs` asserts zero Anthropic refs |
| NVIDIA sub-agent pool | live-probed: deepseek-v4-flash/pro, glm-5.2, minimax-m3, nemotron-super-49b all answered |
| Agent team wired into live routes | `/api/extract/run` + durable worker; live run extracted 5/5 rows |
| **Vision OCR** | `llama-3.1-nemotron-nano-vl-8b-v1` read board `DB-00-08P` and **18/18 row lines** from a page IMAGE (EPO_Ashfield p2 @2400px, ~107s) |
| Store + entitlements + restore | 30 commerce + 10 gateway + 10 static + 4 browser-flow tests |
| Desktop optional cloud service | https-only opt-in; no address ⇒ zero outbound requests |
| **Gate #8 — no cross-tenant reads** | **LIVE PROVEN 2026-07-25**: `npm run test:rls` passes 6/6 against the real database |
| Full deterministic suite | `npm test` exit 0, ~16 suites |

**11 of 13 launch quality gates met** — see `docs/MIGRATION_QUALITY_GATES.md`.

### Real bugs found by live testing (all fixed — don't reintroduce)
1. **Infinite RLS recursion (`42P17`)** — `member_write` on `organization_members`
   ran a raw subquery against its own table instead of a SECURITY DEFINER helper,
   so evaluating the policy required evaluating itself forever. Fixed in
   `0005_fix_admin_recursion.sql` via `is_org_admin()`.
2. **Silently-always-false policy** — `org_update` wrote `m.org_id = id` meaning
   `organizations.id`, but `organization_members` also has an `id` column so
   Postgres resolved it to `m.id`. No owner could ever update their org. Same fix.
3. **Documented Postgres limitation (NOT a bug)** — a new row's RLS visibility for a
   `RETURNING` clause cannot depend on an `AFTER INSERT` trigger's side effect from
   the *same* statement. So org creation must generate the id client-side and insert
   **without** `.select()`. Any future app-level org-creation code must do the same.
4. Vercel Hobby 12-function cap — broke a deploy; fixed by collapsing commerce into
   one dynamic function.
5. Vercel Hobby daily-cron limit — broke a deploy; watchdog cron removed, scheduled
   externally instead.

---

## 5. What is NOT done (owner-gated, honest)

1. **Vercel env vars** — owner was mid-way through this. Needs `GEMINI_API_KEY`,
   `NVIDIA_API_KEY_1..3`, Supabase URL/publishable/service-role. **← resume here**
2. **Stripe** — activate, product/price, webhook → `/api/stripe-webhook`, 3 keys,
   then `COMMERCE_ENABLED=true`.
3. **Cloudflare R2 + gateway worker** — bucket, token, `wrangler deploy`.
4. **Code signing** — Azure Trusted Signing + Apple Developer ID into the GitHub
   `production` environment. Needs owner identity verification; can't be delegated.
5. **Domain** → Vercel.
6. **Production deploy** — explicit owner approval required (standing rule).
7. **Gate #2** — the 26CC07 regression (≈40 boards / 632 devices) needs the owner's
   private PDF, which is deliberately never committed.
8. **⚠️ Branding blocker** — the installer's appId is `com.hager.estimationtools`
   (leftover placeholder). Must become the owner's own identity, or get written
   Hager permission, **before signing and selling**. Owner has been told; awaiting
   decision.

---

## 6. Non-negotiable rules (learned the hard way)

- **Never modify `main`.** Never force-push shared branches.
- **Code computes, AI extracts.** No agent — not even the Gemini master — invents a
  count. Counting/grouping/reconciliation stay deterministic.
- **Honest states only.** `deriveState()` can never upgrade a zero-device-with-boards
  page to `complete`. `master: 'skipped'` is reported, never faked. Fallbacks are
  labelled. Never describe the system as "bulletproof".
- **Secrets:** never commit, print, or log. `.env.local` is gitignored (verify with
  `git check-ignore .env.local` BEFORE writing it). Service-role key never reaches a
  browser. `/api/public-config` hard-refuses any `service_role`-looking value.
- **Sweep before every commit:** `git diff --cached | grep -E "nvapi-[A-Za-z0-9_-]{40}|sk_(live|test)_[A-Za-z0-9]{16,}"`.
  Note: `test-store-static.mjs` contains a *secret-scanner regex* with the literal
  `sk_live` — that's guard code, a known false positive, not a leak.
- **Commit and push after every milestone.** The container resets frequently and
  uncommitted work HAS been lost. Small, frequent commits.

---

## 7. Environment gotchas (this WILL happen)

The container resets often. After a reset you typically find: wrong branch
(`platform/vercel-supabase` @ `e014d21`), no `node_modules`, no `.env.local`.

**First five minutes of any session:**
```bash
cd /home/user/Estimations-TOOL
git fetch origin --prune
git checkout -B product/ai-agent-team origin/product/ai-agent-team
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --no-audit --no-fund
git log --oneline -1        # confirm you're at the real tip
npm test                    # must exit 0
```

- **`.env.local` is wiped on reset.** Recreate it (gitignore-check first) with the
  Supabase URL + publishable key to run `npm run test:rls`. For `npm run test:nvidia`
  / `test:vision` you need the three NVIDIA keys — **ask the owner to re-paste them**,
  or read them from the Vercel env vars. They are NOT in the repo, by design.
- **Playwright** isn't a repo dependency; it's global. Use
  `NODE_PATH=$(npm root -g) node ...` for the browser store test and the PDF renderer.
- A stop-hook may warn about "Unverified committer" on `69d15e1` — that's GitHub's
  own PR merge commit on `main`. **Never amend it.** Just realign the branch.

**Useful commands**
```bash
npm test                                   # full deterministic suite (no network)
npm run test:rls                           # LIVE tenant-isolation proof (needs .env.local)
npm run test:nvidia                        # LIVE agent-team smoke (needs NVIDIA keys)
npm run test:vision -- <image.jpg> [rows]  # LIVE vision survey
NODE_PATH=$(npm root -g) node tools/render/page-to-jpeg.mjs <pdf> <page> <out.jpg> 2400
```
Dense UK schedules need **≥2400px** long edge — at 1600px the vision model skipped
the circuit table entirely.

---

## 8. Live infrastructure facts

- Supabase project ref: `ldhhuscifjxdgptneelb` (dashboard links use this).
  Migrations `0001–0005` **applied**. "Confirm email" is **OFF** (test project).
- Vercel project: **`estimations/estimations-tool`** (moved to the `estimations`
  team on 2026-07-26; it was `yacine8/…` before — older links 404). Env vars:
  `https://vercel.com/estimations/estimations-tool/settings/environment-variables`.
  Previews deploy green on every push.
- Netlify is still connected and builds a green preview of the static SPA — harmless
  legacy; the repo has no Netlify code. Owner to disconnect eventually.
- NVIDIA free tier **fluctuates minute to minute** — models that answer in 1s can
  stall on the next call. That's exactly why chains + cooldown exist. A stalled model
  is normal, not a bug; judge health by whether the *role chain* answered.

---

## 9. Suggested next actions

1. Help the owner finish **Vercel env vars** (they were on this step; NVIDIA key
   copy-paste was the sticking point).
2. Then Stripe → R2 → signing → domain, in that order.
3. Once env vars are live: hit the deployed `/api/extract/health` and confirm it
   reports `mode: "agent-team"` — first true end-to-end proof in the cloud.
4. Optional engineering: crop-then-read using the `layout` role (nemotron-parse
   bboxes) to speed up / sharpen vision extraction.
5. Resolve the appId/branding blocker before any signed build.

**Style the owner responds well to:** plain language over jargon, one step at a
time, exact click-by-click instructions with direct links, and honesty about what is
proven vs. assumed. They found multi-step dashboard navigation frustrating — be
concrete about *exactly* what to click and what to copy.
