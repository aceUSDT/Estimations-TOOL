---
name: obsidian-project-manager
description: Use Obsidian as a structured, continuously-maintained project knowledge system. Invoke when planning substantial project work, researching the project, recording or retrieving requirements, documenting architecture, making or reviewing decisions, managing project tasks, investigating bugs, reconciling code against documentation, summarising completed work, or preserving knowledge for future Claude Code sessions. The project folder is at obsidian/Projects/Estimation Tools/ (in-repo) or <VAULT>/Projects/Estimation Tools on a local machine. Read .claude/rules/obsidian-markdown.md for note-writing conventions.
---

# Obsidian Project Manager

## Objective

Use Obsidian as a structured, reliable, continuously-maintained project knowledge system so
that future Claude Code sessions understand: what the project is, what has been implemented,
why important decisions were made, which constraints must be preserved, what remains
unfinished, what failures have occurred, what is uncertain, and where relevant implementation
lives. **The vault is a curated project intelligence layer, not a raw transcript archive.**

The canonical project folder (the "project folder" below):
`obsidian/Projects/Estimation Tools/` in this repo, or
`<VAULT>/Projects/Estimation Tools` when Claude Code runs on a machine with the real vault
(pointed to via `.claude/settings.local.json` → `permissions.additionalDirectories`).

Note conventions (wikilinks, properties, tasks, callouts): `.claude/rules/obsidian-markdown.md`.

## Operating modes

### Read mode — context needed, changes not necessarily required
1. Locate the project folder.
2. Read `00 - Project Hub.md`.
3. Search for task-relevant terms across the project folder.
4. Read the most relevant canonical notes.
5. Compare their claims against the current codebase.
6. Report contradictions or stale information **before** relying on it.

### Update mode — existing knowledge has materially changed
1. Identify the canonical note.
2. Read the complete relevant section before editing.
3. Make the smallest sufficient change.
4. Update the `updated` property when present.
5. Preserve useful historical rationale.
6. Add or repair links to related notes.
7. Check the update does not contradict another canonical note.

### Capture mode — genuinely new durable knowledge
Create a new note only when: no suitable canonical note exists; the information has ongoing
project value; the subject warrants an independently linkable concept; and the note would not
merely duplicate a session log.

### Reconciliation mode — notes and code disagree
1. Identify every material conflict.
2. Gather evidence from code, tests, configuration, requirements and decisions.
3. Determine which source is current and authoritative.
4. Do not silently choose when the answer remains uncertain.
5. Record unresolved conflicts as explicit questions (`> [!question]`) in the relevant note.
6. Update stale notes when evidence is sufficient.
7. Record material corrections in `07 - Session Log.md`.

## Initial project scan (before substantial work)

Inspect, in order, only what the task needs: `00 - Project Hub.md`, `01 - Requirements.md`,
`02 - Architecture.md`, `03 - Decisions.md`, `04 - Tasks.md`, `05 - Bugs.md`, relevant
research notes, notes linked from relevant sections, then the current code, tests and
configuration. Do not retrieve irrelevant notes simply because they exist.

## Project Hub responsibilities

`00 - Project Hub.md` gives a concise current orientation: purpose, current status, current
phase, primary objectives, principal constraints, key components, current blockers,
high-priority tasks, links to every canonical note, and recent material changes. It must not
become a complete project history.

## Requirements management

Important requirements preserve: identifier, description, rationale, priority, status,
acceptance criteria, affected systems, dependencies, related decisions, implementation
references, verification status. **Never mark a requirement complete without evidence its
acceptance criteria are satisfied.** Stable ids: `REQ-FUNC-001`, `REQ-SEC-001`, `REQ-PERF-001`.

## Decision management

Record decisions that materially affect architecture, product behaviour, security, data,
dependencies, public interfaces, development strategy, or future maintainability. Structure:

```markdown
### DEC-XXX — Decision title

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Superseded | Rejected
**Context:** Why a decision was needed.
**Decision:** What was selected.
**Rationale:** Why it was selected.
**Alternatives considered:** Other viable options.
**Consequences:** Positive and negative effects.
**Implementation references:** Relevant source files or modules.
**Related:** Wikilinks to requirements, architecture, bugs or other decisions.
```

Do not record ordinary low-level implementation details as architectural decisions.

## Bug management

For meaningful bugs preserve: identifier, observed behaviour, expected behaviour, reproduction
conditions, affected component, severity, status, root cause (when established), hypotheses
(when unconfirmed), implemented fix, verification performed, regression risk, source-file
references, related requirements and decisions. **Never present a hypothesis as a confirmed
root cause.** Stable ids: `BUG-001`.

## Task management

Maintain tasks as specific outcomes, not vague activities.

- Poor: `- [ ] Work on authentication`
- Better: `- [ ] Implement server-side session validation for protected API routes and verify unauthenticated requests return 401. Related: [[01 - Requirements#REQ-SEC-001]]`

When completing tasks: verify the intended outcome; run applicable tests/checks; record
unresolved limitations; mark complete only after verification; create follow-up tasks for
remaining work.

## Research management

Research notes distinguish: verified facts, source-derived information, inference,
assumptions, recommendations, and unresolved questions. Include sources/references where
available. Do not fabricate external research.

## Session completion protocol

At the end of substantial work, add a concise entry to `07 - Session Log.md`:

```markdown
## YYYY-MM-DD — Short task title

### Objective
One or two sentences describing the intended outcome.

### Completed
- Meaningful results only, with important source-file references.
- Tests or verification actually performed.

### Decisions
- Accepted decisions or `None`.

### Problems discovered
- New bugs, risks, inconsistencies or technical debt.

### Knowledge updated
- List the Obsidian notes changed.

### Outstanding work
- Specific next actions.
```

Do not store complete conversational transcripts.

## Quality gate (before declaring documentation complete)

- Does the Project Hub accurately describe the current project?
- Do requirements match current intended behaviour?
- Are accepted decisions reflected in the implementation?
- Are completed tasks genuinely verified?
- Are new bugs and risks recorded?
- Are assumptions clearly labelled?
- Are important notes linked, and were duplicates avoided?
- Were sensitive credentials excluded?
- Is the session log concise?
- Would a future Claude Code session understand what happened and what to do next?

Correct material failures before declaring the update complete.

## Environment notes

- **Obsidian CLI is not installed** on this cloud container, and no `obsidian` binary is on
  PATH. Notes are plain local Markdown, so all operations use ordinary file tools (Read,
  Glob, Grep, Edit, Write). The integration is fully usable without the CLI.
- If a future session runs where the official Obsidian CLI exists, prefer non-destructive
  commands (`obsidian version`, `obsidian vaults verbose`) to confirm the vault, and use the
  CLI where it is safer or more reliable. Never invent commands the installed version does
  not support.
- Never write secrets into the vault. Reference source-file paths instead of pasting large
  code. Do not modify `.obsidian/` unless the task is specifically about Obsidian config.
