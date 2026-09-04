---
type: architecture
project: Estimation Tools
status: active
created: 2026-07-19
updated: 2026-07-19
tags: [project/estimation-tools, architecture]
---

# 02 - Architecture

> [!note]
> **Baseline:** this describes the architecture of `main` (`454f1f5`). Items introduced by the
> in-flight **PR #10** (`fable/paid-downloads`) that are **not yet merged** are marked
> *(branch)*. In particular, on `main` the extraction runtime is **dual-provider** (Anthropic
> primary + free Gemini cross-check); the Gemini-only runtime, the analysis-health model and
> the entire commerce/download layer are *(branch)* only. Aspirational/proposed items are
> under [[06 - Research]], not here.

## System overview

A local-first client (`index.html`, a single large SPA) does document ingestion, OCR
fallback, deterministic extraction, reconciliation, review and reporting **entirely in the
browser / Electron renderer**. Optional online AI extraction and the commerce/download layer
are the only server-side pieces, implemented as **Netlify Functions**; a **Cloudflare Worker**
serves paid installer downloads from private R2. *(Fact.)*

```
Browser / Electron renderer (index.html + extractor-core.js + report-core.js)
   │  local storage (IndexedDB / Electron profile), PIN lock
   │  deterministic extraction + coverage + analysis-health
   │
   ├── optional online extraction ──► Netlify Function /api extract (Gemini)  (branch)
   │
   └── paid download (branch) ──► Netlify /api commerce ──► Stripe / Netlify Blobs / R2
                                          └─ signed claim ──► files.{ROOT_DOMAIN} Worker ──► R2
```

## Major components & responsibilities

- **`index.html`** — UI for all tabs; app state; PIN lock (`sha256(salt+pin)`, a screen lock,
  not encryption); document ingest (PDF via pdf.js, XLSX via ExcelJS, images, text); OCR
  routing; the `runAnalysis` pipeline; the AI-extraction client; rendering of boards, devices,
  reports, review, compare; the health banner and export gating.
- **`extractor-core.js`** — deterministic domain logic: board-reference detection, schedule
  dialect parsers, `parseProtectionLegend`, `aggregateDevices`, coordinate row reconstruction,
  OCR candidate scoring, `buildCoverage`/`expectedWaysFromText`, and the **analysis-health**
  model (`buildAnalysisHealth`, `scoreScheduleCandidate`, `buildDiagnosticExport`). *(branch)*
- **`report-core.js`** — report model + CSV / XLSX workbook generation.
- **`netlify/functions/extract.mjs` / `extract-background.mjs` / `extract-status.mjs`** —
  synchronous health/extract endpoint, background function for dense pages, and status polling.
- **`netlify/functions/lib/providers.mjs`** — on `main`, a **dual-provider** module: Anthropic
  primary + Gemini free cross-check via `extractWithVerification` (`CLAUDE_MODEL`,
  `GEMINI_MODEL`). PR #10 replaces it with a Gemini-only provider (`callGemini`, pinned
  `GEMINI_MODEL`, cross-check removed). *(branch)*
- **`netlify/functions/lib/domain-pack.mjs`** — extraction JSON schema + system prompt +
  `coerceResult`.
- **Commerce functions** *(branch)* — `store-config`, `create-checkout-session`,
  `stripe-webhook`, `checkout-status`, `request-download-link`, `redeem-download-token`,
  `download-link`, with libs `commerce.mjs`, `entitlements.mjs`, `session-cookie.mjs`,
  `email.mjs`, `r2.mjs`, `download-claim.mjs`, `release-store.mjs`.
- **`workers/download-gateway/`** *(branch)* — Cloudflare Worker verifying a signed claim and
  streaming the exact allow-listed object from private R2 (range requests, attachment
  disposition, no listing).
- **`desktop/`** — Electron shell + `electron-builder` config; bundles pdf.js + Tesseract for
  offline use.

## Data flow (take-off)

1. User creates a project and drops documents (Documents tab).
2. Each page is ingested: native PDF text, or OCR fallback when text is unreliable.
3. `runAnalysis` (`index.html`) runs the deterministic pass over pages: board detection,
   schedule parsing, feeders, cables; records per-page stage counters.
4. Optionally, approved pages are sent to the Gemini extractor and merged as review-pending
   rows *(branch, with explicit consent)*.
5. Coverage + `buildAnalysisHealth` compute completeness → `complete / incomplete / failed`.
6. Deterministic aggregation produces device totals per board; Reports export to CSV/XLSX
   (blocked when health ≠ complete).

## Important interfaces

- **Extraction HTTP**: `GET /api/... extract` health probe → `{configured, providers:{gemini},
  model}`; `POST` a page (image + text) → structured result. *(branch: Gemini-only shape.)*
- **Commerce `/api/*`** *(branch)* — routed by each function's `config.path`; inert unless
  `COMMERCE_ENABLED=true` and full env present.
- **Download claim** — HMAC-signed, audience + exact object key + ≤300 s expiry; the identical
  `download-claim.mjs` module is used by both the Netlify minter and the Worker verifier.

## External dependencies

On `main`: `@anthropic-ai/sdk`, `@netlify/blobs`, `exceljs`; runtime AI = Anthropic (primary)
+ Google Gemini (free cross-check). PR #10 *(branch)* removes `@anthropic-ai/sdk` and adds
`stripe`, `@aws-sdk/client-s3` + `s3-request-presigner` (R2) for commerce, making Gemini the
sole runtime provider. Vendored client libs: pdf.js, Tesseract. *(Fact: `package.json` on each
ref.)*

## Storage

- **Client**: IndexedDB (projects, analyses) + in-memory raw file store; Electron uses the OS
  user profile. No server-side storage of customer documents.
- **Commerce** *(branch)*: Netlify Blobs store `commerce-entitlements` (session id, HMAC of
  email, payment-intent id, status — no cards, no documents). Release binaries in private R2.

## Authentication & authorisation

- No user accounts for the take-off app; a **local PIN** gates the UI only.
- Commerce *(branch)*: signed `__Host-` download-session cookie + entitlement re-read on every
  link mint (refunds revoke immediately); Stripe webhook signature is the fulfilment authority.

## Testing architecture

Node-based deterministic suites under `tools/coverage/` run without network via injected
fakes (`test-commerce.mjs`, `test-download-gateway.mjs`, `test-analysis-health.mjs`,
`test-release-manifest.mjs`, `test-verify.mjs`, `test-extract-function.mjs`, dialect/OCR/report
regressions). `npm run test:store` drives the store pages in Chromium (Playwright) against a
stubbed API. *(Fact: `package.json` scripts.)*

## Deployment architecture

Netlify hosts the static SPA + functions (`netlify.toml`: publish `.`, functions in
`netlify/functions`, esbuild bundler). Desktop releases are built + signed by GitHub Actions
(`.github/workflows/desktop.yml`) and published to R2; the Worker serves them on
`files.{ROOT_DOMAIN}`. Customer-visible URLs use `{ROOT_DOMAIN}` placeholders. *(branch)*

## Known architectural risks

- The SPA is a single very large `index.html`; most client logic is concentrated there,
  raising change-risk and review cost.
- Commerce/gateway paths are verified only against fakes in this environment — no live
  Stripe/R2/Gemini exercise. See [[05 - Bugs]] and [[06 - Research#Unresolved questions]].

## Related

- [[03 - Decisions]] — architecture-shaping decisions.
- [[01 - Requirements]] — requirements these components satisfy.
