# Estimation Tools engineering contract

This file is read by Claude Code. The same rules apply to every contributor working on
this repository.

## Product

Estimation Tools is a local-first desktop and browser application for UK electrical
documents. It reads schematics, distribution-board schedules, specifications, images, and
spreadsheets, then produces a structured and verifiable device take-off per board.

Do not rebuild the application from scratch. Extend the existing views, extraction core,
report core, fixture suite, and Electron package.

## Priorities

1. Completeness: missing a board, circuit, cable, protective device, or control item is the
   most serious failure.
2. Accuracy: every normalised value must retain its document, page, source text, confidence,
   and review state.
3. Clarity: a new user should be able to upload, follow processing, review, and export
   without specialist knowledge of the implementation.
4. Pricing is secondary and must never weaken the take-off or reconciliation checks.

## Product invariants

- Code computes. Counting, grouping, reconciliation, diversity, and pricing are always
  deterministic.
- Extract conservatively. Uncertain data belongs in Review, not in a silent omission.
- Flag conflicts. Never choose between disagreeing source documents without user review.
- Keep control equipment distinct from protective-device totals while preserving it in the
  same project and workbook.
- Store projects and originals locally by default. The desktop app must work from packaged
  assets and must not depend on a hosted site or CDN.
- Online extraction is explicit opt-in in hosted browser builds and disabled in desktop.
- Never ship API keys, passwords, tokens, private source documents, or corpus files.
- The local PIN is a UI lock, not encryption. Do not describe it as encrypted storage.
- Preserve backward-compatible IndexedDB migrations and test backup/restore when storage
  structures change.

## Main components

- `index.html`: application UI, viewer, ingestion, OCR orchestration, and local persistence.
- `extractor-core.js`: deterministic page assessment and electrical extraction helpers.
- `report-core.js`: canonical grouping, reconciliation, CSV, and Excel workbook generation.
- `vendor/`: pinned local browser runtimes required for offline PDF and OCR handling.
- `desktop/`: secure Electron protocol, local asset packaging, and installer configuration.
- `netlify/functions/`: optional hosted extraction; secrets remain server-side.
- `tools/coverage/`: deterministic tests and document fixtures.

## Workflow

Read the relevant code and fixture before editing. Keep changes scoped, run the nearest
tests, and validate count-changing work against a real reference document. Use short-lived
branches only; merge accepted work into `main` and remove stale integration branches.

## Commands

- Browser: `npm run dev`
- Tests: `npm test`
- Desktop verify: `cd desktop && npm ci && npm run verify`
- Windows package: `cd desktop && npm run dist:win`
- macOS package: `cd desktop && npm run dist:mac`

The full original requirements and domain model remain in `docs/BUILD_BRIEF.md`.
