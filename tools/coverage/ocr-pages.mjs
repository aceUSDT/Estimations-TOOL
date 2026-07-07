/* Workstream 0 coverage harness — step 2: OCR image-only pages.
 *
 * Mirrors the deployed app's "OCR page" action: rasterised page → tesseract.js
 * words → EstimationExtractorCore.ocrWordsToLines() line reconstruction (the
 * exact same function the app uses). Results are cached per page, so re-runs
 * only OCR what's missing.
 *
 * Usage: node ocr-pages.mjs [--concurrency N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createWorker } from 'tesseract.js';

const require = createRequire(import.meta.url);
require('../../extractor-core.js');
const core = globalThis.EstimationExtractorCore;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'work');
const CONCURRENCY = Number(process.argv.find((a, i) => process.argv[i - 1] === '--concurrency') || 3);

const docs = JSON.parse(fs.readFileSync(path.join(WORK, 'index.json'), 'utf8'));
const jobs = [];
for (const doc of docs) {
  const meta = JSON.parse(fs.readFileSync(path.join(WORK, doc.slug, 'meta.json'), 'utf8'));
  for (const pg of meta.pages) {
    if (!pg.png) continue;
    const out = path.join(WORK, doc.slug, `ocr-${String(pg.page).padStart(3, '0')}.json`);
    if (fs.existsSync(out)) continue;
    jobs.push({ slug: doc.slug, page: pg.page, png: path.join(WORK, doc.slug, pg.png), out, pg });
  }
}
console.log(`${jobs.length} pages to OCR (concurrency ${CONCURRENCY})`);

let done = 0;
const t0 = Date.now();
async function runWorker(id) {
  const worker = await createWorker('eng', 1);
  for (;;) {
    const job = jobs.shift();
    if (!job) break;
    try {
      const { data } = await worker.recognize(job.png, {}, { blocks: true, text: true });
      const words = [];
      for (const block of data.blocks || []) {
        for (const para of block.paragraphs || []) {
          for (const line of para.lines || []) {
            for (const w of line.words || []) {
              words.push({ text: w.text, bbox: w.bbox, confidence: w.confidence });
            }
          }
        }
      }
      // fall back to flat word list for tesseract.js versions that populate data.words
      if (!words.length && data.words) {
        for (const w of data.words) words.push({ text: w.text, bbox: w.bbox, confidence: w.confidence });
      }
      const img = { w: null, h: null };
      // rendered size = page pts × render_zoom
      img.w = Math.round(job.pg.width * (job.pg.render_zoom || 3));
      img.h = Math.round(job.pg.height * (job.pg.render_zoom || 3));
      const lines = core.ocrWordsToLines(words, img.w, img.h, job.pg.width, job.pg.height);
      fs.writeFileSync(job.out, JSON.stringify({ page: job.page, words: words.length, lines }));
      done++;
      const rate = done / ((Date.now() - t0) / 1000);
      console.log(`[w${id}] ${job.slug} p${job.page}: ${words.length} words, ${lines.length} lines  (${done} done, ${rate.toFixed(2)} p/s)`);
    } catch (err) {
      console.error(`[w${id}] FAILED ${job.slug} p${job.page}: ${err.message}`);
      fs.writeFileSync(job.out, JSON.stringify({ page: job.page, error: err.message, words: 0, lines: [] }));
    }
  }
  await worker.terminate();
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(jobs.length, 1)) }, (_, i) => runWorker(i + 1)));
console.log(`OCR complete: ${done} pages in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
