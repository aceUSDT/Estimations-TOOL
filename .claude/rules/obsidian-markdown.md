---
description: How to write valid, maintainable Obsidian notes (wikilinks, embeds, properties, tasks, callouts, headings). Applies to vault notes under obsidian/, not to ordinary project documentation.
globs: "obsidian/**/*.md"
alwaysApply: false
---

# Obsidian Markdown conventions

These rules apply to notes inside the Obsidian project folder
(`obsidian/Projects/Estimation Tools/` here, or `<VAULT>/Projects/Estimation Tools` on a
local machine). They do **not** govern ordinary repo docs such as `README.md`,
`docs/*.md`, or `FABLE_IMPLEMENTATION_REPORT.md` — leave those in their existing style.

## Internal links

Prefer Obsidian wikilinks between vault notes:

```markdown
[[Note Name]]
[[Folder/Note Name]]
[[Note Name#Heading]]
[[Note Name#^block-id]]
[[Note Name|Display Text]]
```

Before creating a link:

1. Search for an existing matching note.
2. Use the exact canonical note name when practical.
3. Avoid creating multiple notes for the same concept.

## Embeds

Use embeds only when source material should appear directly inside another note:

```markdown
![[Note Name]]
![[Note Name#Heading]]
![[image.png]]
![[document.pdf]]
```

Do not duplicate content when a link or embed is more appropriate.

## Properties (YAML frontmatter)

Use frontmatter when structured metadata improves retrieval, filtering or organisation.
Recommended properties:

```yaml
type:
project:
status:
created:
updated:
owner:
priority:
area:
related:
source:
tags:
```

- Use ISO dates: `YYYY-MM-DD`.
- Use consistent property names and controlled `status` values
  (e.g. `active`, `proposed`, `accepted`, `superseded`, `resolved`, `blocked`).
- Do not add frontmatter when it provides no useful organisational value.

## Tasks

Use standard Markdown tasks:

```markdown
- [ ] Outstanding task
- [x] Completed task
```

A meaningful task should normally identify: the intended outcome, the affected component,
relevant constraints, acceptance criteria (when needed), related requirements/decisions/bugs,
and verification requirements. Do not mark a task complete merely because code was written —
confirm the outcome and any acceptance criteria.

## Callouts

Use callouts where they improve clarity (sparingly):

```markdown
> [!note]
> Supporting information.

> [!important]
> Information that materially affects implementation.

> [!warning]
> A significant risk or dangerous operation.

> [!decision]
> An accepted project decision.

> [!question]
> An unresolved question requiring confirmation.
```

## Headings

- One H1 per note.
- H2/H3 for logical sections.
- Preserve stable heading names — other notes may link to them (`[[Note#Heading]]`).
- Do not casually rename headings that may be referenced. Keep headings clear and concise.

## Tags and links

Use **links** for relationships between identifiable concepts; use **tags** for broad
categories, workflow states and cross-cutting classifications.

```markdown
[[Architecture]]
#security
#decision
#blocked
```

Do not replace meaningful links with numerous overly-specific tags.

## Editing principles

- Preserve existing style when coherent; make focused changes.
- Retain important context and rationale; separate current truth from historical information.
- Label uncertainty explicitly; use exact dates for material decisions and status changes.
- Check whether related notes also require updating; avoid duplicate canonical sources.
