# Diagnostics v2 and Layout Calibration Release

Date: 25 August 2026

## Purpose

This release makes extraction failures inspectable page by page and adds a
human-guided layout calibration path for documents whose table structure cannot
be recovered confidently. It does not turn uncertain output into accepted data.
Pages that cannot be reconciled remain blocked for review.

Customer source text, filenames, board references, extracted values and source
coordinates are excluded from exported diagnostic reports. Diagnostics contain
only aliases, counts, reason codes, strategy names and recovery guidance.

## Attached diagnostic audit

| Set | Observed failure | Root cause class | Recovery now reported |
| --- | --- | --- | --- |
| 2 | 21 schedule pages, four board headers, only one board with captured rows; 78 devices were not assigned to a board | Grid proof and board-row association failed | Per-page positional-word, table, vector-line, header, schema, output and assignment metrics; missing table roles and suggested calibration roles |
| 3 | 63 pages, no resolved boards and 257 unassigned devices; several pages had text but no usable way/rating/circuit schema | Header identity and positional schema failed, with unknown-page spillover | Header-candidate counts, readable-input verdict, page-type verdict, missing structural roles and board-reference calibration guidance |
| 4 | 20 schedule pages, no resolved boards and 74 unassigned devices | Board identity was not linked to extracted rows | Per-page board-resolution counts, unassigned-row reasons and board-reference/table calibration actions |
| 5 | 40 pages, 29 boards and 424 devices, but only 302 of 424 expected ways reconciled; six pages had unparsed text or missing device roles | Partial schema recovery, over-capacity and missing coverage | Page-level attempt history, missing column roles, expected-versus-captured outcomes and coverage reason codes |
| 6 | 51 pages, nine boards and 179 devices, with inflated expected ways and only 82 reconciled ways | Weak header interpretation, invalid electrical values and unproven grids | Header field evidence counts, invalid-domain counts, schema confidence, output rejection counts and ways-field calibration guidance |
| 7 | 93 pages, 67 of 70 boards and 742 devices; 21 pages remained unknown and isolated pages lacked way or circuit evidence | Sparse continuation and page-classification failures | Page-type evidence, continuation strategy attempts, missing way/circuit roles and targeted table/column calibration guidance |

## Diagnostic report contract

Every page now records:

- Input dimensions and counts for text lines, positioned words, table rows and
  vector lines.
- Text acquisition source, OCR quality, OCR recovery status and whether readable
  page input was available.
- Page classification, board candidates, resolved board headers and recognised
  header-field roles.
- Every extraction strategy attempted and whether it produced a usable schema.
- Grid confidence, inferred columns, missing required roles and structural
  rejection reasons.
- Rows seen, accepted, rejected, spare, blank, assigned and unassigned.
- Schematic component and feeder counts where applicable.
- Calibrations that applied, calibrations the parser consumed and calibrated
  semantic roles.
- A final page status, stable reason codes, plain-language diagnosis and ordered
  recovery actions.

The top-level summary aggregates pages by status, reason code, missing role and
extraction strategy. This makes repeated failures across a document visible
without exposing the document itself.

## Layout calibration workflow

1. Open the Audit workspace and select the source page.
2. Choose **Calibrate** or **Calibrate source** from an extraction gap.
3. Select the information role, such as outgoing table, board reference, ways,
   rating, phase, device type, RCD, AFDD, contactor, EPO or cable data.
4. Choose the scope: current page only, this and following pages, or all matching
   pages.
5. Drag over the source region. Regions are stored as page-relative coordinates,
   so the rule is reusable across differently sized pages with the same layout.
6. Review, relabel, remove or undo calibrations at any time.
7. Select **Apply & re-analyse**. The calibration is supplied to the parser as
   structural evidence, not drawn as a viewer-only annotation.

Column calibration uses the selected horizontal band across applicable pages.
Header-field calibration reads the exact selected region. An outgoing-table
calibration constrains the schedule data band. Existing automatic inference is
retained for fields the user did not calibrate.

## Correction and safety rules

- Calibration never auto-approves a row.
- Existing board and device correction editors remain available beside source
  evidence.
- Spare and blank ways remain explicit row outcomes and are not counted as
  protective devices.
- Incomplete board coverage, missing rows, invalid electrical values and
  unassigned devices remain blocking conditions.
- Calibration changes increment the project extraction revision. Results are
  marked stale until re-analysis completes.
- Removing or replacing a source document removes its document-specific
  calibrations.

## Acceptance evidence

- A synthetic unfamiliar layout is recovered using calibrated table and column
  roles, including board reference, RCD, AFDD, contactor, EPO and spare-way
  handling.
- Diagnostics v2 tests verify page-level detail and prove that raw text,
  filenames, board references, extracted values and coordinates do not leak.
- UI contract tests verify calibration controls, analysis revisioning and
  diagnostic export wiring.
- The complete repository test gate covers schedule parsing, Trimble layouts,
  OCR, schematics, reconciliation, reports, guided review, Vercel runtime and
  desktop assets.

## Operational boundary

No extractor can safely promise perfect autonomous interpretation of every
future electrical drawing. The commercial-grade behavior is to combine
deterministic extraction, electrical-domain validation, explicit uncertainty,
source-linked correction and reusable human calibration. Difficult pages fail
closed with precise evidence instead of silently entering the take-off.
