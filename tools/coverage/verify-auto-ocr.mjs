/* End-to-end check for WS0.1: dropping a scanned PDF must auto-OCR and analyse
 * with no manual OCR click. Drives the real app in Chromium against a local
 * static server (?test=1 unlocks on localhost only).
 */
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FIXTURE = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'examples/db-schedules/simple/BC250847-E13_Distribution.pdf');
const URL = 'http://127.0.0.1:8765/?test=1';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();

/* Serve every CDN asset from local disk so the check is hermetic (the sandbox
 * proxy MITMs TLS, which Chromium rejects). Same files, same versions. */
import fs from 'node:fs';
const NM = path.join(HERE, 'node_modules');
const VENDOR = path.join(HERE, 'vendor');
const mime = (p) => p.endsWith('.wasm') ? 'application/wasm' : p.endsWith('.gz') ? 'application/gzip' : 'application/javascript';
await page.route(/https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com)\/.*/, async (route) => {
  const url = route.request().url();
  const base = url.split('?')[0].split('/').pop();
  let file = null;
  if (base === 'pdf.min.js' || base === 'pdf.worker.min.js') file = path.join(VENDOR, base);
  else if (base === 'tesseract.min.js') file = path.join(NM, 'tesseract.js/dist/tesseract.min.js');
  else if (base === 'worker.min.js') file = path.join(NM, 'tesseract.js/dist/worker.min.js');
  else if (base.startsWith('tesseract-core')) file = path.join(NM, 'tesseract.js-core', base);
  else if (base.endsWith('.traineddata.gz')) file = path.join(VENDOR, 'eng.traineddata.gz');
  if (file && fs.existsSync(file)) {
    await route.fulfill({ status: 200, contentType: mime(base), body: fs.readFileSync(file) });
  } else {
    console.log('[route] no local file for', url);
    await route.abort();
  }
});
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('typeof state !== "undefined"');
  // boot() seeds demo projects on first run; wait for cards then create a fresh project
  await page.waitForSelector('.proj-card.new', { timeout: 30000 });
  await page.click('.proj-card.new');
  await page.fill('#mName', 'AutoOCR check');
  await page.click('#mOk');
  await page.waitForFunction('state.cur && state.cur.name === "AutoOCR check"');
  await page.setInputFiles('#fileInput', FIXTURE);
  console.log('file dropped; waiting for ingest + auto-OCR + analysis…');
  await page.waitForFunction(
    'state.cur.files.length === 1 && state.cur.files[0].status === "ready"',
    null, { timeout: 120000 },
  );
  const scanned = await page.evaluate('state.cur.files[0].pages.filter(p => !(p.lines||[]).length).length');
  console.log('pages without text after ingest (pre-OCR):', scanned);
  await page.waitForFunction(
    'state.cur.files[0].pages.every(p => (p.lines||[]).length) && state.cur.analysis',
    null, { timeout: 300000 },
  );
  const res = await page.evaluate(`({
    ocrReady: state.cur.files[0].ocrReady === true,
    pageLines: state.cur.files[0].pages.map(p => (p.lines||[]).length),
    pageTypes: state.cur.files[0].pages.map(p => p.type),
    rows: state.cur.analysis.rows.length,
    boards: Object.keys(state.cur.analysis.boards),
    status: state.cur.status,
    coverage: state.cur.analysis.coverage ? {
      boards: state.cur.analysis.coverage.summary.boards,
      zeroRowPages: state.cur.analysis.coverage.zeroRowSchedulePages.length,
    } : null,
    coveragePanelText: document.querySelector('#covSummary') ? document.querySelector('#covSummary').textContent : null,
    reviewItems: (() => { setTab('review'); return document.querySelectorAll('#reviewList .rev-item').length; })(),
  })`);
  console.log(JSON.stringify(res, null, 2));
  if (!res.ocrReady || !res.pageLines.every((n) => n > 0)) throw new Error('auto-OCR did not populate page lines');
  if (!res.coverage) throw new Error('analysis.coverage missing — reconciliation pass did not run');
  console.log('\nPASS: auto-OCR ran, analysis completed, and the reconciliation/coverage pass populated analysis.coverage.');
} finally {
  await browser.close();
}
