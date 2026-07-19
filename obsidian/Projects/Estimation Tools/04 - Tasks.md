---
type: tasks
project: Estimation Tools
status: active
created: 2026-07-19
updated: 2026-07-19
tags: [project/estimation-tools, tasks]
---

# 04 - Tasks

> [!note]
> Tasks reflect real project evidence (PR #10 state and the repo's own task list). No
> speculative backlog is invented to fill the file. "Completed and verified" means verified in
> **this** environment (deterministic tests / browser e2e), not a live production run.

## Current priorities

- [ ] Respond to Codex review on **PR #10** (`fable/paid-downloads → main`). Do **not** merge;
      keep it a draft. Acceptance: review comments addressed or answered; branch stays
      `mergeable_state: clean`. Related: [[00 - Project Hub]].
- [ ] Keep this knowledge base current as PR #10 evolves (update [[03 - Decisions]],
      [[05 - Bugs]], [[07 - Session Log]] on material change).

## In progress

- [ ] PR #10 review cycle (draft, awaiting Codex). Owner: maintainer + reviewer.

## Blocked

- [ ] Live commerce rehearsal (Stripe test-mode buy → download → refund) — blocked on owner
      accounts/keys; see `docs/OWNER_LAUNCH_CHECKLIST.md`. Related:
      [[06 - Research#Unresolved questions]].
- [ ] Signed installer end-to-end — blocked on Azure/Apple signing secrets and `appId`
      authorisation. Related: [[01 - Requirements#^req-int-002|REQ-INT-002]].

## Backlog

- [ ] **Phase D** — Canvas viewer + revision diff (BUILD_BRIEF §5.2) and Compare rebuild
      (§5.5). Acceptance: viewer supports infinite canvas + zoom + smart-highlight by board
      ref; Compare uses the new viewer + a structured diff. Related: [[02 - Architecture]].
- [ ] **Phase E** — Desktop packaging polish (Windows + macOS). Partially implemented in
      `desktop/` + `.github/workflows/desktop.yml`.
- [ ] Wire the Obsidian knowledge base on a local machine: set
      `.claude/settings.local.json` → `additionalDirectories` to the real
      `<VAULT>/Projects/Estimation Tools` and copy these notes there (or open the repo folder
      as a vault). Related: [[07 - Session Log]].

## Completed and verified

> [!note]
> Items below the first entry are delivered on **PR #10** (`fable/paid-downloads`) and verified
> in that context; they are **not yet merged to `main`**. Three-type classification, merged
> Boards & Devices, and cross-referencing are already on `main`.

- [x] Three-type classification + merged Boards & Devices page. Verified: dialect/report tests.
- [x] Schematic↔schedule cross-referencing + assisted review. Verified: reconciliation tests.
- [x] Analysis-health model + export gating. Verified: `test-analysis-health.mjs` (11) +
      browser e2e (healthy vs failing project). Related: [[03 - Decisions#DEC-005 — Structural analysis honesty]].
- [x] Gemini-only runtime migration (Anthropic removed). Verified: `test-verify.mjs`,
      `test-extract-function.mjs`. Related: [[03 - Decisions#DEC-004 — Gemini as the sole runtime AI provider]].
- [x] Commerce endpoints (7) + `.env.example` (names only), ships disabled. Verified:
      `test-commerce.mjs` (30, mocked Stripe/R2/store/email).
- [x] Download gateway Worker. Verified: `test-download-gateway.mjs` (10, mint→verify loop).
- [x] `/download/` store, success, restore, legal pages. Verified: `test-store-static.mjs`
      (10) + `test-store-page.mjs` (4, Chromium).
- [x] Obsidian project knowledge system initialised. Verified: see [[07 - Session Log]].
