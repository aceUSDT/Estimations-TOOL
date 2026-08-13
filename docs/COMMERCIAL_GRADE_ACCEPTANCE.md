# Commercial-grade acceptance ledger

This ledger is the release contract for the August 2026 completion pass. It
combines the supplied defect documents, annotated examples, electrical reading
pack, and the behaviours already present on `main`. A requirement is complete
only when the named automated evidence is green and the relevant browser or
deployment check has been performed.

## Extraction and document intelligence

| Gate | Required behaviour | Evidence |
|---|---|---|
| EX-01 | Bind ratings, standards, curves, RCD/AFDD indicators, descriptions, and cable fields by table geometry rather than text order. | `test-electrical-tier1.mjs`, `test-spatial-schedule.mjs` |
| EX-02 | A row-level RCD tick or sensitivity upgrades an MCB-class source row to RCBO; AFDD remains independent. | `test-electrical-tier1.mjs`, `test-protection-columns.mjs` |
| EX-03 | Interpret `L1-L3` as one three-phase device and three distinct phase rows as three single-pole devices unless merged evidence proves otherwise. | `test-spatial-schedule.mjs`, `test-commercial-extraction.mjs` |
| EX-04 | Preserve alphanumeric way identifiers such as `L7`, `L8`, `P1`, and `P2`; reconcile split header counts without colliding with phase labels. | `test-commercial-extraction.mjs` |
| EX-05 | Resolve note labels such as `(#5)` anywhere on a sheet and attach the governing note plus contactor, EPO, key-reset, time-control, or BMS equipment to every referenced circuit. | `test-commercial-extraction.mjs` |
| EX-06 | Keep a board's scope across continuation pages and never promote part numbers or outgoing circuit references to primary boards. | `test-spatial-schedule.mjs`, `test-boardrefs.mjs`, `test-reconciliation.mjs` |
| EX-07 | Use document section markers to include Circuit Charts and stop at Cable Schedules in long mixed documents while retaining schematics. | `test-commercial-extraction.mjs` |
| EX-08 | Classify 400 A and larger assemblies as panelboards under the project policy while retaining stated source evidence and review flags. | `test-spatial-schedule.mjs` |
| EX-09 | Record and exclude MSDB nodes and boards with four or more fuse/BS88 outgoings from take-off totals without deleting their evidence. | `test-commercial-extraction.mjs`, `test-reconciliation.mjs`, `test-report-core.mjs` |
| EX-10 | Refuse incoherent results, including boards with zero devices, fewer devices than in-scope boards, excess captured ways, missing protection fields, or missing feed evidence. | `test-analysis-health.mjs`, `test-electrical-coherence.mjs` |
| EX-11 | Read schematic board references, feed direction, source section, ratings, poles, protective devices, cable construction, meters, SPD, spares, and locations; use that evidence to fill only missing schedule fields with visible provenance. | `test-spatial-schedule.mjs`, `test-commercial-extraction.mjs` |
| EX-12 | Run bounded raster-OCR recovery only on affected pages, accept a retry only when its health score improves, and restore the original result otherwise. | `verify-auto-ocr.mjs`, `test-analysis-health.mjs` |
| EX-13 | Build a document-local layout catalogue so damaged or cropped pages can reuse a compatible schema learned from earlier or later pages, including scaled and mirrored layouts. | `test-spatial-schedule.mjs`, `test-ui-contract.mjs` |
| EX-14 | Reconcile authored source contradictions only when same-document geometry and electrical invariants corroborate the repair; retain printed evidence, cap confidence, and require review. Otherwise remain unresolved. | `test-spatial-schedule.mjs`, `test-extract-function.mjs`, `test-agent-team.mjs` |
| EX-15 | Interpret spare/space as bounded occupancy cells, never as words inside load descriptions; populated device evidence remains countable, partial protection evidence cannot bypass review, and any true occupancy conflict stays visible across Viewer, health, reports, and totals. | `test-commercial-extraction.mjs`, `test-report-core.mjs`, `verify-viewer-linked-review.mjs` |

## Review and correction workflow

| Gate | Required behaviour | Evidence |
|---|---|---|
| RV-01 | Viewer overlays and side-panel records are the same row objects and link in both directions. | `test-ui-contract.mjs`, `verify-viewer-linked-review.mjs` |
| RV-02 | Highlights fit one printed row, except a genuine merged three-phase circuit, and do not absorb section headings. | `test-spatial-schedule.mjs`, browser screenshots |
| RV-03 | Guided review starts at the first pending row on the first printed board, advances line by line, then moves to the next board. | `verify-viewer-linked-review.mjs` |
| RV-04 | The Go to Board selector always reflects the board represented by the current page or guided-review row. | `verify-viewer-linked-review.mjs` |
| RV-05 | Corrections are available in full-screen mode, remain resizable, update report data immediately, and create field-level audit entries. | `test-ui-contract.mjs`, `verify-viewer-linked-review.mjs` |
| RV-06 | Full-screen viewer, collapsible/resizable thumbnail and evidence panels, mobile layout, row counts, and specification colours remain usable without overlap. | `verify-viewer-linked-review.mjs`, desktop/mobile screenshots |
| RV-07 | The operator can approve all remaining rows on one board after confirmation; every row receives its own audit entry and remains individually undoable. | `verify-viewer-linked-review.mjs` |
| RV-08 | Pending, approved specifications, corrected rows, and rejected rows use stable, distinct colours without changing extraction identity or counts. | `verify-viewer-linked-review.mjs` |

## Reports

| Gate | Required behaviour | Evidence |
|---|---|---|
| RP-01 | Deliver exactly two worksheets: `Board Take-Off` and `Device Take-Off`. | `test-report-core.mjs` |
| RP-02 | Board Take-Off uses the requested specification-first column order and groups by board then device family. | `test-report-core.mjs` |
| RP-03 | Device Take-Off has boards down rows, one column per full distinct device specification, and reconciled quantities/totals. | `test-report-core.mjs` |
| RP-04 | Neither deliverable worksheet contains `Not specified`, `Unclear`, or unresolved prose embedded in a device name. | `test-report-core.mjs` |
| RP-05 | Every on-screen report line opens its contributing source records and can launch correction. | `test-ui-contract.mjs`, browser verification |
| RP-06 | Export remains blocked while analysis health or quantity reconciliation is incomplete. | `test-analysis-health.mjs`, `test-report-core.mjs` |

## Hosting, privacy, and release

| Gate | Required behaviour | Evidence |
|---|---|---|
| OP-01 | Original customer documents remain in local IndexedDB unless the operator explicitly enables online extraction; cloud extraction receives one page at a time and stores no source document. | `test-ocr-pipeline.mjs`, `test-ui-contract.mjs` |
| OP-02 | Vercel serves the static app and a same-origin Gemini-only extraction function with server-side credentials, bounded request handling, and no key in browser code. | `test-vercel-runtime.mjs`, production health probe |
| OP-03 | Full automated suite, focused electrical suites, browser workflow, and production smoke checks are green before source is merged and deployed. | release command log and Vercel deployment status |
| OP-04 | The final source commit is pushed, the production deployment is verified, and the local Graphify index is refreshed from that commit. | Git/Vercel/Graphify verification |
