# Estimation Tools commercial re-architecture blueprint

**Status:** proposed engineering contract
**Prepared:** 25 August 2026
**Purpose:** define a measurable route from the current product to a dependable, commercial UK electrical-document take-off platform.

## 1. Product outcome

The product must turn mixed electrical project documents into a complete, traceable and reviewable model of:

- documents and pages;
- boards, switchboards, panelboards and consumer units;
- incomers, isolators, protective devices and control devices;
- outgoing ways, circuits, phases, loads and cables;
- schematic feed relationships;
- conflicts, omissions and unresolved evidence;
- deterministic board and device take-offs.

The product is successful only when an estimator can answer four questions quickly:

1. What equipment is present?
2. Where did every value come from?
3. What is uncertain, contradictory or missing?
4. Do the final quantities reconcile with the source documents?

No model response, confidence badge or attractive interface may substitute for those answers.

## 2. Fundamental decisions

### 2.1 Preserve the product; replace internals behind contracts

A literal rewrite would repeat old mistakes, invalidate existing projects and remove known-good extraction rules. Use a strangler migration:

- freeze a versioned canonical project schema;
- preserve local-first storage, review history and exports;
- put new ingestion and extraction stages behind typed interfaces;
- run old and new extraction in shadow mode on the fixture corpus;
- migrate one document dialect at a time only when the new path wins its release gate;
- retain rollback to the last certified engine version.

### 2.2 AI extracts and proposes; deterministic code computes and decides state

AI may:

- classify pages and regions;
- transcribe text;
- identify visual table structure;
- propose column semantics and row groupings;
- propose electrical entities and relationships;
- explain anomalies and request targeted reprocessing.

AI must not:

- aggregate procurement quantities;
- silently choose between conflicting evidence;
- turn an inferred value into a printed fact;
- delete low-confidence rows;
- merge devices with different known attributes;
- mark a project complete;
- authorize an export.

Those operations belong to versioned deterministic code.

### 2.3 Evidence is the primary data product

Every field must carry provenance, not merely every device. A value such as `400 A` must retain:

- source document and page;
- source region and polygon;
- original image/text tokens;
- OCR engine and model version;
- extraction method;
- printed, inferred, corrected or calculated status;
- confidence components;
- rule/model explanations;
- correction history and reviewer identity.

## 3. Target system architecture

Build seven bounded subsystems. They communicate through versioned JSON schemas and append-only events.

### 3.1 Project and document service

Responsibilities:

- local project ownership and encrypted-at-rest desktop storage;
- explicit cloud opt-in;
- document hashing, deduplication and versioning;
- resumable analysis jobs;
- immutable originals;
- backup/restore and schema migration.

Original customer documents remain local by default. Hosted processing uploads only explicitly selected, encrypted, short-lived page assets. Retention is visible and configurable.

### 3.2 Rendering and normalization service

Every page receives a stable coordinate space independent of screen zoom.

Pipeline:

1. Validate file type and size.
2. Extract native PDF text, glyph positions, vector lines and images.
3. Render a canonical page image at controlled resolution.
4. Detect orientation, skew, perspective distortion, crop and page damage.
5. Generate normalized variants only when quality evidence requires them.
6. Store transforms so every derived coordinate maps back to the original page.

Never use viewer DOM coordinates as extraction coordinates.

### 3.3 Document perception service

Use a routed ensemble rather than one universal OCR call:

- native PDF parser for born-digital text and vector lines;
- page-element detector for table/title/drawing regions;
- table-structure detector for cells, rows, columns and merged cells;
- OCR recognizer returning tokens, polygons, confidence and reading-order links;
- handwriting or low-quality specialist only for regions that need it;
- vision-language parser for semantic labels and difficult local regions.

Recommended NVIDIA evaluation candidates:

- `nemotron-ocr-v2` for coordinate-aware OCR on complex images;
- `nemotron-table-structure-v1` for explicit cell, row and column geometry;
- `nemotron-page-elements-v3` or the current supported page-element successor for region detection;
- `nemotron-parse` for text, semantic class and bounding-box proposals;
- PaddleOCR as an independent benchmark/fallback, not an automatic truth source.

Model selection is provisional until measured on the private fixture corpus. API popularity is not an acceptance criterion. Check commercial terms, data retention, region, throughput and deprecation before adoption.

### 3.4 Layout graph service

Do not flatten a page into lines before understanding its geometry. Build a page graph with nodes for:

- tokens and text blocks;
- vector lines;
- tables, rows, columns, cells and merged cells;
- headers, footers, legends, notes and continuation markers;
- diagram symbols, connectors, buses and arrows;
- page and region anchors.

Edges represent:

- contains;
- left-of/right-of/above/below;
- same-row/same-column;
- spans-row/spans-column;
- header-for;
- continuation-of;
- connected-to;
- visually-overlaps;
- reading-order-before.

Multiple competing table hypotheses are allowed. Deterministic scoring selects a hypothesis only when structural constraints are met; otherwise the page enters layout review.

### 3.5 Electrical interpretation service

Convert the layout graph into an electrical evidence graph. This is where domain logic lives.

Canonical entities:

- project, document, page and region;
- board, section, busbar and way;
- incomer and isolator;
- protective device: MCB, MCCB, ACB, RCBO, RCCB/RCD, AFDD and fuse;
- control/switching device: contactor, relay, timer, SPD and meter;
- circuit, load, cable and CPC;
- schematic node, feeder and downstream relationship;
- evidence assertion, conflict and review decision.

Every assertion has `subject`, `attribute`, `value`, `unit`, `evidence`, `status` and `confidence_breakdown`.

#### Board logic

Board recognition must combine, without conflating:

- explicit labels such as board reference, DB ref, designation, ID number or panel name;
- title/header proximity;
- repeated page headers and continuation text;
- schedule row references;
- schematic feeder destinations;
- rating and phase evidence;
- known aliases normalized to a canonical reference.

A board reference is never accepted solely because a plausible `DB-*` token appears somewhere on a page.

#### Rating and board-type logic

Store printed rating and classified equipment family separately. For example, a 400 A rating is strong evidence for a panelboard/switchboard rather than a final distribution board, but classification remains an inference with an explanation unless the document states the type.

#### Phase and pole logic

Phase interpretation uses the entire way group, not one row token:

- `L1-L3`, `L1,L2,L3`, three phase slots, a merged three-row way or a three/four-pole device are TPN/TP evidence;
- one populated line plus two blank continuation phase lines may still describe one TP device;
- repeated printed device details on L1/L2/L3 may be either three SP devices or one shared TP device; decide from way boundaries, merged cells, pole notation and row geometry;
- a spare spanning three phase rows is one spare way, not three devices;
- a malformed repeated `L1` sequence is flagged and may be normalized to L1/L2/L3 only as an explicit inference.

#### Protection logic

Device class is derived from independent fields:

- printed type;
- standard/product family;
- RCD present/absent marker;
- RCD sensitivity;
- AFDD marker;
- pole count;
- trip/rating/curve/breaking capacity.

An MCB does not become an RCBO merely because an OCR token from an adjacent RCD column is nearby. The RCD marker must be assigned through the selected cell/column relationship and row span. Keep `device_class` and `rcd_protection` separate so contradictions can be reviewed.

#### Column semantic logic

Column roles are inferred from multi-level headers, units, repeated value patterns and electrical constraints. Examples:

- `In (A)` contains plausible current values;
- earth-fault/RCD columns use mA and tick/yes/no markers;
- breaking capacity uses kA;
- phase contains L1/L2/L3 or grouped variants;
- device type contains MCB/MCCB/RCBO/etc.;
- load description contains free text;
- cable columns contain size, cores, conductor count, type and CPC.

Header meaning propagates down only within its detected table and column span. It must stop at section changes, repeated headers or geometry breaks.

### 3.6 Deterministic reconciliation engine

This engine is the commercial safety boundary.

It must compute:

- expected versus captured pages;
- board references found by each source;
- stated ways versus reconstructed ways;
- phase slots expected versus represented;
- countable, control, spare, space and unresolved rows;
- board totals versus report totals;
- schematic feeders versus schedule boards;
- duplicate and orphan evidence;
- corrections not yet reflected in reports;
- export readiness.

Exports are blocked when:

- a schedule board has zero captured rows without an approved reason;
- expected ways are materially unreconciled;
- a board identity conflict is unresolved;
- a count-changing correction is pending;
- analysis ended early, timed out or skipped pages;
- a model response failed schema/evidence validation.

### 3.7 Review and reporting application

The UI should follow an estimator's task sequence, not the implementation sequence.

Primary workflow:

1. Upload and classify.
2. See analysis health and coverage.
3. Review boards in source order.
4. Review unresolved rows within each board.
5. Resolve schematic/schedule conflicts.
6. Reconcile totals.
7. Export and archive the audit record.

Viewer requirements:

- one selected evidence item at a time;
- exact polygon/row highlight that never spans an unrelated row;
- synchronized board selector, page, review card and report item;
- approval advances only after the decision is durably saved;
- auto-advance follows document, board, way and phase order;
- stale asynchronous renders cannot replace the current selection;
- keyboard and screen-reader operation;
- editable values in a stable side panel with an always reachable Save command;
- before/after correction and original evidence visible together.

Reports:

- one column/group per unique canonical device specification;
- deterministic color by device family, consistent across Review and Reports;
- board drill-down and source-evidence window for every quantity;
- no duplicate columns caused by casing, punctuation or missing-value presentation;
- distinct known attributes always remain separate;
- CSV/XLSX export exactly matches the on-screen reconciled model.

## 4. AI team and orchestration

Use roles, not a free-form group chat between models.

### 4.1 Perception workers

- **Page router:** chooses native extraction, OCR variants and specialist regions.
- **Layout worker:** proposes tables, cells, row spans and reading order.
- **Schematic worker:** proposes symbols, buses, feeders and labels.
- **Semantic worker:** maps evidence to the canonical electrical schema.

Workers cannot see or modify totals. Their outputs must validate against strict schemas and include source coordinates.

### 4.2 Gemini auditor

Gemini receives the page image plus structured evidence, competing hypotheses and deterministic warnings. It may:

- identify likely missed regions;
- rank competing layout interpretations;
- explain contradictions;
- request a targeted crop/re-render/re-OCR;
- propose an inference with cited evidence.

It may not approve itself. Its proposal returns to deterministic validation and, where required, human review.

### 4.3 Deterministic supervisor

The supervisor is code, not an LLM. It owns:

- state transitions;
- retries and time budgets;
- model routing;
- schema validation;
- evidence completeness;
- reconciliation;
- audit events;
- circuit breakers and fallback behavior.

### 4.4 Confidence

Do not use one opaque confidence score. Store components:

- OCR transcription confidence;
- geometry/table confidence;
- header/column assignment confidence;
- electrical semantic confidence;
- cross-document agreement;
- deterministic constraint score;
- inference penalty;
- correction status.

The UI maps these components to `confirmed`, `review required`, `conflict`, `incomplete` or `failed` states.

## 5. Schematics

Schematics require a separate spatial graph pipeline. Reading text lines is insufficient.

### 5.1 Extraction

- tile very large drawings with overlap while preserving global coordinates;
- detect title block, legends, buses, symbols, lines, arrows and connection dots;
- OCR labels near symbols and along rotated feeders;
- join line segments across tiles;
- distinguish crossing lines from connected junctions;
- build candidate source -> device -> cable -> destination paths;
- retain every node and edge's visual evidence.

### 5.2 Cross-reference

Normalize board aliases, then compare:

- schematic destination versus schedule board reference;
- protective-device class/rating/poles;
- cable size/type/cores;
- source board and way;
- phase configuration;
- downstream existence and reciprocal supply information.

The schedule is usually richer, but it is not automatically correct. Show agreement, schedule-only, schematic-only and conflict states. Never silently overwrite one source with the other.

## 6. Data and platform

### 6.1 Canonical schema

Use a versioned TypeScript/JSON Schema package shared by browser, Electron, functions, tests and exports. IDs are stable UUIDs; derived records include engine/model versions.

Key tables/collections:

- projects, documents, document_versions and pages;
- regions, tokens, layout_nodes and layout_edges;
- boards, ways, devices, circuits, cables and feeds;
- assertions and evidence_links;
- conflicts, review_items, corrections and decisions;
- analysis_runs, stage_runs and model_calls;
- coverage_snapshots, report_snapshots and exports.

### 6.2 Local versus cloud

- IndexedDB/Electron database owns customer project data by default.
- Supabase owns accounts, organizations, entitlements, optional synchronized metadata, configuration versions and audit summaries.
- Do not upload original PDFs to Supabase by default.
- Short-lived hosted page assets use encrypted object storage with deletion jobs and retention verification.
- Graphify indexes source code, architecture decisions and non-sensitive engineering knowledge, not customer documents or secrets.

### 6.3 Hosted jobs

Replace long browser requests with idempotent jobs:

- client creates an analysis run;
- each page/stage has a durable state and retry count;
- workers lease jobs with heartbeats;
- results are content-addressed and idempotent;
- stalled leases expire and resume;
- cancellation is explicit;
- UI progress is derived from completed stage records, never a timer;
- partial results remain inspectable;
- deployment changes do not strand jobs.

Vercel Functions may remain the API edge, but long-running orchestration must respect function duration/body limits. Blob is a result transport, not the system of record.

## 7. Security and commercial readiness

- authenticated organization membership on every hosted job;
- row-level authorization and tenant isolation;
- rate limits, quotas and cost ceilings per organization;
- server-only provider credentials with rotation;
- signed upload/download URLs with short expiry;
- malware/type/size validation;
- encrypted transport and encrypted local desktop store;
- configurable retention and verified deletion;
- structured logs with automatic source-text and secret redaction;
- dependency, license and model-term inventory;
- incident response, backups and restore drills;
- signed/notarized desktop releases;
- accessibility testing and supported-browser policy.

## 8. Testing and quality gates

### 8.1 Corpus

Create a versioned, access-controlled gold corpus covering:

- born-digital and scanned PDFs;
- rotated, skewed, faint and perspective-distorted pages;
- different consultants/manufacturers/templates;
- SP, TPN, panelboard and switchboard schedules;
- merged cells, multi-line headers and continuation pages;
- malformed phase labels and document errors;
- schematics at multiple scales;
- specifications and spreadsheets;
- handwritten corrections where legally permitted.

Each fixture has human-verified boards, ways, devices, attributes, feeds and provenance polygons. Corrections become regression cases after review.

### 8.2 Metrics

Measure separately:

- page classification precision/recall;
- board detection precision/recall;
- way reconstruction exact match;
- device row precision/recall;
- field accuracy by attribute;
- table cell assignment accuracy;
- schematic node/edge precision/recall;
- reconciliation pass rate;
- false-complete rate;
- correction rate and estimator minutes per board;
- p50/p95 latency and cost per page/project;
- crash, timeout and resumability rates.

The most important metric is silent omission rate. The commercial target is zero on the certified corpus.

### 8.3 Release gates

No extraction release reaches production unless:

1. All deterministic unit and schema tests pass.
2. The 26CC07 contract remains 40 boards and 632 devices.
3. No certified fixture loses a board or countable row.
4. Attribute regressions stay within an explicitly approved budget.
5. Viewer linked-review, auto-advance and stale-render race tests pass.
6. Report totals equal canonical deterministic totals.
7. Backup/restore and prior schema migration pass.
8. Hosted job timeout/retry/cancel tests pass.
9. Security and dependency checks pass.
10. Production smoke tests pass against a non-sensitive fixture.

Counts alone are insufficient: field accuracy, provenance and coverage must also pass.

## 9. Delivery plan

### Phase 0: freeze and measure

- Establish one release branch and document Vercel production mapping.
- Tag the current production engine and capture rollback artifacts.
- Inventory every real fixture and correction supplied to date.
- Generate baseline metrics for current production and the migration PR.
- Stop feature changes that lack a fixture and acceptance condition.

**Gate:** reproducible baseline, known production commit, clean rollback.

### Phase 1: canonical contracts and observability

- Extract schemas and pipeline state from `index.html` into versioned modules.
- Add analysis/stage/model-call records and reason codes.
- Add coverage snapshots and false-complete blocking.
- Preserve backward-compatible storage migrations.

**Gate:** old engine produces the same certified outputs through the new contracts.

### Phase 2: perception benchmark

- Build provider adapters for native PDF, Tesseract, Nemotron OCR v2, table structure and parse candidates.
- Create a provider-neutral coordinate/evidence schema.
- Benchmark quality, latency, cost, privacy and failure modes.
- Select primary and fallback routes by page condition.

**Gate:** chosen ensemble beats current OCR on the gold corpus without losing provenance.

### Phase 3: layout graph and schedule reconstruction

- Implement tables/cells/merged cells and multi-level header semantics.
- Add way-group and phase-span reconstruction.
- Add independent protection-column mapping.
- Migrate schedule dialects one at a time in shadow mode.

**Gate:** no board/row recall regression; materially lower correction rate.

### Phase 4: electrical evidence graph

- Implement assertions, inference levels and contradiction rules.
- Separate printed facts, inferred classifications and corrected values.
- Add deterministic device/phase/protection validators.
- Add domain rule versioning and explanation.

**Gate:** all known MCB/RCBO, SP/TP, spare/space and board-classification defects are regression tested.

### Phase 5: schematic graph

- Implement tiled drawing perception and topology reconstruction.
- Add alias-aware schematic/schedule cross-reference.
- Add conflict review and coverage metrics.

**Gate:** certified schematic node/edge and feeder recall targets pass.

### Phase 6: review and reporting redesign

- Rebuild review workflow on stable IDs and durable decisions.
- Implement exact highlights and transaction-based auto-advance.
- Consolidate report columns using canonical device keys.
- Apply consistent accessible device-family colors.
- Add evidence windows and corrections to reports.

**Gate:** end-to-end estimator usability tests and automated viewer/report gates pass.

### Phase 7: hosted commercial platform

- Resolve and merge the Vercel API migration into the actual release branch.
- Add auth, quotas, durable jobs, retention and deletion verification.
- Add Supabase tenant metadata and audit summaries with RLS.
- Complete desktop encryption/signing and deployment operations.

**Gate:** security review, load test, restore drill and controlled customer pilot.

## 10. What not to do

- Do not rewrite the whole application in one branch.
- Do not add more prompt text as a substitute for geometry and deterministic constraints.
- Do not trust one OCR/model/provider.
- Do not use AI consensus as ground truth.
- Do not deploy extraction changes from screenshots alone.
- Do not call an analysis successful because it returned some devices.
- Do not store customer PDFs in Graphify or Supabase by default.
- Do not let feature work bypass corpus regression gates.
- Do not promise universal perfect extraction. Build measurable recall, explicit uncertainty and safe review.

## 11. Definition of commercial grade

Commercial grade means:

- every output is traceable;
- every omission risk is measured;
- incomplete work cannot look complete;
- correction is fast and durable;
- releases are reproducible and reversible;
- customer data handling is explicit and secure;
- provider failures degrade safely;
- costs and latency are observable;
- known document classes meet published quality targets;
- unfamiliar documents produce reviewable evidence rather than confident guesses.

The product's intelligence is not a single model. It is the combination of visual evidence, layout structure, electrical domain rules, cross-document reasoning, deterministic reconciliation, human correction and a regression corpus that learns from every verified failure.
