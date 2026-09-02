/* Does this sheet lay its tables out side by side, and is there a clean
 * vertical corridor between them? Prints the across-page coverage so the
 * question is answered from the page rather than assumed. */
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/user/Estimations-TOOL';
const FILE=path.resolve(process.argv[2]);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const page=await (await b.newContext({ignoreHTTPSErrors:true})).newPage();
await page.goto('http://127.0.0.1:8765/vendor/PDFJS_LICENSE.txt',{waitUntil:'domcontentloaded'});
await page.addScriptTag({content:fs.readFileSync(path.join(ROOT,'vendor/pdf.min.js'),'utf8')});
await page.evaluate(()=>{window.pdfjsLib.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.min.js';});
const bytes=Array.from(new Uint8Array(fs.readFileSync(FILE)));
const out=await page.evaluate(async(data)=>{
  const doc=await window.pdfjsLib.getDocument({data:new Uint8Array(data)}).promise;
  const p=await doc.getPage(1);
  const c=await p.getTextContent();
  const vp=p.getViewport({scale:1});
  const items=c.items.map(it=>{const t=window.pdfjsLib.Util.transform(vp.transform,it.transform);
    return {s:it.str,x:t[4],y:t[5],w:it.width*vp.scale,h:Math.hypot(t[2],t[3])||10,a:Math.atan2(t[1],t[0])};})
    .filter(i=>i.s.trim());
  const q=[0,0,0,0]; items.forEach(i=>q[((Math.round(i.a/(Math.PI/2))%4)+4)%4]++);
  let rot=0; for(let i=1;i<4;i++) if(q[i]>q[rot]) rot=i;
  if(q[rot]<items.length*0.6) rot=0;
  const proj=i=>rot===1?{u:i.y,v:-i.x}:rot===2?{u:-i.x,v:-i.y}:rot===3?{u:-i.y,v:i.x}:{u:i.x,v:i.y};
  const iv=items.map(i=>{const{u}=proj(i);return [u,u+i.w];}).sort((a,b)=>a[0]-b[0]);
  const merged=[]; for(const [s,e] of iv){ const last=merged[merged.length-1];
    if(last&&s<=last[1]+0.5) last[1]=Math.max(last[1],e); else merged.push([s,e]); }
  const span=merged[merged.length-1][1]-merged[0][0];
  const gaps=[]; for(let i=1;i<merged.length;i++) gaps.push({at:merged[i-1][1],w:merged[i][0]-merged[i-1][1]});
  gaps.sort((a,b)=>b.w-a.w);
  return {rot,items:items.length,span:Math.round(span),blocks:merged.length,
    topGaps:gaps.slice(0,8).map(g=>({at:Math.round(g.at),width:Math.round(g.w),pct:+(100*g.w/span).toFixed(1)}))};
},bytes);
console.log(path.basename(FILE));
console.log('  rotation',out.rot,'| items',out.items,'| across-page span',out.span,'| coverage blocks',out.blocks);
console.log('  widest vertical corridors:'); out.topGaps.forEach(g=>console.log('    at',String(g.at).padStart(6),'width',String(g.width).padStart(5),`(${g.pct}% of span)`));
await b.close();
