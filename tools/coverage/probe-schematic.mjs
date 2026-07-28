/* Drive the real app against a schematic and dump what it actually reads:
 * the page's own lines, the boards it minted, and the device rows. The
 * recorded failure is that sub-boards come back but the panel and its MCCBs
 * do not, so the lines are the evidence that matters. */
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = '/home/user/Estimations-TOOL';
const CVG = path.join(ROOT, 'tools/coverage');
const FIXTURE = path.resolve(process.argv[2]);
const URL = 'http://127.0.0.1:8765/?test=1';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();

const NM = path.join(CVG, 'node_modules');
const VENDOR = path.join(CVG, 'vendor');
const mime = (p) => p.endsWith('.wasm') ? 'application/wasm' : p.endsWith('.gz') ? 'application/gzip' : 'application/javascript';
await page.route(/https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com)\/.*/, async (route) => {
  const base = route.request().url().split('?')[0].split('/').pop();
  let file = null;
  if (base === 'pdf.min.js' || base === 'pdf.worker.min.js') file = path.join(VENDOR, base);
  else if (base === 'tesseract.min.js') file = path.join(NM, 'tesseract.js/dist/tesseract.min.js');
  else if (base === 'worker.min.js') file = path.join(NM, 'tesseract.js/dist/worker.min.js');
  else if (base.startsWith('tesseract-core')) file = path.join(NM, 'tesseract.js-core', base);
  else if (base.endsWith('.traineddata.gz')) file = path.join(VENDOR, 'eng.traineddata.gz');
  if (file && fs.existsSync(file)) await route.fulfill({ status: 200, contentType: mime(base), body: fs.readFileSync(file) });
  else await route.abort();
});
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('typeof state !== "undefined"');
await page.waitForSelector('.proj-card.new', { timeout: 30000 });
await page.click('.proj-card.new');
await page.fill('#mName', 'Schematic probe');
await page.click('#mOk');
await page.waitForFunction('state.cur && state.cur.name === "Schematic probe"');
await page.setInputFiles('#fileInput', FIXTURE);
await page.waitForFunction('state.cur.files.length === 1 && state.cur.files[0].status === "ready"', null, { timeout: 180000 });
await page.waitForFunction('state.cur.files[0].pages.every(p => (p.lines||[]).length) && state.cur.analysis', null, { timeout: 600000 });

const res = await page.evaluate(`(() => {
  const core = window.EstimationExtractorCore;
  const pages = state.cur.files[0].pages;
  return {
    pageTypes: pages.map(p => p.type),
    texts: pages.map(p => (p.lines||[]).map(l => l.text)),
    methods: pages.map(p => [...new Set((p.lines||[]).map(l => l.extractionMethod))]),
    quality: pages.map(p => core.assessPageText((p.lines||[]).map(l => ({text:l.text})), {expectedType:p.type})),
    signal: pages.map(p => core.pageHasElectricalSignal((p.lines||[]).map(l => l.text))),
    /* The score the APP actually selected on, not a re-score with confidence
     * forced to zero - the confidence term is 45% of it. */
    unreadable: pages.map(p => p.ocrUnreadable === true),
    ocr: pages.map(p => p.ocr ? { chose: p.ocr.selectedCandidate, score: +Number(p.ocr.qualityScore).toFixed(3), conf: p.ocr.confidence,
      all: (p.ocr.candidates||[]).map(c => c.id + '=' + Number(c.qualityScore).toFixed(3)) } : null),
    domainHits: pages.map(p => core.scoreOcrCandidate({ text:(p.lines||[]).map(l=>l.text).join('\\n'), lines:(p.lines||[]).map(l=>({text:l.text})), confidence:0, expectedType:p.type }).domainHits),
    boards: Object.keys(state.cur.analysis.boards),
    unreadableReported: (state.cur.analysis.coverage&&state.cur.analysis.coverage.unreadablePages)||[],
    reviewItems: (() => { setTab('review'); return [...document.querySelectorAll('#reviewList .rev-item h4')].map(h=>h.textContent); })(),
    rows: state.cur.analysis.rows.map(r => ({ board: r.board, device: r.device, rating: r.rating, ref: r.ref })),
  };
})()`);
console.log('file      :', path.basename(FIXTURE));
console.log('pageTypes :', JSON.stringify(res.pageTypes));
console.log('methods   :', JSON.stringify(res.methods));
console.log('signal    :', JSON.stringify(res.signal), ' <- false means the page is never sent to AI');
console.log('quality   :', JSON.stringify(res.quality.map(q => ({ score: +q.score.toFixed(3), ...(q.reasons ? { reasons: q.reasons } : {}) }))));
console.log('unreadable:', JSON.stringify(res.unreadable), ' <- true means it is sent to the vision agent instead');
console.log('domainHits:', JSON.stringify(res.domainHits));
res.ocr.forEach((o, i) => console.log(`  ocr p${i + 1}   :`, o ? `${o.score} via ${o.chose} (tesseract conf ${o.conf}) | ${o.all.join(' ')}` : '(embedded text, no OCR)'));
console.log('boards    :', JSON.stringify(res.boards));
console.log('rows      :', res.rows.length);
console.log('coverage warns unreadable:', JSON.stringify(res.unreadableReported));
console.log('review    :', JSON.stringify(res.reviewItems));
for (const r of res.rows.slice(0, 40)) console.log('   ', JSON.stringify(r));
console.log('--- text ---');
res.texts.forEach((ts, i) => { console.log(`[page ${i + 1}] ${ts.length} lines`); ts.forEach((t) => console.log('   |', t)); });
await browser.close();
