const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const required = [
  'index.html',
  'extractor-core.js',
  'report-core.js',
  'assets/hager-logo.png',
  'desktop/build/icon.png',
  'vendor/exceljs.min.js',
  'vendor/pdf.min.js',
  'vendor/pdf.worker.min.js',
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/lang-data/eng.traineddata.gz',
];

const missing = required.filter((relative) => {
  const file = path.join(root, relative);
  return !fs.existsSync(file) || fs.statSync(file).size === 0;
});
if (missing.length) throw new Error(`Missing desktop assets: ${missing.join(', ')}`);

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const externalEngine of ['cdnjs.cloudflare.com/ajax/libs/pdf.js', 'cdn.jsdelivr.net/npm/tesseract.js']) {
  if (html.includes(externalEngine)) throw new Error(`External runtime dependency remains in index.html: ${externalEngine}`);
}
for (const localEngine of ['./vendor/pdf.min.js', './vendor/tesseract/tesseract.min.js']) {
  if (!html.includes(localEngine)) throw new Error(`Local runtime dependency is not wired: ${localEngine}`);
}

const main = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
if (!main.includes("APP_SCHEME = 'estimation'") || !main.includes('APP_ORIGIN')) {
  throw new Error('Desktop entry point does not use the local application origin');
}
if (/loadURL\([^)]*netlify/i.test(main)) throw new Error('Desktop entry point still loads the remote Netlify application');

console.log(`Desktop asset verification passed (${required.length} required files).`);
