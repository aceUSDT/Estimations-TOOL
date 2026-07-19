---
type: bugs
project: Estimation Tools
status: active
created: 2026-07-19
updated: 2026-07-19
tags: [project/estimation-tools, bugs]
---

# 05 - Bugs

> [!note]
> Only confirmed bugs or clearly-labelled suspected issues are recorded. A hypothesis is never
> presented as a confirmed root cause.

## Critical

_None currently recorded._

## High

_None currently recorded._

## Medium

_None currently recorded._

## Low

_None currently recorded._

## Under investigation

> [!warning]
> **Not a product bug — environmental/tooling.** In the cloud container, the local branch
> `claude/electrical-estimating-tool-h68ums` is repeatedly recreated on container reset at
> GitHub's own PR #6 squash-merge commit `69d15e1` (committer `noreply@github.com`), which
> trips the `stop-hook-git-check` "Unverified committer" check. It is resolved each time by
> realigning the local branch to its real remote tip (`2448daf`, authored
> `noreply@anthropic.com`) — **never** by amending `69d15e1` (that is GitHub's merged commit,
> already on `main`). Root cause: environment recreates the default branch on reset; cannot be
> permanently fixed from inside a session. Tracked here so future sessions don't "fix" it wrongly.

## Resolved and verified

### BUG-001 — Zero-device analysis reported as "Analysed"

- **Observed behaviour:** A real project ("Hubert") showed **7 boards / 0 devices** yet was
  presented with a green "Analysed" status.
- **Expected behaviour:** An analysis that identifies boards but captures no devices must not
  present as success, and its exports must be blocked.
- **Affected component:** analysis pipeline (`extractor-core.js`, `index.html`).
- **Severity:** High (worst-case product failure: silently missing data).
- **Status:** Resolved on branch `fable/paid-downloads` (PR #10); pending merge to `main`.
- **Root cause (established):** completion was claim-based, not evidence-based — no invariant
  checked "boards found but zero devices captured".
- **Implemented fix:** `buildAnalysisHealth` returns `complete / incomplete / failed` with
  stable reason codes (`ZERO_DEVICES_WITH_BOARDS`, `BOARD_ROWS_MISSING`, `WAYS_UNACCOUNTED`,
  `SCHEDULE_PAGE_UNPARSED`, `OCR_PENDING`, `DOCUMENT_UNREADABLE`, …); boards-with-zero-devices
  ⇒ `failed`; a state-aware health banner shows reasons + recovery actions; CSV/XLSX exports
  are refused while health ≠ complete.
- **Verification performed:** `tools/coverage/test-analysis-health.mjs` (11 tests incl. the
  regression) + a Chromium end-to-end run (healthy demo shows no banner; a synthetic gap
  project reports `Analysis failed`, shows reasons, blocks CSV export, and produces a
  private-safe diagnostics export). *(Actually executed in the originating session.)*
- **Regression risk:** medium — schedule-candidacy scoring thresholds could over- or
  under-flag pages; covered by the health tests.
- **Source-file references:** `extractor-core.js` (`buildAnalysisHealth`,
  `scoreScheduleCandidate`), `index.html` (`renderHealthBanner`, `exportBlockedByHealth`).
- **Related:** [[03 - Decisions#DEC-005 — Structural analysis honesty]],
  [[01 - Requirements#^req-func-006|REQ-FUNC-006]].

> [!question]
> The original "Hubert" source documents were **not available** in this environment; the fix
> is proven against synthetic fixtures matching the reported failure shape. Confirming against
> the real documents remains an open verification item.
