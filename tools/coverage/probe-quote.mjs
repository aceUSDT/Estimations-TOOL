/* Export the workbook the app would produce for a document, and print the
 * quotation sheet as text. The point of that sheet is that a person can read
 * it; that is not checkable from a row count. */
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
await page.click('.proj-card.new'); await page.fill('#mName','Quote probe'); await page.click('#mOk');
await page.waitForFunction('state.cur && state.cur.name === "Quote probe"');
await page.setInputFiles('#fileInput',FILE);
await page.waitForFunction('state.cur.files.length===1 && state.cur.files[0].status==="ready"',null,{timeout:180000});
await page.waitForFunction('state.cur.files[0].pages.every(p=>(p.lines||[]).length) && state.cur.analysis',null,{timeout:600000});
const out=await page.evaluate(async ()=>{
  const model=currentReportModel();
  if(!model||!model.groups.length) return {error:'no model'};
  const wb=window.EstimationReport.createExcelWorkbook(model,window.ExcelJS);
  const lines=[]; const sheets=wb.worksheets.map(w=>w.name);
  const q=wb.getWorksheet('Quotation Take-Off');
  q.eachRow({includeEmpty:false},(r,n)=>{
    if(n<3) return;  // merged title rows repeat across every column
    const a=r.getCell(1).value??'', b2=r.getCell(2).value??'', c=r.getCell(3).value??'', d=r.getCell(4).value??'';
    lines.push(String(a).padEnd(5)+String(b2).padEnd(14)+String(c).padEnd(62)+String(d));
  });
  return {sheets, lines, rows:q.actualRowCount};
});
if(out.error){ console.log(out.error); } else {
  console.log('sheets:',out.sheets.join(' | '));
  console.log('quotation sheet rows:',out.rows);
  console.log('-'.repeat(84));
  out.lines.forEach(l=>console.log(l));
}
await b.close();
