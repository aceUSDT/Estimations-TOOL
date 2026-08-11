# Electrical Document Reading — Engineering Reference

Reference material for the extraction engine of the electrical estimating tool.
Written to be read by a coding agent (Codex / Claude Code) before and during
implementation work on document ingestion, parsing, and take-off.

Derived from a 149-file / 3,308-page corpus of real UK electrical design
documents (see `corpus-inventory.csv`), an annotated LV schematic (Perryfields
Academy, Wintech SRP1295), and two rounds of defect review against the deployed
tool — the second of which also covers the review workflow and reports, in
`10-review-and-reports.md`.

---

## How to use this

Read in order on first contact. After that, treat `00` and `05` as the
non-negotiable spine and the rest as lookup.

| File | What it is | When to read |
|---|---|---|
| `00-core-reading-model.md` | The geometry-first parsing algorithm | Before writing any parser code |
| `01-field-lexicon.md` | Header synonym → canonical field mapping | When mapping columns |
| `02-device-rules.md` | Device classification and device-string grammars | When building the device model |
| `03-dialect-profiles.md` | The 9 dialect families observed, with detection signatures | When adding a new document family |
| `04-schematics.md` | Schematic (single-line diagram) reading rules | When working on schematic ingest |
| `05-trap-catalogue.md` | 35 concrete failure modes with corpus evidence | Before every parser change; use as a review checklist |
| `06-output-contract.md` | Normalised JSON schema, confidence, flagging | When designing or changing the data model |
| `07-quote-rules.md` | Take-off → priced quote rules | When building aggregation and pricing |
| `08-acceptance-tests.md` | Test fixtures and pass criteria drawn from the corpus | When writing tests |
| `09-visual-examples.md` | Nine annotated figures with walkthroughs | Alongside `00` and `05`; when onboarding anyone new to the documents |
| `10-review-and-reports.md` | Review workflow, viewer, and report layout | Separate workstream — read before touching the review page or the deliverable |
| `CODEX_PROMPT.md` | Kickoff prompt for the implementation agent | Paste at the start of a build session |

Figures live in `diagrams/`. Six are real corpus pages with the geometry drawn on
top; three are derived diagrams built from measurements taken out of the corpus
and the issued quote. Traps in `05` that have a figure link to it directly.

---

## The one-paragraph summary

Electrical schedules and schematics encode meaning in **geometry**, not in text
order. A distribution board schedule is a grid where a cell's meaning is
determined by which column band it falls in; a schematic is a graph where the
feed relationship is a drawn line, not proximity. Every serious extraction
failure observed so far comes from reading these documents as flattened text and
recovering fields by pattern-matching. The engine must recover the geometry
first, bind every value to a column or a node, and only then apply domain rules.
Where geometry is genuinely ambiguous, the correct output is a flag, never a
guess.

---

## Non-negotiables

1. **Never derive a field from a regex over a flattened row.** Bind by position.
2. **Never default a device class.** Derive it, or flag it.
3. **Never resolve a legend code from a global table.** Legends are per-document.
4. **Never silently price a placeholder.** `TBC`, `??`, `GUESS`, `-`, blank →
   flag for review.
5. **Never treat a merged/spanned cell as absent data.** Inherit it.
6. **Every extracted value carries provenance** — file, page, bounding box — so
   the operator can check it side by side against the source.
7. **Handle page rotation before banding.** A rotated page returns coordinates in
   an unrotated frame and silently destroys the grid.
8. **Never default a document type.** An unclassified document is `unknown` and
   excluded, not assumed to be a schedule.
9. **Never emit `Unclear` or `Not specified` into a report.** Unresolved is a
   flagged line with a source crop, never a word in a description field.
10. **Coherence gates run before anything is shown.** 29 boards with 18 devices
    is provably wrong without knowing the right answer — it must fail, not ship.

---

## Corpus composition

| Document class | Files | Notes |
|---|---:|---|
| DB schedules | 75 | 30 distinct header fingerprints |
| Schematics (LV / distribution) | 21 | A0/A1 sheets, mostly vector |
| Quotes (output examples) | 19 | Target output format |
| Consumer unit circuit charts | 7 | Domestic/apartment variant |
| Specifications | 4 | Prose clauses, device requirements |
| MCCB / switchboard schedules | 2 | Rotated headers |
| Protective device settings | 1 | Discrimination study |
| Scanned (no text layer) | 10 | OCR required |
| Other / non-PDF | 10 | Includes RFQ spreadsheet, Goal brief |

10 of 146 PDFs (~7%) have no text layer at all and require OCR before anything
else in this document set applies.

---

## Figures

| Figure | Teaches | Guards |
|---|---|---|
| [V-01](diagrams/v01-column-binding.png) | A cell's meaning comes from its column, not its content | T-01 |
| [V-02](diagrams/v02-row-grouping.png) | Identical geometry, opposite meaning | T-04, T-05, T-06 |
| [V-03](diagrams/v03-stacked-header-rows.png) | When the header stacks vertically, so does the row | T-07, T-15, T-16 |
| [V-04](diagrams/v04-checkbox-form.png) | The selection is a shaded box, and it isn't in the text layer | T-10 |
| [V-05](diagrams/v05-legend-collision.png) | The same letter, two different cables | T-09 |
| [V-06](diagrams/v06-schematic-junctions.png) | A crossing is not a connection | T-21, T-22, T-23 |
| [V-07](diagrams/v07-pipeline.svg) | The five-phase pipeline, worked on one row | — |
| [V-08](diagrams/v08-device-class-decision.svg) | Deriving device class | T-02, T-03 |
| [V-09](diagrams/v09-module-blank-arithmetic.svg) | Blanks are computed, never read | T-20 |
