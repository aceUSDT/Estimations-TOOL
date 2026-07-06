# CLAUDE.md — Estimation 101 (Electrical Document Intelligence)

This file is loaded automatically at the start of every Claude Code session — it is the
behavioral contract for this repo. Keep it concise. The full spec lives in
`docs/BUILD_BRIEF.md`; read that before starting Workstream 0.

## What this is
An existing, **deployed** web app — "Estimation 101 — Electrical Document Intelligence"
(a Netlify SPA) — that reads UK electrical documents (LV schematics, distribution-board
schedules, specifications) and produces a **structured, verifiable device take-off per
board reference**, and secondarily a priced quote. It already works and has these tabs:
Projects, Documents, Viewer, Devices, Boards, Review, Compare.

**Do NOT rebuild from scratch. Fix and extend the existing app.** It must stay
redeployable to Netlify.

## Priority order (highest first)
1. **Recall / completeness FIRST.** The known top bug: the tool misses obvious data that
   is clearly present in the inputs — whole boards, whole circuit rows, sometimes whole
   documents. **Root cause (confirmed): `extractor-core.js` is a regex engine that fully
   parses only the BAM dialect and has no AI call and no schematic-topology extraction —
   so every other dialect and every schematic leaks data.** The fix is genuine AI
   extraction (a Claude call behind a serverless function) across all dialects + schematics,
   with the regex kept as a fast pre-pass/validator and `aggregateDevices` counting
   unchanged. Before feature work, build and run a **coverage report**
   (expected-vs-captured per board — a header saying "18 WAY" ⇒ expect 18 ways) across the
   `examples/` documents, show me the baseline, then close the gaps. A missing device is
   the worst failure this product can have.
2. **Accurate device take-off per board reference**, with the **input→output
   relationship** (which board feeds which, via which protective device and which cable)
   made explicit.
3. Pricing / quote output is **secondary** and must never reduce take-off accuracy.

## The five changes (all MODIFY existing pages — detail in docs/BUILD_BRIEF.md §5)
1. Classification → exactly three types: **Schematic / Distribution Board Schedule /
   Specification**.
2. Viewer → full engineering canvas (A0 + infinite canvas, thumbnails, 25–800% zoom,
   in-document search, multi-doc tabs, dark/light, print/download, smart-highlight by
   board reference) + revision-diff.
3. Documents → **drop-anywhere** capture, auto-scrape on ingest, an assisted
   manual-review step, and **schematic↔DB-schedule cross-referencing** that flags
   discrepancies for the user to resolve (never silently pick one).
4. Merge **Boards + Devices** → select a board reference, see that board's full device
   table; keep the "supplied from" supply hierarchy.
5. Rebuild **Compare** → simpler and stronger (reuse the new viewer + a structured diff).

## Non-negotiable rules
- **AI extracts, code computes.** The model only classifies, extracts, and structures
  documents. ALL counting, aggregation, diversity, and pricing are deterministic code —
  never the model.
- **IMPORTANT — API key handling.** NEVER hardcode the Claude API key or ship it in the
  browser bundle. It lives in a **server-side environment variable** (Netlify env var);
  every Claude API call goes through a **serverless function** the front-end calls. If
  the app currently calls the Anthropic API from client-side code, that is a live key
  leak — flag it and fix it first.
- **IMPORTANT — never commit secrets.** `.env` and `.env.*` must be gitignored. No keys,
  tokens, or passwords in any committed file (including this one).
- **Don't break the working app.** Commit the current app as a clean baseline before
  editing. **One workstream per git branch.** Verify against the real example documents
  after every change.
- **Over-capture beats omission.** When unsure whether something is a device/board,
  include it and flag it for the Review queue. Never silently drop uncertain rows.
- **Flag conflicts; never auto-resolve.** When two documents disagree, surface it for the
  user to decide. Never auto-merge boards.
- **Provenance + confidence** (source document, page, confidence score) on every
  extracted board and device.

## Workflow
1. **Explore first:** read the repo, README(s), `docs/BUILD_BRIEF.md`, the app source, and
   the example documents included as training/test data.
2. **Report back:** how the app is wired, whether the API key is exposed client-side, and
   which existing component each of the five changes touches.
3. **Plan and get approval** before any large or destructive edit.
4. **Implement in small, verifiable increments;** run the coverage report / test against
   real documents after each.
5. **Commit per workstream** with clear messages.

## Human approval required before
- Any large refactor or deletion of existing working code.
- Changing the extraction model or the deploy/build configuration.
- Any change that could alter device counts — show before/after against a fixture first.

## Where the detail lives
- `docs/BUILD_BRIEF.md` — full spec: current-state tab inventory, the domain knowledge pack
  (document taxonomy, the 7+ DB-schedule dialects, cable/device code legends), the canonical
  data model, and acceptance tests with real numbers.
- `examples/` — the test corpus (one fixture per dialect/class + the revision set). Its
  `README.md` maps every file to the acceptance test it supports. Run the coverage report
  against this folder. (Note: those PDFs are image-only re-renders — prefer original PDFs
  where available; add a real Specification and the cross-reference schedule as its README
  explains.)

## Commands
<!-- Maintainer: fill these in with the repo's real commands once known. -->
- Dev:    _e.g._ `npm run dev`
- Build:  _e.g._ `npm run build`
- Test:   _e.g._ `npm test`
- Deploy: _e.g._ `netlify deploy --prod`
