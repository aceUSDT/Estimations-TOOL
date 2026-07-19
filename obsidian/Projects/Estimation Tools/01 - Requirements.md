---
type: requirements
project: Estimation Tools
status: active
created: 2026-07-19
updated: 2026-07-19
tags: [project/estimation-tools, requirements]
---

# 01 - Requirements

> [!note]
> Requirements below are **extracted** from `CLAUDE.md`, `README.md`, `docs/` and observed
> code behaviour. Where a requirement is inferred from implementation rather than stated
> explicitly, it is labelled *(inferred)*. Verification status reflects evidence available in
> this environment, not a live production run.

## Functional requirements

- **REQ-FUNC-001 — Three-type classification.** Classify each document page as exactly one of
  *Schematic / Distribution Board Schedule / Specification*.
  Status: implemented. Refs: `extractor-core.js` (`toThreeType`, `THREE_TYPES`). ^req-func-001
- **REQ-FUNC-002 — Per-board device take-off.** Produce a device table per board reference.
  Status: implemented. Refs: `index.html` (Boards & Devices tab, `renderResults`), `report-core.js`. ^req-func-002
- **REQ-FUNC-003 — Supply hierarchy.** Make the input→output relationship explicit (which
  board feeds which, via which protective device and cable). Status: implemented (feeders /
  "supplied from"). Refs: `index.html` (`parseFeeders`, board tree). ^req-func-003
- **REQ-FUNC-004 — Deterministic pre-pass + optional AI extraction.** A regex/deterministic
  pass runs first; optional online extraction supplements it (on `main`: Anthropic primary +
  Gemini cross-check; Gemini-only under PR #10). Status: implemented.
  Refs: `extractor-core.js`, `netlify/functions/extract*.mjs`. Related: [[03 - Decisions#DEC-001 — AI extracts, code computes]]. ^req-func-004
- **REQ-FUNC-005 — Coverage / reconciliation.** Compare expected-vs-captured per board (a
  header of "18 WAY" ⇒ expect 18 ways) and surface shortfalls. Status: implemented.
  Refs: `extractor-core.js` (`buildCoverage`, `expectedWaysFromText`). ^req-func-005
- **REQ-FUNC-006 — Analysis health honesty.** An analysis may present as "Analysed" only when
  invariants hold; boards found with zero devices ⇒ `failed`. Status: implemented on
  `fable/paid-downloads`. Refs: `extractor-core.js` (`buildAnalysisHealth`). Related:
  [[05 - Bugs#BUG-001 — Zero-device analysis reported as "Analysed"]], [[03 - Decisions#DEC-005 — Structural analysis honesty]]. ^req-func-006
- **REQ-FUNC-007 — Cross-referencing.** Compare schematic vs DB-schedule and flag
  discrepancies for the user; never auto-resolve. Status: implemented. Refs: `index.html`
  (`buildCrossReference`). ^req-func-007
- **REQ-FUNC-008 — Reports / export.** Export the take-off as CSV and XLSX. Status:
  implemented; **exports are gated** while analysis health ≠ complete. Refs: `report-core.js`,
  `index.html` (`exportBlockedByHealth`). ^req-func-008
- **REQ-FUNC-009 — Paid desktop downloads (commerce).** Sell and deliver signed desktop
  installers via Stripe Checkout + private R2 + branded download gateway. Status: implemented
  on branch, **ships disabled** (`COMMERCE_ENABLED=false`). Refs: `netlify/functions/*`,
  `workers/download-gateway/`, `docs/COMMERCE_AND_DOWNLOADS.md`. Related:
  [[03 - Decisions#DEC-006 — Commerce architecture, disabled by default]]. ^req-func-009

## Non-functional requirements

- **REQ-NFR-001 — Local-first storage.** Projects and original documents stay on the user's
  device (browser IndexedDB / Electron profile); no central project account. Status:
  implemented. Refs: `index.html` (idb + rawStore), README "Privacy and storage".
  Related: [[03 - Decisions#DEC-003 — Local-first storage]]. ^req-nfr-001
- **REQ-NFR-002 — Redeployable to Netlify.** Static SPA + functions must stay deployable.
  Status: holds. Refs: `netlify.toml`. ^req-nfr-002
- **REQ-NFR-003 — Don't break the working app.** Feature work is incremental and verified
  against real example documents. Refs: `CLAUDE.md`, `examples/`. ^req-nfr-003

## Security requirements

- **REQ-SEC-001 — Server-side keys only.** No AI/provider key in the browser bundle or repo;
  all provider calls go through serverless functions. Status: holds (Gemini key server-side).
  Refs: `netlify/functions/lib/providers.mjs`. Related: [[03 - Decisions#DEC-002 — Server-side API key via serverless function]]. ^req-sec-001
- **REQ-SEC-002 — No committed secrets.** `.env` / `.env.*` gitignored; `.env.example`
  carries variable **names only**. Status: holds. Refs: `.gitignore`, `.env.example`. ^req-sec-002
- **REQ-SEC-003 — Payment integrity.** Price is server-decided; webhooks signature-verified;
  refunds revoke downloads; download links are short-lived signed claims. Status: implemented
  on branch, covered by `tools/coverage/test-commerce.mjs` + `test-download-gateway.mjs`. ^req-sec-003
- **REQ-SEC-004 — Explicit consent before any page leaves the device.** Online extraction is
  off by default and prompts before sending a page. Status: implemented on branch. Refs:
  `index.html` (consent gate on `#anOnlineExtraction`). Related: [[03 - Decisions#DEC-007 — Explicit consent before online extraction]]. ^req-sec-004

## Performance requirements

- **REQ-PERF-001 — Dense-page extraction within platform limits.** Long extractions use a
  Netlify **background** function (no ~26 s sync ceiling) with client polling. Status:
  implemented. Refs: `netlify/functions/extract-background.mjs`, `extract-status.mjs`.
  *(inferred as a requirement from the implementation's stated rationale.)* ^req-perf-001

## Usability requirements

- **REQ-USE-001 — Honest, state-aware UX.** Project/analysis status badges reflect real state
  (`Analysed / Needs review / Incomplete / Analysis failed`); gaps are shown with reasons and
  recovery actions rather than a shorter silent list. Status: implemented on branch. Refs:
  `index.html` (`renderHealthBanner`). ^req-use-001

## Integration requirements

- **REQ-INT-001 — Gemini extraction provider.** Google Gemini is the sole runtime AI provider
  (`GEMINI_API_KEY`, pinned `GEMINI_MODEL`). Status: implemented on branch. Refs:
  `netlify/functions/lib/providers.mjs`. Related: [[03 - Decisions#DEC-004 — Gemini as the sole runtime AI provider]]. ^req-int-001
- **REQ-INT-002 — Signed installers.** Windows (Azure Trusted Signing) + macOS (Developer ID
  + notarisation) via CI secrets; production tags fail without signing secrets. Status:
  workflow implemented, **not exercised end-to-end here**. Refs: `.github/workflows/desktop.yml`,
  `desktop/electron-builder.config.cjs`. ^req-int-002

## Constraints

- AI must not count, aggregate, or price — those are deterministic code.
- Over-capture beats omission; uncertain items go to the Review queue, never dropped.
- Conflicts between documents are flagged, never auto-merged.
- Provenance (source document, page) + confidence on every extracted board/device.

## Acceptance criteria (cross-cutting)

- Coverage report shows expected-vs-captured per board across `examples/`.
- `npm test` (deterministic suites) and `npm run test:store` (Playwright) pass.
- No secret appears in any committed file.

## Open requirement questions

> [!question]
> Is there a numeric target recall rate (e.g. ≥ 99% of ways captured) that defines "done" for
> REQ-FUNC-001..006, measured against a labelled corpus? Not found stated in the repo.

> [!question]
> Are pricing/quote outputs a shipping requirement or exploratory? CLAUDE.md marks pricing
> "secondary"; scope of the priced-quote feature is not fully specified.
