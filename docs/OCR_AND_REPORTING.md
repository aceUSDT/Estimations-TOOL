# OCR, extraction, and reporting architecture

## Data flow

1. `index.html` ingests PDF, XLSX, image, and text files. PDF pages are handled independently.
2. `extractor-core.js#assessPageText` scores each page's embedded text for volume, printable characters, electrical signals, reading order, and schedule completeness.
3. Reliable text stays native. Missing, corrupt, incomplete, or badly ordered text is queued for OCR. A mixed PDF can therefore use native text on one page and OCR on the next.
4. OCR renders at high resolution subject to a 16-megapixel source cap. Image metrics select preprocessing candidates for upscaling, rotation, deskew, grayscale, contrast, sharpening, denoising, adaptive thresholding, and uneven-background correction.
5. Tesseract runs at least a base and enhanced candidate. Additional adaptive or rotated candidates run when quality remains low. `scoreOcrCandidate` combines OCR confidence, text-layer quality, electrical vocabulary, and schedule-row signals. When embedded text exists, it is included in the comparison so OCR cannot silently replace a stronger native result.
6. OCR words are reconstructed into spatial lines and table rows. Word, line, and page confidence, bounding boxes, preprocessing settings, original text, corrections, and correction reasons are retained.
7. Deterministic parsers associate board, way, phase, rating, device family, curve, breaking capacity, poles, description, and source geometry. Optional AI extraction can add review-pending rows but does not perform final aggregation.
8. `deduplicateExtractionRows` removes repeated circuits or source regions, retaining the clearer or approved record.
9. `report-core.js` builds procurement groups and contributor detail, validates all totals, and creates CSV or Excel output. Export is rejected if reconciliation fails.

## OCR configuration

| Setting | Current behavior |
|---|---|
| Engine | Tesseract.js 5.1.1, English |
| Routing threshold | Embedded-text score at least 0.62, with no corrupt characters or widespread reading-order failures; isolated coordinate anomalies are normalized |
| PDF source render | Target 2.25x; reduced when the page would exceed 16 megapixels |
| Low-resolution candidate | 3x target scale when estimated text is under 9 pixels or the short page edge is under 800 pixels |
| Candidate comparison | Base and enhanced candidates always; adaptive/deskew candidates below 0.75; orientation fallbacks below 0.58 |
| Orientation fallbacks | 90, 180, and 270 degrees when initial recognition remains poor |
| Deskew search | Projection-profile estimate from -3 to +3 degrees |
| Adaptive processing | Contrast, grayscale, sharpening, isolated-speck removal, tile-based thresholding, and background correction flags |
| OCR coordinates | Candidate coordinates are inverse-mapped to the original page before extraction |
| OCR corrections | Electrical corrections are recorded; original text is never discarded |

Manual **OCR page** reruns the current page even when native text was accepted. Re-analysis rebuilds the result and applies source deduplication, so an OCR rerun cannot append a second copy of the same circuit.

Upload, OCR, and analysis stages share a persistent processing strip immediately below the application bar. It reports the current document/page, stage, progress, and completion result without requiring the user to keep the analysis tab open.

## Canonical device model

The procurement key is exactly:

```text
device family | current rating | tripping curve | breaking capacity | pole configuration
```

Circuit purpose, description, board, circuit reference, source page, punctuation, word order, and raw OCR text are contributor data, not grouping fields.

- Missing curve: `Not specified`
- Missing breaking capacity: `Not specified`
- Unconfirmed poles: `Unclear`
- Known and missing values never merge.
- Different known curves, capacities, poles, families, or current ratings never merge.
- Lighting, Mechanical, Power, and Small Power remain visible in detail without splitting an otherwise identical procurement line.

## Traceability record

Each source occurrence retains:

- source document, page, line, and bounding box
- original OCR or source text
- normalised family, rating, poles, curve, and breaking capacity
- quantity, board, circuit/way, description, purpose, and role
- field and row confidence
- extraction method and selected OCR candidate
- automatic or user correction and reason
- review status

Selecting a row in the review or device view opens its source page and highlights its region. User edits to device family, rating, curve, poles, or breaking capacity append an audit correction instead of erasing the original value.

## Workbook output

The Excel workbook contains:

1. **Device Take-Off** - one procurement line per canonical group, board quantities, total, applications, sources, confidence, review state, and notes.
2. **Device Detail** - one contributor row per circuit or source occurrence, including control equipment.
3. **Review Required** - missing, low-confidence, corrected, conflicting, or duplicate information and the action needed.
4. **Assumptions and Qualifications** - group-specific qualifications, no-silent-assumption policy, and reconciliation result.
5. **Extraction Audit** - field-level original text, normalised value, source region, method, confidence, corrections, and review state.
6. **Control Equipment** - added when contactors, time clocks, photocells, relays, starters, overloads, transformers, or controllers are detected.

For every procurement line:

```text
total = sum(board quantities) = sum(contributing source quantities)
```

The grand total must also equal board, group, and source totals. CSV and Excel exports throw a clear reconciliation error when any equality fails.

## Measured samples

### Riverside workbook regression

Before:

- `16A SPN MCB` = 15
- `16A SPN MCB - Lighting` = 1
- `16A SPN MCB - Mech` = 5

After:

- one `16A SPN MCB` line
- board quantities `DB-02 5`, `DB-03 3`, `DB-05 5`, `DB-06 8`
- total `21`
- general, Lighting, and Mechanical usage retained in **Device Detail**
- curve and breaking capacity shown as `Not specified`, with group-specific qualifications
- source, board, and consolidated totals all equal `21`

### Supplied 26CC07 schedule PDF

- 62 pages
- all 62 pages had reliable embedded text; none required unnecessary OCR
- minimum page-quality score: 0.92
- 843 raw extraction rows, 842 after one duplicate was excluded
- 632 countable devices
- 12 procurement lines
- source, board, group, and grand totals all equal `632`

## Test coverage

`npm test` covers digital, empty scanned, and mixed page routing; corrupt and misordered text layers; rotation; skew; low resolution; faint/noisy candidates; multi-page continuation; repeated headers; merged spatial cells; OCR confusions; B16/C16/D16 and written curves; missing and conflicting curves; purpose-independent consolidation; different families at one rating; multiple boards; reconciliation; traceability; Excel output; correction review; and OCR-rerun deduplication.

Browser QA is also run at 1440x1000 and 390x844. The report must scroll inside its document region, keep the page viewport free of horizontal overflow, and render without browser errors.

## Known limitations

- OCR confidence is measurable, not a guarantee. Handwriting, stamps over text, severe perspective distortion, torn pages, and very faint originals still require human review.
- Deskew handles small angular errors. Perspective correction and geometric dewarping are not currently implemented.
- Adaptive thresholding and speck removal are browser-based heuristics, not a full computer-vision document restoration system.
- Table reconstruction uses OCR coordinates and spacing. Complex nested tables or merged cells can still produce broken field relationships and are flagged through confidence and coverage checks.
- Tesseract and PDF.js are loaded from CDNs in the static app on first use. Offline OCR requires vendoring those assets or serving a cached deployment.
- Optional AI extraction requires the server-side Netlify configuration described in `docs/AI_EXTRACTION.md`; deterministic extraction and reporting continue when it is unavailable.
- Manufacturer, series, product reference, coil voltage, and accessory details can only be reported when present in the source or confirmed by a user.
