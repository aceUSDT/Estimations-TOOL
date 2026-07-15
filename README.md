# Estimation101

Electrical document intelligence prototype and private training/evaluation corpus.

## Current implementation

- `index.html` - browser application and review interface.
- `extractor-core.js` - reusable legend-aware schedule extraction logic.
- `report-core.js` - deterministic board-by-device report model, CSV output, and formatted Excel workbook generation.
- Reports workspace - review a board-by-device take-off, including a separate control-equipment sheet, then export a formatted `.xlsx` workbook or CSV.
- Viewer - original-document PDF rendering with thumbnails, search, source highlighting, rotation, 25–1000% zoom, and drag panning in every direction. Saved PDFs rehydrate their renderer when reopened.
- Automatic browser OCR - scanned PDFs and PNG/JPG/WebP image scans are read on upload, with OCR confidence and source-page provenance retained for each extracted record.
- `tools/coverage/` - deterministic regression tests for board references, schedule dialects, reconciliation, report exports, and the extraction endpoint.
- `training/` - schema, confirmed labels, fixtures, evaluation results, and corpus analysis.
- `data/electrical_corpus/manifest.json` - file-level inventory and hashes.
- `data/electrical_corpus/derived/pages.jsonl` - page-level text, geometry, classifications, board references, and uncertainty markers for 3,222 pages.
- `data/electrical_corpus/derived/page_index.json` - corpus/page summary and OCR queue.

The raw corpus is private work data. Do not publish it or include it in the deployment ZIP.

## Run locally

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/`. For local automated UI checks only, use `?test=1`; this bypass is restricted to localhost and does not change the production password flow.

## Verification

```bash
npm test
```

## Use the application

1. Create a project and upload PDF, XLSX, PNG, JPG, WebP, TXT, CSV, or Markdown documents.
2. The app reads native PDF text immediately and automatically runs OCR when a PDF or image has no usable text layer.
3. Use **Boards & Devices** and **Review** to inspect, edit, confirm, reject, or add extracted items. Every item keeps its document and page source.
4. Use **Viewer** to search the document, highlight a board, inspect the source page, or zoom from 25% to 1000%.
5. Use **Reports** to export the checked device take-off. Control items such as contactors, time clocks, photocells, relays, starters, and DALI controllers are kept separate from protective-device totals.

The take-off report intentionally covers distribution-board devices. Main switchboard and panelboard feeder schedules are retained in the project but are excluded from the distribution-board completeness total unless their device rows are part of the take-off scope.

## Corpus rebuild

```bash
python3 scripts/build_corpus_manifest.py data/electrical_corpus/raw \
  --json data/electrical_corpus/manifest.json \
  --csv data/electrical_corpus/manifest.csv

node scripts/build_page_corpus.mjs \
  data/electrical_corpus/raw \
  data/electrical_corpus/derived
```
