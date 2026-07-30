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
/* Why does ocrScannedPages stop? Its catch swallows the error into a toast, so
 * nothing reaches pageerror and nothing reaches the probe. Call ocrPdfPage on
 * the page it stopped at and report what it actually throws. */
const PAGE = Number(process.argv[3] || 4);
await new Promise((r) => setTimeout(r, 45000));   // let the auto-OCR pass stop on its own
const before = await page.evaluate(`(() => {
  const f = state.cur.files[0];
  return { total: f.pages.length, read: f.pages.filter(p => (p.lines||[]).length).length,
           toasts: [...document.querySelectorAll('[class*=toast], [id*=toast]')].map(e => e.textContent.trim()).filter(Boolean).slice(-6),
           unread: f.pages.map((p, i) => ({ n: i + 1, lines: (p.lines||[]).length, needsOcr: !!p.needsOcr,
                                            ocr: !!p.ocr, unreadable: p.ocrUnreadable === true }))
                    .filter(p => !p.lines).slice(0, 6) };
})()`);
console.log(`auto-OCR settled: ${before.read}/${before.total} pages read`);
console.log('toasts visible:', JSON.stringify(before.toasts));
console.log('pages with no lines:', JSON.stringify(before.unread));
const result = await page.evaluate(`(async () => {
  const f = state.cur.files[0];
  try {
    await ocrPdfPage(f, ${PAGE}, { reanalyze: false, quiet: true });
    return { ok: true, lines: (f.pages[${PAGE} - 1].lines || []).length };
  } catch (e) {
    return { ok: false, name: e && e.name, message: String(e && e.message || e).slice(0, 400),
             stack: String(e && e.stack || '').split(String.fromCharCode(10)).slice(0, 6).join(' | ') };
  }
})()`);
console.log(`page ${PAGE}:`, JSON.stringify(result, null, 1));
await b.close();
