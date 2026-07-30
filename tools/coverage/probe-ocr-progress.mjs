import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
const CVG='/home/user/Estimations-TOOL/tools/coverage';
const FILE=path.resolve(process.argv[2]);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const page=await (await b.newContext({ignoreHTTPSErrors:true})).newPage();
const NM=path.join(CVG,'node_modules'),VENDOR=path.join(CVG,'vendor');
const mime=p=>p.endsWith('.wasm')?'application/wasm':p.endsWith('.gz')?'application/gzip':'application/javascript';
await page.route(/https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com)\/.*/,async r=>{
  const base=r.request().url().split('?')[0].split('/').pop(); let f=null;
  if(base==='pdf.min.js'||base==='pdf.worker.min.js')f=path.join(VENDOR,base);
  else if(base==='tesseract.min.js')f=path.join(NM,'tesseract.js/dist/tesseract.min.js');
  else if(base==='worker.min.js')f=path.join(NM,'tesseract.js/dist/worker.min.js');
  else if(base.startsWith('tesseract-core'))f=path.join(NM,'tesseract.js-core',base);
  else if(base.endsWith('.traineddata.gz'))f=path.join(VENDOR,'eng.traineddata.gz');
  if(f&&fs.existsSync(f))await r.fulfill({status:200,contentType:mime(base),body:fs.readFileSync(f)}); else await r.abort();
});
await page.goto('http://127.0.0.1:8765/?test=1',{waitUntil:'domcontentloaded'});
await page.waitForFunction('typeof state !== "undefined"');
await page.waitForSelector('.proj-card.new',{timeout:30000});
await page.click('.proj-card.new'); await page.fill('#mName','Rowdump'); await page.click('#mOk');
await page.waitForFunction('state.cur && state.cur.name === "Rowdump"');
await page.setInputFiles('#fileInput',FILE);
await page.waitForFunction('state.cur.files.length===1 && state.cur.files[0].status==="ready"',null,{timeout:180000});
/* Sample ingestion progress instead of waiting for it.
 *
 * probe-pages and probe-rows both block on "every page has lines", so a document
 * that does not finish tells you only that it did not finish. This reports how
 * many pages are done at each sample, and each finished page's OCR pass count —
 * so a slow document can be measured while it is still running. */
const LIMIT_MS = Number(process.env.PROBE_MS || 480000);
const t0 = Date.now();
let last = -1;
while (Date.now() - t0 < LIMIT_MS) {
  const snap = await page.evaluate(`(() => {
    const f = state.cur && state.cur.files && state.cur.files[0];
    if (!f || !f.pages) return { total: 0, done: 0, pages: [] };
    const pages = f.pages.map((p, i) => ({
      n: i + 1,
      lines: (p.lines || []).length,
      passes: p.ocr && p.ocr.candidates ? p.ocr.candidates.length : 0,
      ids: p.ocr && p.ocr.candidates ? p.ocr.candidates.map(c => c.id).join('+') : '',
      score: p.ocr ? p.ocr.qualityScore : null,
    }));
    return { total: f.pages.length, done: pages.filter((p) => p.lines).length, status: f.status, pages };
  })()`);
  const secs = Math.round((Date.now() - t0) / 1000);
  if (snap.done !== last) {
    console.log(`t+${String(secs).padStart(4)}s  ${snap.done}/${snap.total} pages read  (file ${snap.status})`);
    for (const p of snap.pages) {
      if (p.lines && p.passes) console.log(`      page ${String(p.n).padStart(2)}  ${p.passes} passes [${p.ids}]  score ${p.score}`);
    }
    last = snap.done;
  }
  if (snap.total && snap.done === snap.total) { console.log('ALL PAGES READ'); break; }
  await new Promise((r) => setTimeout(r, 10000));
}
console.log('--- sampling ended at t+' + Math.round((Date.now() - t0) / 1000) + 's');
await b.close();
