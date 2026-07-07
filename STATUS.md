# Estimation 101 — session status & handoff

_Last updated: 2026-07-07. Branch `claude/electrical-estimating-tool-h68ums`; PR #1 merged to `main`._

## Confirmed working right now

| Thing | State |
|---|---|
| **PR #1 merged** | ✅ Squash-merged to `main` (commit `be09a0e`); source branch deleted, then restarted from `main` for follow-up work. |
| **Workspace password rotated** | ✅ `index.html` `PASSWORD_HASH` = `0eebd979…f2f9d9` (old `48e484fe…` gone). Verified live on the deployed site. |
| **App deployed & auto-deploying** | ✅ Real URL is **`https://estimationtoolz.netlify.app`** (serves the merged commit — new hash confirmed live). ⚠️ The brief's `estimation101.netlify.app` is **stale / nonexistent**; a second site `estimationtools.netlify.app` is an **old build** (pre-merge hash, no function). |
| **Serverless extract function live** | ✅ `GET /.netlify/functions/extract` → `{"status":"ok","configured":true,"model":"claude-opus-4-8"}`. `ANTHROPIC_API_KEY` is set server-side; never in the repo/bundle. |
| **AI extraction actually running** | ❌ **BLOCKED — Anthropic account out of credits** (`400 "credit balance is too low"`). Function + key work; there are no funds to run inference. See NEEDS HUMAN ACTION. |
| **Regex-only recall (Workstream 0)** | ✅ Measured & committed. Board-ref detection, auto-OCR, reconciliation/coverage all shipped and tested. |

## Headline recall number (Part 3)

- **Regex-only, six §0.5 anchor docs:** **69 boards found but only 7 per-circuit way-slots captured.** Board *references* are now detected well; per-circuit *rows* are still almost entirely missed by OCR→regex on the image-only non-BAM dialects. DB-MECH 1/18, DB-AV 0/12 (both GT checks fail on regex-only).
- **AI-active:** _not obtained_ — blocked on account credits (above). The harness is built, verified against the live endpoint, and ready.
  - **Resume with:** add credits in the Anthropic Console, then
    `node tools/coverage/coverage-ai.mjs` (ground-truth set) or `… --all` (full corpus) → writes `reports/coverage-ai.{md,json}`.
  - Full detail: `reports/coverage-ai.md`. Regex-only baseline: `reports/coverage-baseline.md`; dialect proof: `reports/dialect-probe.md`.

## Five feature workstreams (docs/BUILD_BRIEF.md §5) — status

All work so far is **Workstream 0 (extraction completeness)**, which underpins the five but is separate from them.

| # | Workstream | Status |
|---|---|---|
| 5.1 | Three-type page classification (Schematic / DB Schedule / Specification) | **Not started.** Classifier still uses the long `PAGE_TYPES` list; board-ref detection was generalised (WS0.2) but the 3-type collapse + per-page override persistence is not done. |
| 5.2 | Revision compare + full canvas viewer (A0, zoom, thumbnails, search, dark/light) | **Not started.** Viewer still the original; no structured revision diff. |
| 5.3 | Drop-anywhere capture + auto-scrape + assisted review + schematic↔schedule cross-ref | **Foundations only.** Auto-OCR on ingest (WS0.1), reconciliation gaps → Review queue (WS0.3), and AI auto-scrape (WS0.4) are in. Full-page dropzone, side-by-side assisted review, and cross-referencing are **not** done. |
| 5.4 | Merge Boards + Devices into one page (per-board device table + roll-up) | **Not started** as a merged page. Board header capture (§4A.1) + grouped-summation foundations exist in the AI merge + `aggregateDevices`. |
| 5.5 | Rebuild Compare (simple, powerful, synced dual-pane) | **Not started.** |

## Workstream 0 (done, on `main`)

- **Coverage harness** (`tools/coverage/`): regex-only baseline + dialect probe + reconciliation + AI-active harness. Tests: `npm test` (board-refs, reconciliation, extract-function, dialect probe — all pass).
- **WS0.1** auto-OCR scanned pages on ingest. **WS0.2** generalised board-ref detection (DB-MECH, PB01, G1-GF-DB-LL, header refs, CU variants; 14→99 boards corpus-wide). **WS0.3** reconciliation pass + in-app coverage panel + Review-queue gap items. **WS0.4** serverless AI extraction (function + domain-pack prompt + client merge, regex-wins-on-filled-slots).

---

## NEEDS HUMAN ACTION

1. **Add Anthropic API credits** (Console → Plans & Billing) for the account whose key is set as `ANTHROPIC_API_KEY` on the **`estimationtoolz`** Netlify site. Until then AI extraction returns `400 credit balance too low` and Part 3's AI-active numbers can't be produced. After adding credits: `node tools/coverage/coverage-ai.mjs`.
2. **Fix the stale live-URL in docs.** `docs/BUILD_BRIEF.md` §8 says `estimation101.netlify.app`; the real deployment is **`estimationtoolz.netlify.app`**. Also `estimationtools.netlify.app` is a stale old-build site — decide whether to delete it to avoid confusion. (I did not change these — they're your infra decisions.)
3. **Confirm the key was rotated** (§8 of the brief): any Anthropic key that appeared in chat should be revoked in the Console and a fresh one set as the Netlify env var. I cannot see or verify the key (server-side only) — please confirm this was done.
4. **Set a spend limit** on the key: the extract function is publicly invocable (the workspace password is still client-side only), so anyone can trigger paid inference once credits exist. Moving the auth gate server-side is still open (flagged in the brief §8).
5. **Decommission the leftover PR-watch check-in:** a scheduled self-ping (`send_later`) for PR #1 may still be armed; PR #1 is merged so it's a no-op, but it can be cancelled. (Being handled in-session.)
