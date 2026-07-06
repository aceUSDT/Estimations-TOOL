# Estimation101

Electrical document intelligence prototype and private training/evaluation corpus.

## Current implementation

- `index.html` - browser application and review interface.
- `extractor-core.js` - reusable legend-aware schedule extraction logic.
- Viewer assisted canvas - select a board and highlight one device row to count and persist every matching device markup for that board, including continuation pages.
- Bounded browser OCR - read scanned PDF pages individually or in batches of 20, then re-run the extraction pipeline using OCR text and coordinates.
- `tests/extractor-core.test.mjs` - deterministic extraction regression test.
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
node tests/extractor-core.test.mjs
node scripts/evaluate_training_labels.mjs
node scripts/benchmark_pdf_extraction.mjs "data/electrical_corpus/raw/EPO Circuitry mark up.pdf"
```

## Corpus rebuild

```bash
python3 scripts/build_corpus_manifest.py data/electrical_corpus/raw \
  --json data/electrical_corpus/manifest.json \
  --csv data/electrical_corpus/manifest.csv

node scripts/build_page_corpus.mjs \
  data/electrical_corpus/raw \
  data/electrical_corpus/derived
```
