# Fable implementation report — paid downloads, Gemini runtime, analysis honesty

Branch: `fable/paid-downloads` · one draft PR to `main` · for Codex review.
This report states what was built, what was verified and HOW, and what remains.
It deliberately avoids claims the evidence does not support.

## 1. What was implemented

### A. Analysis honesty / device recall (highest-priority addendum)

The motivating failure: a real project showed **7 boards / 0 devices** under a
green "Analysed" badge. That state is now structurally impossible:

- `buildAnalysisHealth()` (extractor-core, deterministic) evaluates every run
  against the documents' own evidence and returns
  `complete | incomplete | failed` with **stable reason codes**:
  `ZERO_DEVICES_WITH_BOARDS`, `BOARD_ROWS_MISSING`, `WAYS_UNACCOUNTED`,
  `SCHEDULE_PAGE_UNPARSED`, `SCHEDULE_DOC_NO_BOARDS`, `PAGE_TEXT_UNRELIABLE`,
  `OCR_PENDING`, `DOCUMENT_UNREADABLE`, `NO_CONTENT`.
  Boards present + zero devices anywhere ⇒ always `failed`.
- Per-page stage counters (`pageDiagnostics`: text lines, OCR route, schedule
  score + signals, rows parsed) are recorded on every analysis.
- **Schedule candidacy is multi-signal** (`scoreScheduleCandidate`): way
  sequences, device tokens, rating tokens, curve+phase, column headers, board
  headers — a page is parsed as a schedule because of its content, never only
  a classifier label. High-scoring pages that yield zero rows are flagged.
- **State-aware UX:** project badges show `Analysed / Needs review /
  Incomplete / Analysis failed`; the Boards & Devices tab shows a health
  panel with each reason, the affected document/page/board, and recovery
  actions (re-OCR + re-analyse, diagnostics export).
- **Exports are refused** (CSV and XLSX) while health is not `complete`,
  with an explanation and a jump to the health panel.
- **Private-safe diagnostics export:** reason codes, counters and page shapes
  with anonymised `doc-N` tags — no document text, no board names, no file
  names. Verified by test that a leaked name fails the suite.
- `.private-fixtures/` is gitignored for customer repro documents.

### B. Commerce / paid downloads (base brief)

- 7 Netlify endpoints under `/api/…` (store-config, create-checkout-session,
  stripe-webhook, checkout-status, request-download-link,
  redeem-download-token, download-link) with: server-only pricing,
  signature-verified idempotent webhook fulfilment, refund revocation on
  every link mint, anti-enumeration restore (identical responses, fail-closed
  rate limits, single-use hashed 15-min tokens), signed `__Host-` cookies,
  and manifest-allow-listed delivery. Ships **disabled**
  (`COMMERCE_ENABLED=false`); `.env.example` carries names only.
- `/download/` store, success, restore and legal pages in the app's design
  language, fully driven by `/api/store-config` (coming-soon state when
  disabled); marketing screenshot captured from the real app.
- Release pipeline: 4-target signed-build workflow (Windows x64/ARM64 via
  Azure Trusted Signing, macOS x64/ARM64 via Developer ID + notarisation +
  stapling), preflight that **fails production tags without signing
  secrets**, per-job signature verification commands, manifest built from
  the actual files (size + SHA-256) and validated before publish; publisher
  uploads the manifest last.

### C. Gemini-only runtime + custom domains (addendum)

- `@anthropic-ai/sdk` removed; no runtime file reads `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, `EXTRACTION_MODEL` or `CLAUDE_MODEL` (pinned by
  test). `providers.mjs` is Gemini-only with the model pinned to an exact id.
  Cross-check second-opinion machinery and its UI removed. `CLAUDE.md`
  remains as development-agent instructions (not runtime).
- **Explicit consent gate:** online extraction is off by default and the
  first enable shows a dialog stating exactly what is sent (page image +
  detected text) before anything leaves the machine; desktop builds keep it
  forced off.
- `workers/download-gateway/`: Cloudflare Worker for `files.{ROOT_DOMAIN}`
  sharing the SAME claim module the API mints with — exact-key
  authorisation, ≤300 s expiry, attachment disposition, resumable range
  requests, no bucket listing, only `DOWNLOAD_TOKEN_SECRET` on the Worker.
- Customer-visible URLs use `{ROOT_DOMAIN}` placeholders; a static test
  fails the suite if provider hostnames appear in store pages.
- Docs: `COMMERCE_AND_DOWNLOADS.md`, `PRODUCTION_RELEASE_RUNBOOK.md`,
  `OWNER_LAUNCH_CHECKLIST.md`, `CUSTOM_DOMAIN_RUNBOOK.md`.

## 2. How it was verified

| Area | Evidence |
|---|---|
| Health model | 11 unit tests incl. the 7-boards/0-devices regression; browser end-to-end: healthy demo shows no banner, synthetic gap project shows `Analysis failed`, banner reasons, blocked CSV export, private-safe diagnostics |
| Commerce | 30 unit tests with mocked Stripe/R2/store/email (price smuggling, webhook replay, refunds, enumeration, cookie tamper, claim tamper/expiry) |
| Store pages | 10 static checks + 4 Chromium end-to-end tests against a stubbed API (coming-soon, buy→success→download with SHA-256, restore, mobile) |
| Gateway | 10 tests over the real Worker handler with the real claim signer (mint→verify loop, ranges, traversal, audience, expiry) |
| Manifest | schema/duplicate/traversal/zero-byte/unsigned-production tests |
| Gemini-only | tests assert no Anthropic exports/refs in runtime files and no SDK dependency |
| Whole suite | `npm test` (15 suites) and `npm run test:store` pass locally |

## 3. What was NOT verified (and is therefore not claimed)

- **No live Stripe, R2, Resend or Gemini calls were made.** All integration
  behaviour is proven against fakes; the owner's dress rehearsal
  (checklist §7) is the first live exercise.
- **No signed installer was produced in this environment** — CI signing
  requires the owner's Azure/Apple secrets. The workflow enforces signing on
  production tags but has not run end-to-end here.
- **SmartScreen:** signing + identity work reduces warnings; per-file
  reputation is accumulated by Microsoft over time. No claim is made that
  SmartScreen warnings are eliminated.
- **Extraction recall:** the health model makes gaps visible and blocks
  misleading exports; it does not guarantee every device is captured. No
  claim of complete extraction is made. The original "Hubert" documents were
  not available in this environment; the regression is encoded as synthetic
  fixtures matching the reported failure shape.
- Coordinate-based spatial row reconstruction and OCR candidate routing
  pre-date this branch (earlier workstreams) and were left in place; this
  branch adds the candidacy scoring and the honesty layer above them, not a
  rewrite of those parsers.
- The desktop appId (`com.hager.estimationtools`) requires the owner's
  confirmation they may sign under that identity.

## 4. Release-gate status

| Gate | Status |
|---|---|
| Full local test suite green | PASS |
| Store browser tests green | PASS |
| Commerce disabled by default, env names only | PASS |
| No secrets in repo | PASS (checked; `.env*` gitignored) |
| Signed 4-target build from CI | **NOT RUN — owner secrets required** |
| Live checkout → download → refund rehearsal | **NOT RUN — owner accounts required** |
| Custom domain + gateway deployed | **NOT RUN — owner domain required** |

READY FOR CODEX REVIEW - NOT READY FOR PRODUCTION
