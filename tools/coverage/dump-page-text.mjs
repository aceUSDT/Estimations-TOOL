/* Per-page text from a PDF using the SAME pdf.js the app ships, loaded in a
 * real browser so it behaves exactly as it does in the app. Used to locate
 * section boundaries in large tenders without driving the whole ingestion
 * pipeline over 400 pages.
 *
 *   node tools/coverage/dump-page-text.mjs <file.pdf> [out.json]
 *
 * Requires a static server on 127.0.0.1:8765 serving the repo root.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FILE = path.resolve(process.argv[2]);
const OUT = process.argv[3];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
await page.goto('http://127.0.0.1:8765/vendor/PDFJS_LICENSE.txt', { waitUntil: 'domcontentloaded' });
await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'vendor/pdf.min.js'), 'utf8') });
await page.evaluate(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js'; });

const bytes = Array.from(new Uint8Array(fs.readFileSync(FILE)));
const pages = await page.evaluate(async (data) => {
  const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const p = await doc.getPage(n);
    const c = await p.getTextContent();
    out.push({ page: n, text: c.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim() });
  }
  return out;
}, bytes);

if (OUT) fs.writeFileSync(OUT, JSON.stringify(pages, null, 1));
console.error(`${pages.length} pages read from ${path.basename(FILE)}`);
await browser.close();
