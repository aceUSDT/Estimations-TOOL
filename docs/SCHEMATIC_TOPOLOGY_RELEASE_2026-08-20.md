# Schematic topology release - 20 August 2026

## Decision

Schematic extraction is an evidence pipeline, not a text-proximity feature. A feeder is accepted only when the application can retain an ordered source-to-target path through the drawing. Vector PDFs use deterministic PDF geometry. Raster-only drawings use an explicit visual path proposed by enhanced extraction and independently checked against local drawing pixels. Anything else remains unresolved and blocks normal export.

This design supports unfamiliar layouts without claiming that every future drawing can be read automatically. Unknown, contradictory, low-quality, or incomplete evidence must fail closed and remain reviewable.

## Implemented pipeline

1. Classify each page and run bounded OCR when embedded text is absent or unreliable.
2. Replay PDF.js drawing operators in order, including graphics-state transforms, path construction, strokes, fills, and annotation exclusion.
3. Build an electrical graph from conductor endpoints, endpoint-on-segment T junctions, and explicit filled junction dots.
4. Keep bare graphical crossings disconnected. Bridge only bounded device symbols or small collinear PDF fragmentation gaps, and record those bridges as provenance.
5. Bind board references to graph anchors while excluding legends, notes, and title/revision regions.
6. Trace the shortest valid graph route from source assembly to target board and retain every route point for Viewer evidence.
7. Recover immediate hierarchy when a downstream feeder branches from a proven terminal busbar inside an upstream panelboard, rather than assigning every board to the document root.
8. Bind device class, rating, poles, cable size/construction, meter, SPD, location, and ways from the route corridor with field-level source cells.
9. Reconcile exact board identities across schematic and schedule evidence. Compare supply source, device, rating, poles, cable, and document revision without fuzzy identity guessing.
10. For scanned schematics, attach the rendered image to enhanced extraction and validate every returned path against a local binary raster map. Low coverage, unsupported bends, long blank gaps, invalid coordinates, or a missing image cause the feed to be withheld.
11. Render accepted routes as selectable SVG paths linked to their source cards. The original document remains local unless online extraction is explicitly enabled.
12. Convert unresolved endpoints, ambiguous anchors, inferred gaps, missing counterparts, field mismatches, and revision conflicts into stable health reasons that block normal export.

## Non-negotiable invariants

| Invariant | Required outcome |
| --- | --- |
| Crossing without junction evidence | Conductors remain disconnected |
| Continuous vector route unavailable | No deterministic feeder is emitted |
| AI path has no image or raster support | Feed is withheld and review evidence is recorded |
| Exact board identity is absent | No fuzzy schematic-to-schedule merge |
| Schematic and schedule disagree | Both values remain visible and export is blocked |
| Only part of the schematic has schedules | Missing counterparts are reported, not treated as reconciled |
| Revisions conflict | The linked result remains blocked |
| Original customer source | Local by default; never committed as a fixture |

## Regression evidence

- `tools/coverage/test-schematic-topology.mjs` covers PDF operation replay, annotation exclusion, crossings, filled junctions, T junctions, bounded gaps, direct routes, nested panelboard hierarchy, raster continuity, missing geometry, and schedule reconciliation.
- `tools/coverage/verify-schematic-private.mjs` verifies a local uncommitted schematic, expected source-to-target edges, minimum board/feed recall, and a bounded runtime.
- `tools/coverage/verify-scanned-schematic.mjs` verifies that a PNG is sent as image evidence, a pixel-supported route is accepted, and an invented route is rejected.
- `tools/coverage/verify-real-viewer.mjs` verifies real schedule/schematic ingestion, exact row overlays, selectable feeder paths, source cards, guided review, board synchronization, and mobile layout.
- `tools/coverage/test-analysis-health.mjs` verifies fail-closed topology and cross-document health reasons.
- The complete `pnpm test`, electrical Tier 1, electrical coherence, analysis budget, Viewer, and report gates remain mandatory before production promotion.

## Standards and implementation references

- IEC 61082-1:2014 defines rules for documents used in electrotechnology, including diagrams, drawings, and tables: https://webstore.iec.ch/en/publication/4469
- IEC 60617 is the official graphical-symbol source for electrotechnical diagrams: https://webstore.iec.ch/en/publication/2723
- IEC 81346-1:2022 defines reference-designation principles: https://webstore.iec.ch/en/publication/64021
- PDF.js exposes the ordered page operator list used by the vector replay: https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html

## Release boundary

This release materially improves native-vector and scanned schematic handling, but it does not certify arbitrary future drawings without evidence. A new dialect is production-supported only when representative authorised examples pass the same source-linked extraction, reconciliation, health, performance, and browser gates above.
