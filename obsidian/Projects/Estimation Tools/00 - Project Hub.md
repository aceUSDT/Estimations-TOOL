---
type: project-hub
project: Estimation Tools
status: active
created: 2026-07-19
updated: 2026-07-19
area: electrical-estimating
tags: [project/estimation-tools, hub]
---

# 00 - Project Hub

> [!note]
> Concise current orientation. Canonical detail lives in the linked notes — this hub is not
> a full project history. Update it only when the current status materially changes.

## Purpose

**Estimation Tools** (a.k.a. *Estimation 101 — Electrical Document Intelligence*) is a
local-first application that reads UK electrical documents — LV schematics, distribution-board
schedules and specifications — and produces a **structured, verifiable device take-off per
board reference**, with the input→output supply relationship made explicit, and secondarily a
priced quote. It runs as a Netlify single-page app (`index.html`) and as a packaged Windows /
macOS desktop app (Electron, `desktop/`). *(Fact: CLAUDE.md, README.md, index.html.)*

## Current status

- Core take-off app works and is deployed. Tabs: Projects, Documents, Viewer,
  **Boards & Devices** (merged), Reports, Review, Compare. *(Fact: index.html.)*
- A large feature branch **`fable/paid-downloads`** is open as **draft PR #10 → main**,
  carrying: structural analysis-honesty (health model), a Gemini-only extraction runtime,
  a Stripe paid-download commerce layer (shipped disabled), and a Cloudflare Worker download
  gateway. PR body ends `READY FOR CODEX REVIEW - NOT READY FOR PRODUCTION`. *(Fact: PR #10.)*
- No live Stripe / R2 / Gemini calls have been exercised in CI; no signed installer has been
  produced here. *(Fact: FABLE_IMPLEMENTATION_REPORT.md.)*
- **Baseline note:** `main` (`454f1f5`) runs a **dual-provider** extraction (Anthropic primary +
  free Gemini cross-check) and does **not** yet include the PR #10 analysis-health model,
  Gemini-only runtime, or commerce layer. Notes mark PR #10-only items *(branch)*.

## Current phase

Awaiting Codex review of PR #10; branch is `mergeable_state: clean`. Product feature phases D
(canvas viewer + revision diff, Compare rebuild) and E (desktop packaging polish) remain
open. *(Fact: PR #10 + repo task list.)*

## Primary objectives

1. **Recall / completeness first** — never silently miss boards, rows or documents.
2. Accurate per-board device take-off with explicit supply hierarchy (which board feeds
   which, via which protective device and cable).
3. Pricing is secondary and must never reduce take-off accuracy.

*(Fact: CLAUDE.md "Priority order".)*

## Principal constraints

- **AI extracts, code computes** — all counting, aggregation and pricing are deterministic.
- API keys are **server-side only**, behind serverless functions; never in the browser bundle.
- Never commit secrets; `.env*` gitignored.
- Over-capture beats omission; flag conflicts, never auto-resolve.
- Provenance + confidence on every extracted board and device.
- Must stay redeployable to Netlify.

See [[01 - Requirements]] and [[03 - Decisions]].

## Key components

- `index.html` — SPA: UI, local storage, PIN lock, analysis pipeline, AI-extraction client.
- `extractor-core.js` — deterministic parsers, coverage + **analysis-health** model.
- `report-core.js` — report model and CSV/XLSX export.
- `netlify/functions/` — Gemini extraction + commerce endpoints (server-side keys).
- `workers/download-gateway/` — Cloudflare Worker serving the private R2 release bucket.
- `desktop/` — Electron packaging; `tools/coverage/` — test suites.

Detail: [[02 - Architecture]].

## Current blockers

- [[06 - Research#Unresolved questions]]: real local Obsidian vault path (to wire a local
  machine); desktop `appId` authorisation; live commerce rehearsal not yet performed.

## Immediate next actions

- [[04 - Tasks#Current priorities]] — respond to Codex review on PR #10; do not merge.
- Keep this knowledge base updated as PR #10 evolves.

## Recent material changes

- 2026-07-19 — Obsidian project knowledge system initialised (this hub + canonical notes).
  See [[07 - Session Log]].

## Canonical notes

- [[01 - Requirements]]
- [[02 - Architecture]]
- [[03 - Decisions]]
- [[04 - Tasks]]
- [[05 - Bugs]]
- [[06 - Research]]
- [[07 - Session Log]]
