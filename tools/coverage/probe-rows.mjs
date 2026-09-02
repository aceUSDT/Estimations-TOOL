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
const rows=await page.evaluate('state.cur.analysis.rows.map(r=>({b:r.boardNorm,w:r.way,p:r.phase,d:r.device,r:r.rating,s:r.spare,src:(r.resolutionSource||"")}))');
const tree=await page.evaluate(`({
  feeders: (state.cur.analysis.feeders||[]).map(f=>f.from+' -> '+f.to),
  parents: Object.values(state.cur.analysis.boards).map(b=>b.norm+(b.parent?(' <- '+b.parent):' (no parent)')),
})`);
console.log('feeders found:',tree.feeders.length);
console.log('  ',[...new Set(tree.feeders)].slice(0,14).join('\n   '));
console.log('parents:'); tree.parents.forEach(x=>console.log('  ',x));
const byBoard={}; rows.forEach(r=>{ byBoard[r.b||'(none)']=(byBoard[r.b||'(none)']||0)+1; });
console.log('rows',rows.length); console.log('per board',JSON.stringify(byBoard));
const bySrc={}; rows.forEach(r=>{ bySrc[r.src]=(bySrc[r.src]||0)+1; }); console.log('by parser',JSON.stringify(bySrc));
const keys=rows.filter(r=>r.w!=null).map(r=>`${r.b}|${r.w}|${r.p}`);
const dupes=keys.filter((k,i)=>keys.indexOf(k)!==i);
console.log('duplicate way/phase slots:',[...new Set(dupes)].length,[...new Set(dupes)].slice(0,10).join(', '));
const dupKeys=new Set(dupes);
if(dupKeys.size){
  const full=await page.evaluate('state.cur.analysis.rows.map(r=>({k:r.boardNorm+"|"+r.way+"|"+r.phase,p:r.page,l:r.line,d:r.device,rt:r.rating,s:(r.srcText||"").slice(0,110)}))');
  console.log('duplicated rows:');
  full.filter(r=>dupKeys.has(r.k)).slice(0,12).forEach(r=>console.log('  ',r.k.padEnd(18),'p'+r.p,'line'+r.l,(r.d||'-')+'/'+(r.rt??'-'),'|',r.s));
}
await b.close();
