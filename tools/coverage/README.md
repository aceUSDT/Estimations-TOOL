# Coverage harness (Workstream 0 — BUILD_BRIEF §2A)

Measures **expected vs captured** for the deployed extractor across the `examples/`
corpus. The pipeline under test is the app's real code: `extractor-core.js` plus a
**verbatim copy** of `index.html`'s inline extraction path (`app-pipeline.cjs` — do not
"fix" it; re-copy it if `index.html` changes).

## Run

```bash
cd tools/coverage
npm install                     # tesseract.js
pip3 install pymupdf
python3 extract_pages.py        # 1. text layer + render image-only pages → work/
node ocr-pages.mjs              # 2. OCR image-only pages (cached; ~10 min first run)
node coverage-report.mjs        # 3. → ../../reports/coverage-baseline.{md,json}
```

## Modes reported

- **auto** — what "⚙ Analyse documents" captures on ingest (native text only).
  On this corpus every fixture is image-only, so auto = 0 everywhere: the app
  has no auto-OCR (failure mode §0.2‑4).
- **ocr** — the same pipeline after the manual "OCR scans" action (tesseract text
  reconstructed with the app's own `ocrWordsToLines`). This isolates how much of
  the miss is *dialect/parsing* rather than *no text*.

## Signals

- Expected ways from board headers ("18 WAY TP&N" ⇒ 18) vs way-slots captured.
- Board refs named in the text vs boards that received ≥1 schedule row.
- Schedule-looking pages with zero extracted rows (a failure to raise, not an empty result).
- Ground-truth anchors in `ground-truth.json` (BUILD_BRIEF §0.5 numbers).

`work/` (rendered PNGs + OCR cache) is gitignored; `reports/coverage-baseline.*` is committed
so the baseline is diffable as extraction improves.
