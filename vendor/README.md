# Vendored browser runtimes

These files are committed so PDF viewing and OCR work without a CDN and can be packaged in
the desktop installer.

| Runtime | Version | Files | License |
|---|---:|---|---|
| PDF.js | 3.11.174 | `pdf.min.js`, `pdf.worker.min.js` | Apache-2.0; see `PDFJS_LICENSE.txt`. |
| Tesseract.js | 5.1.1 | `tesseract/tesseract.min.js`, `tesseract/worker.min.js` | Apache-2.0; see `TESSERACT_JS_LICENSE.txt`. |
| tesseract.js-core | 5.1.1 | `tesseract/core/*.wasm.js` | Apache-2.0; see `TESSERACT_CORE_LICENSE.txt`. |
| English trained data | Tesseract 4 fast data | `tesseract/lang-data/eng.traineddata.gz` | Apache-2.0. |

When updating a runtime, update all paired worker/core files together, retain its licence,
run `node desktop/verify-assets.cjs`, and exercise both PDF rendering and OCR in a browser
and the packaged Electron app.
