# Estimation Tools

Local-first electrical document review and distribution-board device take-off for Windows,
macOS, and modern browsers.

The app reads PDF, XLSX, image, and text documents; identifies boards, protective devices,
control equipment, feeders, and source locations; then produces a reconciled Excel report.
It is designed for review, so uncertain or conflicting information is shown instead of
being silently discarded.

## What works

- Per-page native PDF extraction with local OCR fallback for scanned pages.
- A persistent processing strip that remains visible while documents are being read.
- Board and device views with source page, confidence, circuit, rating, poles, curve,
  breaking capacity, purpose, and review state.
- Separate handling for contactors, time clocks, photocells, relays, starters, overloads,
  transformers, and controllers.
- A document viewer with thumbnails, search, rotation, drag panning, and 25-1000% zoom.
- Deterministic grouping and reconciliation before CSV or Excel export.
- Project backup and restore using `.estimation-project` files, including originals.
- Windows and macOS installers that include the application, PDF.js, and Tesseract OCR.

## Privacy and storage

The desktop app runs from packaged local files and does not need the deployed website.
Projects and original documents are stored in the current operating-system user's Electron
profile. Browser use stores them in that browser profile for the current site origin. No
central project account or shared workspace is used.

The device PIN is a local screen lock, not file encryption. Project backup files also
contain unencrypted originals and should be handled like the source documents.

Browser deployments can offer optional online extraction. It is off by default and only
sends page images and detected text after the user enables **Use online extraction**. The
packaged desktop app keeps document reading local and disables that option.

## Run in a browser

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:8765/`. `?test=1` is reserved for automated checks and only works
on localhost.

## Run or package the desktop app

```bash
cd desktop
npm ci
npm run verify
npm start
```

Use `npm run dist:win` on Windows or `npm run dist:mac` on macOS to create installers.
Tagged releases matching `desktop-v*` are built by GitHub Actions. See
[`desktop/README.md`](desktop/README.md) for signing and distribution details.

## Verification

```bash
npm test
```

The supplied 62-page `26CC07` distribution-board schedule is the primary end-to-end
regression: 40 boards and 632 countable devices, with source, board, group, and report
totals reconciled.

## AI extraction key (server-side only)

Extraction quality comes from a vision model reading each page. Google Gemini is the **only** runtime AI provider. The key is set as a **Netlify environment variable** (Site configuration → Environment variables) — never in the repo or the browser:

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini — get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (free tier available, no card required). |
| `GEMINI_MODEL` | Optional override; pinned to an exact stable model id by default (never a "latest" alias). |

Online extraction is **off by default** and requires the user's explicit consent before any page image or text is sent — the first enable shows exactly what will be transmitted. The desktop app keeps extraction fully local. The model only reads and structures pages: counting, aggregation, and pricing are deterministic code.

Architecture details are in [`docs/OCR_AND_REPORTING.md`](docs/OCR_AND_REPORTING.md).
Optional hosted extraction is documented in [`docs/AI_EXTRACTION.md`](docs/AI_EXTRACTION.md).
