# DB Schedule Manual Logic Release

Date: 26 August 2026

## Purpose

This release converts the estimator's manual distribution-board review process
into deterministic extraction rules, reusable layout calibration and source-
linked audit behavior. Attached source documents were used only for local
acceptance replay and are not committed or uploaded.

## Extraction contracts

- A hierarchical identifier may prove the page's primary board, way and phase
  even when the board reference is absent from the visible header.
- Connected-to and supplied-board references remain circuit or feeder evidence;
  they do not become the page's primary schedule board.
- Cable-schedule protection columns bind device type, rating, RCD and AFDD to
  the same physical row. `N/A` remains explicit negative protection evidence.
- Stacked overcurrent, earth-fault and arc-flash records are bound by header
  geometry rather than flattened into one device description.
- L1, L2 and L3 rows remain separate single-pole devices when they carry
  independent row evidence. An explicit TP&N merged record remains one
  three-pole device.
- A missing trip curve is inferred as C only when the same board evidence proves
  a 100A to 250A distribution board. The inference is labelled and requires
  review.
- Trusted spatial or calibrated way counts override ambiguous adjacent text,
  while missing coverage remains fail-closed.

## Browser ingestion

PDF text objects are split into positioned tokens before dialect detection.
This preserves column geometry when a PDF library returns a multiword phrase as
one text object. A structurally proven cable schedule can enter schedule
analysis even when the initial page classifier labels an unfamiliar template as
a specification.

## Human correction and calibration

Calibration now covers board details, incomer sections, outgoing tables, one
complete row group, single-phase rows, split three-phase rows, merged three-
phase devices, board type and all critical protection columns. Calibrations are
parser inputs and trigger re-analysis; they are not viewer-only rectangles.

Rows without an assigned board default their correction editor to the current
page's primary board. The Audit evidence panel includes a sticky approved take-
off that consolidates identical device specifications after each decision.
Guided review continues to move to the next physical row and then the next
board, with the board selector and source highlight synchronized.

## Acceptance evidence

- Private Example A: five phase-bound 10A MCB rows recovered from a cable
  schedule; no false RCD or AFDD; missing curves remain reviewable.
- Private Example B: one 125A, 12-way TPN board with four 50A C-curve MCB rows;
  no false earth-fault or arc-flash devices.
- Both examples passed direct geometry replay and real browser upload, parsing,
  canvas rendering, precise overlay, guided auto-advance and mobile containment.
- The browser verifier distinguishes expected incompleteness in deliberately
  partial fixtures from unexpected extraction failures.

## Safety boundary

This release does not claim that every future electrical document can be
interpreted without review. New layouts are handled by structural dialect
detection first, then explicit uncertainty and reusable human calibration.
Unproven grids, missing feeds, missing ways and unresolved protection fields do
not silently enter an approved take-off.
