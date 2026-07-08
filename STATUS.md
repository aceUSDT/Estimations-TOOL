# Estimation 101 — session status & handoff

_Last updated: 2026-07-08. Branch `claude/electrical-estimating-tool-h68ums`; PRs #1–#5 merged to `main`._

## Confirmed working right now

| Thing | State |
|---|---|
| **PRs #1–#5 merged** | ✅ Squash-merged to `main` (#1 `be09a0e` harness/recall; #2 schema-fix + AI harness; #3 Sonnet-5 fit + desktop shell + §5.1 mapping; #4 disable thinking; #5 `0301163` background function + polling). Branch restarted from `main` for follow-up work. |
| **Workspace password rotated** | ✅ `index.html` `PASSWORD_HASH` = `0eebd979…f2f9d9` (old `48e484fe…` gone). Verified live on the deployed site. |
| **App deployed & auto-deploying** | ✅ Real URL is **`https://estimationtoolz.netlify.app`** (serves the merged commit — new hash confirmed live). ⚠️ The brief's `estimation101.netlify.app` is **stale / nonexistent**; a second site `estimationtools.netlify.app` is an **old build** (pre-merge hash, no function). |
| **Serverless extract function live** | ✅ `GET /.netlify/functions/extract` → `{"status":"ok","configured":true,"model":"claude-sonnet-5"}`. `ANTHROPIC_API_KEY` is set server-side; never in the repo/bundle. |
| **AI extraction actually running** | ✅ **Working end-to-end** via the **background function + Netlify Blobs + client polling** path (`extract-background` → `extract-status`), model `claude-sonnet-5`, thinking disabled. Sync `extract` still exists for fast pages; dense A0/large-grid pages route through the background path (no 30 s ceiling). Credits are live. |
| **Regex-only recall (Workstream 0)** | ✅ Measured & committed. Board-ref detection, auto-OCR, reconciliation/coverage all shipped and tested. |

## Headline recall number (Part 3) — AI-active obtained ✅

- **Regex-only, §0.5 anchor docs:** board *references* detected well but per-circuit *rows* almost entirely missed by OCR→regex on the image-only non-BAM dialects. DB-MECH 1/18, DB-AV 0/12 (both GT checks fail on regex-only).
- **AI-active (3 anchor docs, background function, model `claude-sonnet-5`):**
  - **Way-slots captured: 1 → 75 (≈75× more circuits captured).** This is the core recall lift the product needed.
  - **Boards found: 5 → 8.**
  - **DB-MECH 18-way stitch (marquee §0.5 check): 1/18 → 18/18 ✅** — the AI path reads the Syntegral 3-phase `n/Lx` grid the regex parser can't.
  - **GT pass counter reads 0/3 but *undersells* the result** (see `reports/coverage-ai.md` → Interpretation): Dundee's 3 CUs ARE captured (min_boards ≥ 3 ✅) but named by printed identity, not the exact GT strings; Syntegral `min_boards ≥ 10` was a bad guess (5 real boards, all found); SRP1053's failure was a *transient* cold-container enqueue 500 — on retry it yields **9 boards + 8 feed edges** (full input→output backbone), correctly classified `schematic`.
- **Reproduce with:** `node tools/coverage/coverage-ai.mjs` (ground-truth set) or `… --all` (full corpus) → writes `reports/coverage-ai.{md,json}`.
  - Full detail: `reports/coverage-ai.md`. Regex-only baseline: `reports/coverage-baseline.md`; dialect proof: `reports/dialect-probe.md`.
- **Two tractable follow-ups (not extractor failures):** (a) recalibrate the ground-truth strings (Dundee CU names, Syntegral min_boards); (b) send schematics at full resolution / tiled + pass OCR text so the tiny A0 DB labels (DB-00-08…) resolve to specific refs instead of descriptive names. Background functions have no latency ceiling, so full-res is now viable.

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

_Resolved by the user (confirmed 2026-07-08): Anthropic credits added ✅, API key rotated ✅, spend limit set ✅, workspace-password hash supplied & rotated ✅._

1. **Fix the stale live-URL in docs.** `docs/BUILD_BRIEF.md` §8 says `estimation101.netlify.app`; the real deployment is **`estimationtoolz.netlify.app`**. Also `estimationtools.netlify.app` is a stale old-build site — decide whether to delete it to avoid confusion. (Infra decision — not changed here.)
2. **Move the auth gate server-side.** The extract/extract-background functions are publicly invocable; the workspace password is still a client-side hash check only, so anyone who finds the function URL can trigger paid inference. The spend limit caps the blast radius, but the real fix is gating the functions behind a server-side check. (Brief §8.)
3. **Desktop app (Electron) — signing identities needed.** Windows/macOS installers are scaffolded (`desktop/`) but code-signing + notarisation + store submission need your Apple Developer ID / Windows cert. See `desktop/README.md` → NEEDS HUMAN ACTION.
