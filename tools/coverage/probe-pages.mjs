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
await page.waitForFunction('state.cur.files[0].pages.every(p=>(p.lines||[]).length||p.ocr) && state.cur.analysis',null,{timeout:600000});
const out = await page.evaluate(`state.cur.files[0].pages.map(p => ({
  score: p.ocr ? p.ocr.qualityScore : null,
  unreadable: p.ocr ? p.ocr.unreadable : null,
  floor: p.ocr ? p.ocr.readableFloor : null,
  type: p.type,
  candidates: p.ocr && p.ocr.candidates ? p.ocr.candidates.map(c => c.id).join(',') : '',
  nCand: p.ocr && p.ocr.candidates ? p.ocr.candidates.length : 0,
  chosen: p.ocr ? p.ocr.selectedCandidate : null,
  lines: (p.lines||[]).length,
  sample: (p.lines||[]).slice(0, 14).map(l => (typeof l === 'string' ? l : (l.text||''))),
}))`);
out.forEach((p, i) => {
  console.log('=== page', i+1, '| type', JSON.stringify(p.type), '| score', p.score, '|', p.nCand, 'passes ['+p.candidates+'] chose', p.chosen, '|', p.lines, 'lines');
});
await b.close();
