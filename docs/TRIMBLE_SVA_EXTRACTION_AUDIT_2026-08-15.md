# Trimble/SVA Extraction Audit - 15 August 2026

## Decision

The pre-fix result for the locally audited 55-page Trimble/SVA distribution-board schedule was not reliable enough for review, approval, reporting, or estimating. The document is readable. The failure was in the deterministic geometry and validation pipeline, not in the source PDF and not in the supplied training material. Customer identifiers are intentionally omitted from this repository copy.

This needs a dialect-level parser and validation repair, not another prompt-only adjustment.

## Scope and method

- Inspected all 57 PDF pages. Pages 2-56 are 55 distribution-board schedule pages; page 1 is a cover and page 57 is a contact sheet.
- Extracted the embedded words with their page coordinates and replayed the current `parseSpatialScheduleDocument` pipeline against all 55 schedule pages.
- Compared the replay with the supplied production screenshot. The replay reproduced the same core defects, including `No board reference`, `RCBO 160A`, and `RCD 3mA` on page 2.
- Traced the result through the current board-header, column-inference, row-binding, protection-classification, document-schema transfer, health, Viewer, and export code paths.
- Did not alter the project, approve rows, upload the customer PDF, or deploy code during this audit.

## Source ground truth

### Boards

| Board | Schedule pages | Stated ways | Board rating | Fault rating | Incomer | Active outgoing rows |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| Main switchboard | 2-5 | 24 | 400A | 50kA | 400A isolating switch | 17 |
| Downstream board A | 6-13 | 24 | 100A | 25kA | 160A isolating switch | 34 |
| Downstream board B | 14-20 | 24 | 100A | 25kA | 160A isolating switch | 33 |
| Downstream board C | 21-30 | 24 | 100A | 25kA | 160A isolating switch | 45 |
| Downstream board D | 31-43 | 28 | 100A | 25kA | 160A isolating switch | 59 |
| Downstream board E | 44-55 | 28 | 100A | 25kA | 160A isolating switch | 54 |
| Downstream board F | 56 | 8 | 160A | 25kA | 160A isolating switch | 4 |

Expected board count: **7**. Expected active outgoing protective-device rows: **246**.

### Protective devices

| Explicit source class | Quantity | Pole/phase evidence | Breaking capacity |
| --- | ---: | --- | --- |
| MCCB | 17 | 15 TP and 2 SP; descriptor states `3-4P` | 15 at 25kA; 2 at 18kA |
| MCB | 200 | 19 TP and 181 SP | 139 at 10kA; 61 at 15kA |
| RCBO | 29 | 29 SP; descriptor states `1P+N` | 29 at 10kA |

The source also contains 9 MCB rows with a separate `Generic RCD 30mA Instantaneous` earth-fault device. Those rows must remain explicit MCBs with separate RCD protection; they are not integral RCBOs. The 29 explicit RCBO rows carry Type A 30mA integral protection. No source row supports 3mA, 4mA, 10mA, 15mA, or 160mA RCD sensitivity.

## Reproduced current output

The current parser replay produced:

- 55 of 55 pages reported as matched.
- 0 resolved board pages and 0 unique boards.
- 160 result rows: 141 observed/countable rows plus 19 invented header-way placeholders.
- 141 of 246 active source rows captured, an undercount of **105 rows (42.7%)**.
- 141 of 141 captured rows classified as RCBO.
- 141 of 141 captured rows with no pole count.
- 141 of 141 captured rows with no board ownership.
- False RCD sensitivity distribution: 3mA x6, 4mA x15, 10mA x72, 15mA x34, 30mA x3, and 160mA x11.
- False breaking-capacity distribution: 1kA x138 and 70kA x3.
- The page-2 schema was promoted as the sole document schema and transferred to all 55 schedule pages.

The production screenshot's `141 counted devices`, `160 overall`, `No board reference`, `RCBO 160A`, and `RCD 3mA` therefore come directly from the current deterministic parser. They are not isolated display mistakes.

## Confirmed defects

### P0 - Board identity is not bound

The schedule's primary identity is `Board Data -> Id No.`. The header parser only accepts labels such as Board Reference, DB Reference, or Board Identity. It does not accept this dialect's `Id No.` inside the Board Data region. `Id No.` also appears in the outgoing and Connected To columns, so it cannot be solved with a global text regex; it must be bound by region and label/value geometry.

Effect: all 246 source rows lose board ownership, the seven boards collapse into one unnamed review bucket, guided review has no valid board order, and feeder relationships cannot be built.

### P0 - The three protection records are flattened together

Each outgoing circuit has three vertically stacked records under one grouped heading:

1. Overcurrent Protective Device + Rating (A)
2. Earth Fault Protective Device + Trip Rating (A)
3. Arc Flash Protective Device + Rating (A)

The current schema treats Earth Fault Protective Device as an `rcd_ma` column and does not model these as independent vertical subrecords. It then takes the first number found in the wrongly bounded cell. On page 2, `3-4P` becomes 3mA. On other pages, cable values, 10kA/15kA values, model values, or `x160` become RCD sensitivity.

Effect: explicit MCCBs and MCBs are upgraded to RCBO, breaking capacity is corrupted, and real 30mA evidence is mostly missed.

### P0 - Explicit device text loses precedence

The source states `Hager, h3+ MCCB` or `Hager, MCB`, but the inferred device-class column is missing from the transferred schema. Because the false RCD value is present, the fallback resolver creates RCBO from rating plus supposed RCD protection. The validator does not reject a result that contradicts explicit device text visible in the row.

Effect: all 141 captured rows become RCBO although the source contains 17 MCCBs, 200 MCBs, and 29 RCBOs.

### P0 - A bad schema is allowed to contaminate the whole document

Page 2 is accepted even though it has no board reference and reports `device_column_missing`. The latter is only a review warning. The document parser then transfers this schema to every later page and accepts it because the falsely inferred RCBO plus rating makes each captured row appear complete.

Effect: the fallback creates a self-confirming failure: wrong fields make rows look complete, and apparent completeness authorises the wrong schema on all 55 pages.

### P0 - Row and way anchors are incomplete

The source can repeat one way number for several phase circuits. When a page contains only repeated way numbers, the generic anchor scorer can prefer another repeated numeric column. It also materialises ways promised by the header on each page instead of reconciling them once per board across continuation pages.

Effect: 105 active rows are omitted; header values such as 160 can become a false way ceiling; and 19 unsupported placeholder rows appear on page 2.

### P1 - The data model cannot faithfully represent this schedule

One circuit can contain an overcurrent device, a separate earth-fault device, and an arc-flash protection record. The current row model has one `device` plus RCD/AFDD flags. That cannot distinguish an explicit RCBO from an MCB protected by a separate RCD, nor can it represent an independent earth-fault device as a procurement item.

Effect: even a visually improved extraction could still produce the wrong device take-off.

### P1 - Arc flash is at risk of being confused with AFDD

`Arc Flash Protective Device` is not the same field as arc-fault detection (AFDD). This source's arc-flash entries are `None / N/A`. The dialect needs a separate arc-flash field and must never map the heading to AFDD.

### P1 - Header and electrical metadata are dropped

The current header reader does not reliably bind Board Rating, Spare, Ze, the three phase-load totals, Device Type, or Device Rating from this label/value grid. It also cannot classify the 400A main board as a switchboard while classifying the 100A/160A boards as distribution boards without first recovering the identity and rating.

### P1 - Connected To is only partially recovered

`Connected To -> Id No. / Name` is not a first-class column definition. Page 2 happens to yield some DB references through a repeated-board-reference fallback, but load names on later boards do not. This loses circuit descriptions and prevents reliable source-to-downstream-board relationships.

### P1 - Viewer truth state is misleading

The Viewer only displays `Extraction incomplete` when a schedule page has zero rows. A page with wrong rows, no board, a missing device column, and contradictory class evidence can still display `Confirmed` and enable Approve. The global health model marks no-board schedule documents incomplete and blocks export, but it does not fail the analysis and it does not stop row approval.

### P2 - AI recovery is bypassed by false completeness

AI recovery is triggered for missing rows, unresolved protection fields, or a coverage gap. Here the bad schema produces a device and rating for each captured row, so the unresolved ratio looks good and AI recovery has little reason to intervene. More AI prompting cannot fix a deterministic pipeline that supplies the wrong cells and then declares them complete.

### P2 - Regression coverage lacks this exact layout contract

The repository has spatial, protection, health, Viewer, report, and real-document tests, but no permanent fixture currently enforces the Board Data/Id No layout, repeated-way pages, three stacked protection records, explicit MCCB precedence, separate RCD semantics, or page-to-page schema rejection shown here.

## Implementation plan and gates

### Step 0 - Freeze the failure as an acceptance fixture

- Create a sanitised geometry fixture from representative pages rather than committing the customer PDF.
- Cover page 2 MCCBs, a page with explicit RCBOs, a page with MCB plus separate Generic RCD, a repeated-way page, and the final 8-way board.
- Record the full-document acceptance manifest: 7 boards, 246 active rows, and the class/specification counts above.

Gate 0: every confirmed defect above has a failing automated assertion before production code changes.

### Step 1 - Add a real Trimble/SVA dialect detector and header binder

- Detect the layout from the co-occurrence and geometry of Distribution Board Schedule, Board Data, Id No., No. of Ways, Connected To, and the three protection headings.
- Bind header labels to values by bounded cells, not flattened text order.
- Distinguish Board Data Id No. from outgoing Id No. and Connected To Id No.
- Extract board identity, ways, spare percentage, board/fault ratings, Ze, phase loads, incomer class/rating, model, project metadata, and provenance.

Gate 1: all 55 schedule pages attach to exactly one of the 7 expected board references; zero active rows are boardless.

### Step 2 - Reconstruct way groups and vertical protection subrecords

- Recover horizontal rules and group each way/phase circuit across its wrapped text lines.
- Model Id No./Name, cable/cores/phase CSA/separate CPC, Connected To Id No./Name, overcurrent device/rating, earth-fault device/trip rating, and arc-flash device/rating as separate bounded cells.
- Support repeated way numbers with distinct L1/L2/L3 circuits and one merged L1,L2,L3 circuit.
- Reconcile stated ways once per board across all continuation pages; never fabricate per-page missing ways.

Gate 2: exactly 246 printed active row groups are recovered, with zero header/footer rows and zero invented active rows.

### Step 3 - Enforce electrical precedence and units

- Make explicit OPD class the highest-priority class evidence, followed by BS standard, then bounded row-level protection evidence.
- Parse `3-4P` only as pole evidence, `25kA`/`18kA`/`10kA`/`15kA` only as breaking capacity, and `0.03A` or `30mA` only as 30mA sensitivity in the correct earth-fault context.
- Preserve MCB plus separate Generic RCD as two related specifications; do not rewrite it as RCBO.
- Parse RCBO `1P+N`, Type A, 30mA, B curve, and 10kA from its own descriptor.
- Keep Arc Flash separate from AFDD.

Gate 3: source counts are exact: MCCB 17, MCB 200, RCBO 29, separate 30mA RCD 9; no sensitivity except 30mA; no breaking capacity except 10/15/18/25kA.

### Step 4 - Reconcile phase, poles, and board family

- Use bounded phase cells and explicit descriptor poles together.
- Preserve 212 SP and 34 TP outgoing rows; record 1P+N separately from TP/3-4P.
- Classify the 400A main LV switchboard as a switchboard and the six downstream boards as distribution boards using recovered identity plus rating.

Gate 4: all 246 rows have the expected phase/pole state and all 7 boards have the correct family basis.

### Step 5 - Make schema transfer fail closed

- Promote a page schema only when board identity, critical columns, row anchors, and class evidence are independently proven.
- Do not transfer a schema with `primary_board_not_resolved`, `device_column_missing`, unit conflicts, or explicit-class contradictions.
- Compare each target page's header fingerprint and column evidence before transfer; keep unresolved pages unresolved.

Gate 5: deliberately corrupted or shifted pages remain incomplete and never become false matched pages.

### Step 6 - Repair health, review, and export truthfulness

- Treat active schedule rows with no board as failed, not merely incomplete.
- Treat explicit source class versus extracted class contradiction as blocking.
- Treat invalid unit domains, missing critical columns, impossible sensitivity values, and suspicious document-wide single-class collapse as blocking.
- Show Extraction incomplete on affected pages and disable Approve, guided review, report readiness, and export until repaired.
- Keep every field linked to its exact source cell and display the extraction basis/conflict.

Gate 6: the current bad result cannot be approved, reported as Confirmed, or exported.

### Step 7 - Use AI as bounded recovery, not as the table parser

- Invoke AI only for unresolved cells after geometry binding, OCR alternatives, and deterministic validation.
- Supply cropped source regions plus the candidate cell schema and require field-level evidence.
- Reject AI output that contradicts explicit device text, geometry, units, or board ownership; unresolved is preferable to invented.
- Add scanned, rotated, low-resolution, and unseen-layout variants to the recovery tests.

Gate 7: AI improves recall on degraded pages without changing verified deterministic fields or producing unsupported values.

### Step 8 - Full regression and production release

- Run the complete repository suite, electrical Tier 1/coherence suites, the new full-document Trimble acceptance, Viewer/report workflows, performance budget, release-manifest signing, and desktop/mobile visual QA.
- Re-run Perryfields, BSE3D, and the existing dialect fixtures to prove no regression.
- Deploy to a Vercel preview first. Promote only after the acceptance manifest and source-window spot checks pass.
- Re-index the released commit in Graphify and log the source-code milestone in Supabase. Keep the customer PDF and extracted contents local.

Gate 8: production must show 7 boards and 246 active outgoing rows with exact device/protection counts and source provenance before this defect is considered fixed.

## Release acceptance checklist

- [x] 7 board identities, no synthetic unnamed board.
- [x] 246 active outgoing rows, no dropped or invented active rows.
- [x] 17 MCCB, 200 MCB, 29 RCBO.
- [x] 9 separate Generic RCD 30mA records retained as separate protection.
- [x] 212 SP and 34 TP rows.
- [x] Correct 10/15/18/25kA distribution.
- [x] Correct board ratings, fault ratings, ways, Ze, spare percentage, and incomers.
- [x] Connected To values retained as load or downstream-board references.
- [x] No Arc Flash/AFDD conflation.
- [x] Row-level output fields retain bounded source-cell provenance.
- [x] No approval or export when any blocking invariant fails.
- [x] Existing supported documents retain their accepted counts and behaviour.

## Implementation evidence

- `tools/coverage/fixtures/trimble-sva-synthetic.mjs` is a sanitised 55-page geometry fixture; it contains no customer PDF text or identifiers.
- `tools/coverage/test-trimble-sva-schedule.mjs` enforces the complete 7-board / 246-device manifest and a five-second deterministic parsing budget.
- `tools/coverage/verify-trimble-private.mjs` accepts a local, uncommitted page-coordinate export and verifies the same contract without uploading or storing the source document.
- The private replay passes in under one second on the release workstation. Its two authored phase/pole contradictions remain blocked for explicit user correction rather than being silently repaired.
- The full repository suite, electrical Tier 1/coherence suites, analysis budget, linked Viewer workflow, report workflow, release manifest, and desktop asset gates pass on analysis version 20.
