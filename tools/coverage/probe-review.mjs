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
await page.waitForFunction('state.cur.files[0].pages.every(p=>(p.lines||[]).length) && state.cur.analysis',null,{timeout:600000});
const out = await page.evaluate(`(() => {
  const a = state.cur.analysis;
  const rev = (a.review || a.reviewItems || []);
  return {
    keys: Object.keys(a),
    reviewCount: rev.length,
    wayConflicts: JSON.stringify(a.wayConflicts || []).slice(0, 2500),
    duplicates: JSON.stringify(a.duplicates || []).slice(0, 1200),
    capacityWarnings: JSON.stringify(a.capacityWarnings || []).slice(0, 1200),
    discrepancies: JSON.stringify(a.discrepancies || []).slice(0, 1200),
    review: rev.map(r => ({ kind: r.kind || r.type || '?', msg: (r.message || r.text || r.label || '').slice(0,150) })),
    coverage: JSON.stringify(a.coverage || {}),
    tabs: [...document.querySelectorAll('[data-tab],.tab,button')].map(e=>(e.getAttribute('data-tab')||'')+':'+e.textContent.trim().slice(0,30)).filter(Boolean).slice(0,40),
    unreadable: (a.unreadablePages||[]).length,
    poorlyRead: (a.poorlyReadPages||[]).length,
    domReview: [...document.querySelectorAll('#anCoverage li, #anReview li, .review-item')].map(e=>e.textContent.trim().slice(0,160)),
  };
})()`);
console.log('analysis keys:', out.keys.join(', '));
console.log('review items:', out.reviewCount);
console.log('wayConflicts:', out.wayConflicts);
console.log('duplicates:', out.duplicates);
console.log('capacityWarnings:', out.capacityWarnings);
console.log('discrepancies:', out.discrepancies);
out.review.forEach(r => console.log('  [' + r.kind + ']', r.msg));
console.log('unreadable pages:', out.unreadable, ' poorly-read pages:', out.poorlyRead);

const cov = JSON.parse(out.coverage);
const pb = cov.perBoard || [];
let un=0, exp=0, cap=0;
for (const b of pb) { un += b.unaccountedWays || 0; exp += b.expectedWays || 0; cap += b.capturedWays || 0; }
console.log('boards:', pb.length, ' declared ways:', exp, ' captured ways:', cap, ' UNACCOUNTED:', un);
console.log('worst boards:');
pb.filter(b=>b.unaccountedWays).sort((a,b)=>b.unaccountedWays-a.unaccountedWays).slice(0,8)
  .forEach(b=>console.log('  ', b.orig.padEnd(9), 'declared', String(b.expectedWays).padStart(3), 'captured', String(b.capturedWays).padStart(3), 'missing', b.unaccountedWays, b.sparePercent!=null?('spare '+b.sparePercent+'%'):'(no spare % stated)'));
console.log('tabs:', out.tabs.join(' | '));

console.log('DOM review list:', out.domReview.length);
out.domReview.slice(0,25).forEach(t=>console.log('   *',t));
await b.close();
