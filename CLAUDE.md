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

---

# Obsidian Project Knowledge System

The connected Obsidian project folder is the persistent knowledge system for this project.
On this cloud container it is the in-repo stand-in vault at
`obsidian/Projects/Estimation Tools/`; on a local machine point
`.claude/settings.local.json` → `permissions.additionalDirectories` at the same project
folder inside your real Obsidian vault (`<VAULT>/Projects/Estimation Tools`). The detailed
operating procedure lives in the `obsidian-project-manager` skill
(`.claude/skills/obsidian-project-manager/SKILL.md`); note-writing conventions live in
`.claude/rules/obsidian-markdown.md`. This section is the always-loaded contract.

Use the project folder to preserve durable project knowledge across Claude Code sessions:
requirements, architectural understanding, important implementation decisions, unresolved
questions, research findings, bugs and root causes, tasks and progress, testing discoveries,
deployment information, meaningful user corrections, and concise session summaries. Record
useful project knowledge — **not** complete conversations or command-by-command transcripts.

## Source-of-truth hierarchy

When information conflicts, apply this priority (highest first):

1. The user's current explicit instruction.
2. The current project source code, tests and configuration.
3. Accepted decisions in `03 - Decisions.md`.
4. Current requirements in `01 - Requirements.md`.
5. Current architecture documentation (`02 - Architecture.md`).
6. Other Obsidian project notes.
7. Historical session logs (`07 - Session Log.md`).

An old session log must never override current code, requirements or an accepted decision.
When code and documentation conflict, investigate which represents intended current
behaviour; do not silently assume either is correct when evidence is insufficient.

## Behaviour before substantial work

Before starting substantial planning, implementation, debugging, refactoring, research or
architectural work:

1. Read `00 - Project Hub.md`.
2. Search the Obsidian project folder for task-relevant concepts.
3. Read the relevant requirements, architecture, decisions, tasks, bugs and research notes.
4. Inspect the relevant current source code, tests and configuration.
5. Compare stored knowledge with the codebase.
6. Identify stale, missing or contradictory information.
7. Build the work plan from validated information across both sources.

Retrieve by task relevance — do not read the entire vault indiscriminately.

## Behaviour during work

- Record only durable, useful knowledge; do not document every command or trivial edit.
- Update existing canonical notes rather than creating duplicates.
- Preserve user-authored content unless a change is necessary.
- Clearly distinguish facts, assumptions, proposals and accepted decisions.
- Link related notes; include source-file paths when documenting implementation.
- Keep requirements, architecture and decisions aligned with implementation.
- Never claim a test passed unless it was actually executed successfully.
- Record unresolved limitations honestly; do not convert speculation into project fact.

## Behaviour after substantial work

1. Update completed and outstanding tasks (`04 - Tasks.md`).
2. Record accepted architectural or product decisions (`03 - Decisions.md`).
3. Document newly discovered bugs, risks or technical debt (`05 - Bugs.md`).
4. Update affected requirements or architecture notes.
5. Add a concise entry to `07 - Session Log.md`.
6. Update `00 - Project Hub.md` when the current status materially changed.
7. Confirm the notes agree with the resulting codebase.
8. State which notes were changed.

## Obsidian safety rules

- Do not modify anything inside `.obsidian/` unless the task specifically concerns Obsidian
  configuration, plugins, themes or workspaces.
- Do not rename or move existing notes without considering inbound links and conventions.
- Do not delete a note simply because it appears outdated; mark superseded information
  explicitly or move it to `Archive/` when appropriate.
- Do not store passwords, API keys, access tokens, credentials or other secrets in the vault.
- Do not copy large source files into notes; summarise responsibilities and reference
  source-file paths instead.
- Do not create duplicate notes for concepts that already have a canonical note, and do not
  rewrite an entire note when a focused edit is sufficient.
- Preserve valuable historical rationale while making current truth clear.
