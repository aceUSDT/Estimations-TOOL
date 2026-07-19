---
type: decisions
project: Estimation Tools
status: active
created: 2026-07-19
updated: 2026-07-19
tags: [project/estimation-tools, decisions]
---

# 03 - Decisions

> [!note]
> Only decisions supported by current evidence are recorded. Where original rationale is not
> documented in the repo, that is stated rather than invented. Decisions marked *(branch)* are
> accepted on `fable/paid-downloads` (PR #10) and become `main` truth only if/when merged.

## Index

- [[#DEC-001 — AI extracts, code computes]]
- [[#DEC-002 — Server-side API key via serverless function]]
- [[#DEC-003 — Local-first storage]]
- [[#DEC-004 — Gemini as the sole runtime AI provider]]
- [[#DEC-005 — Structural analysis honesty]]
- [[#DEC-006 — Commerce architecture, disabled by default]]
- [[#DEC-007 — Explicit consent before online extraction]]

---

### DEC-001 — AI extracts, code computes

**Date:** undocumented (predates this knowledge base; stated in `CLAUDE.md`)
**Status:** Accepted
**Context:** Counting/pricing errors are unacceptable; LLM arithmetic is not trustworthy.
**Decision:** The model only classifies, extracts and structures documents. All counting,
aggregation, diversity and pricing are deterministic code.
**Rationale:** Determinism and auditability of quantities.
**Alternatives considered:** Undocumented.
**Consequences:** Aggregation logic lives in `extractor-core.js` / `report-core.js`; model
output is treated as evidence, never as final numbers.
**Implementation references:** `extractor-core.js` (`aggregateDevices`), `report-core.js`.
**Related:** [[01 - Requirements#^req-func-004|REQ-FUNC-004]].

### DEC-002 — Server-side API key via serverless function

**Date:** undocumented (stated in `CLAUDE.md`)
**Status:** Accepted
**Context:** A browser-shipped provider key would be a live leak.
**Decision:** Provider API keys live only in server-side env vars; every provider call goes
through a Netlify Function.
**Rationale:** Prevent key exposure in the client bundle.
**Consequences:** All AI calls are proxied; the client holds no key.
**Implementation references:** `netlify/functions/extract*.mjs`, `netlify/functions/lib/providers.mjs`.
**Related:** [[01 - Requirements#^req-sec-001|REQ-SEC-001]].

### DEC-003 — Local-first storage

**Date:** undocumented (README "Privacy and storage")
**Status:** Accepted
**Context:** Users' electrical documents are sensitive; no central account is wanted.
**Decision:** Projects and originals are stored locally (IndexedDB in browser, OS profile in
Electron). The desktop app runs without the deployed website.
**Rationale:** Privacy; offline desktop operation.
**Consequences:** No server-side project store; backup/restore via `.estimation-project` files.
**Implementation references:** `index.html` (idb, rawStore), `desktop/`.
**Related:** [[01 - Requirements#^req-nfr-001|REQ-NFR-001]].

### DEC-004 — Gemini as the sole runtime AI provider

**Date:** 2026-07-18 *(branch)*
**Status:** Accepted (branch `fable/paid-downloads`; not yet merged to `main`)
**Context:** The runtime previously supported Anthropic + a Gemini cross-check; the addendum
required a single free-tier-friendly provider with no Anthropic runtime dependency.
**Decision:** Remove `@anthropic-ai/sdk` and all Anthropic runtime reads; `providers.mjs` is
Gemini-only with `GEMINI_MODEL` pinned to an exact id; the cross-check machinery/UI is deleted.
**Rationale:** Simpler, cheaper runtime; no Anthropic key needed to operate; `CLAUDE.md`
remains dev-agent guidance only.
**Alternatives considered:** Keep dual-provider cross-check (rejected: cost/complexity).
**Consequences:** Extraction depends on `GEMINI_API_KEY`; a test pins that no Anthropic
reference remains in the runtime.
**Implementation references:** `netlify/functions/lib/providers.mjs`, `tools/coverage/test-verify.mjs`.
**Related:** [[01 - Requirements#^req-int-001|REQ-INT-001]].

### DEC-005 — Structural analysis honesty

**Date:** 2026-07-18 *(branch)*
**Status:** Accepted (branch)
**Context:** A real project ("Hubert") reported **7 boards / 0 devices** under a green
"Analysed" badge. See [[05 - Bugs#BUG-001 — Zero-device analysis reported as "Analysed"]].
**Decision:** A deterministic health model (`buildAnalysisHealth`) evaluates each run against
the documents' own evidence and returns `complete / incomplete / failed` with stable reason
codes; boards-with-zero-devices is always `failed`; **CSV/XLSX exports are refused** while
health ≠ complete; a private-safe diagnostics export (reason codes + counts, no document text)
is available.
**Rationale:** Make missed data impossible to present as success.
**Consequences:** Status badges become state-aware; exports gated; new reason-code vocabulary.
**Implementation references:** `extractor-core.js` (`buildAnalysisHealth`,
`scoreScheduleCandidate`, `buildDiagnosticExport`), `index.html` (`renderHealthBanner`,
`exportBlockedByHealth`), `tools/coverage/test-analysis-health.mjs`.
**Related:** [[01 - Requirements#^req-func-006|REQ-FUNC-006]].

### DEC-006 — Commerce architecture, disabled by default

**Date:** 2026-07-18 *(branch)*
**Status:** Accepted (branch)
**Context:** Sell signed desktop installers without leaking keys or exposing provider hostnames.
**Decision:** Stripe-hosted Checkout; Netlify Blobs entitlements; private Cloudflare R2 bucket;
a signed-claim Worker gateway on `files.{ROOT_DOMAIN}`; a release manifest as the single
allow-list. Commerce ships **disabled** (`COMMERCE_ENABLED=false`); `.env.example` has names
only.
**Rationale:** Security-by-construction (server-only pricing, idempotent webhooks, refund
revocation, anti-enumeration restore) and safe-by-default shipping.
**Alternatives considered:** Presigned R2 URLs directly (kept only as staging fallback — R2
presigned URLs can't use custom domains).
**Consequences:** 7 endpoints + Worker + docs; no live rehearsal performed here.
**Implementation references:** `netlify/functions/*`, `workers/download-gateway/`,
`docs/COMMERCE_AND_DOWNLOADS.md`, `tools/coverage/test-commerce.mjs`, `test-download-gateway.mjs`.
**Related:** [[01 - Requirements#^req-func-009|REQ-FUNC-009]], [[01 - Requirements#^req-sec-003|REQ-SEC-003]].

### DEC-007 — Explicit consent before online extraction

**Date:** 2026-07-18 *(branch)*
**Status:** Accepted (branch)
**Context:** Sending a page to a third-party model is a privacy-material action.
**Decision:** Online extraction is off by default; the first enable shows a consent dialog
stating exactly what is sent (page image + detected text); desktop stays local-only.
**Rationale:** Informed consent; privacy.
**Consequences:** No page leaves the device without an explicit opt-in.
**Implementation references:** `index.html` (consent gate on `#anOnlineExtraction`).
**Related:** [[01 - Requirements#^req-sec-004|REQ-SEC-004]].
