---
type: research
project: Estimation Tools
status: active
created: 2026-07-19
updated: 2026-07-19
tags: [project/estimation-tools, research]
---

# 06 - Research

> [!note]
> Findings are labelled by confidence. Nothing here is external research that was not actually
> performed; items are drawn from this repo's code, docs and platform constraints.

## Active research

- Real-world extraction recall against a labelled corpus — **not yet measured** in this
  environment. The coverage report (`buildCoverage`) gives expected-vs-captured per board but
  a headline recall number requires ground-truth documents. Related:
  [[01 - Requirements#Open requirement questions]].

## Verified findings

- **Extraction is two-layer.** A deterministic pass (`extractor-core.js`) runs first; optional
  online model extraction supplements it and is merged as review-pending rows (on `main`:
  Anthropic + Gemini cross-check; PR #10: Gemini-only). *(Fact: code.)*
- **R2 presigned URLs cannot use a custom domain.** This is why paid downloads go through the
  Cloudflare Worker gateway on `files.{ROOT_DOMAIN}` rather than raw presigned URLs; presigned
  URLs are kept only as a staging fallback. *(Fact: `docs/COMMERCE_AND_DOWNLOADS.md`, `r2.mjs`.)*
- **Netlify sync functions cap around ~26 s.** Dense-page extraction therefore uses a
  background function (`extract-background.mjs`) with client polling of `extract-status`.
  *(Fact: code comments + implementation.)*
- **One signed-claim module serves both sides.** `download-claim.mjs` (Web Crypto HMAC) is
  imported by both the Netlify minter and the Worker verifier, so mint and verify cannot drift.
  *(Fact: code; `test-download-gateway.mjs`.)*

## Assumptions

- *(assumption)* The desktop `appId` currently in `desktop/electron-builder.config.cjs`
  requires the owner's authorisation to sign under that identity. Flagged in
  `FABLE_IMPLEMENTATION_REPORT.md`; not independently confirmed.
- *(assumption)* Signing reduces, but does not eliminate, Windows SmartScreen warnings —
  reputation accrues per file hash over time. No SmartScreen-elimination claim is made.

## Recommendations

- Before any production claim, run `docs/OWNER_LAUNCH_CHECKLIST.md` end-to-end (Stripe test
  mode → download → refund) and produce one signed installer via CI.
- Consider decomposing the very large `index.html` over time to reduce change-risk (see
  [[02 - Architecture#Known architectural risks]]).

## Unresolved questions

> [!question]
> **Real local Obsidian vault path.** This container has no Obsidian and cannot reach the
> user's Windows vault. To wire a local machine, the exact vault path is needed (e.g.
> `C:\Users\<you>\<Vault>`), after which `.claude/settings.local.json` →
> `additionalDirectories` should point at `<VAULT>/Projects/Estimation Tools`.

> [!question]
> Is there a numeric recall target that defines extraction "done"? (Mirrors
> [[01 - Requirements#Open requirement questions]].)

> [!question]
> Scope of the priced-quote feature — shipping requirement or exploratory?

## Sources

- Repo: `CLAUDE.md`, `README.md`, `docs/BUILD_BRIEF.md`, `docs/COMMERCE_AND_DOWNLOADS.md`,
  `docs/PRODUCTION_RELEASE_RUNBOOK.md`, `docs/OWNER_LAUNCH_CHECKLIST.md`,
  `docs/CUSTOM_DOMAIN_RUNBOOK.md`, `FABLE_IMPLEMENTATION_REPORT.md`.
- Code: `index.html`, `extractor-core.js`, `report-core.js`, `netlify/functions/*`,
  `workers/download-gateway/*`, `tools/coverage/*`.
