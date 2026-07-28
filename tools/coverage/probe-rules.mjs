/* Are there vector ruling lines on this sheet, and do they separate the tables?
 * Whitespace corridors do not exist on a densely-ruled drawing, so the table
 * borders are the only remaining boundary. This asks whether they are there. */
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
  const p=await doc.getPage(1); const vp=p.getViewport({scale:1});
  const ops=await p.getOperatorList(); const OPS=window.pdfjsLib.OPS;
  const U=window.pdfjsLib.Util;
  let ctm=vp.transform.slice(); const stack=[];
  const verticals=[];   // long, near-vertical segments in viewport space
  let counts={};
  for(let i=0;i<ops.fnArray.length;i++){
    const fn=ops.fnArray[i], args=ops.argsArray[i];
    counts[fn]=(counts[fn]||0)+1;
    if(fn===OPS.save) stack.push(ctm.slice());
    else if(fn===OPS.restore) ctm=stack.pop()||ctm;
    else if(fn===OPS.transform) ctm=U.transform(ctm,args);
    else if(fn===OPS.constructPath){
      const [fns,coords]=args; let k=0,cx=0,cy=0;
      const pt=(x,y)=>{const t=U.applyTransform([x,y],ctm);return {x:t[0],y:t[1]};};
      for(const f of fns){
        if(f===OPS.moveTo){cx=coords[k++];cy=coords[k++];}
        else if(f===OPS.lineTo){
          const a=pt(cx,cy); cx=coords[k++]; cy=coords[k++]; const c=pt(cx,cy);
          if(Math.abs(c.x-a.x)<1.5&&Math.abs(c.y-a.y)>40) verticals.push({x:(a.x+c.x)/2,len:Math.abs(c.y-a.y)});
        }
        else if(f===OPS.curveTo){k+=6;cx=coords[k-2];cy=coords[k-1];}
        else if(f===OPS.rectangle){
          const x=coords[k++],y=coords[k++],w=coords[k++],h=coords[k++];
          const a=pt(x,y), c=pt(x+w,y+h);
          if(Math.abs(c.x-a.x)<1.5&&Math.abs(c.y-a.y)>40) verticals.push({x:(a.x+c.x)/2,len:Math.abs(c.y-a.y)});
        }
        else if(f===OPS.closePath){}
      }
    }
  }
  /* Page-border clip rectangles are repeated on every save/restore and are not
   * table rules. Drop anything hugging an edge or spanning the whole sheet. */
  const inner=verticals.filter(v=>v.x>8&&v.x<vp.width-8&&v.len<vp.height*0.95);
  const byX=new Map();
  inner.forEach(v=>{const k=Math.round(v.x/3)*3; byX.set(k,Math.max(byX.get(k)||0,v.len));});
  const cols=[...byX.entries()].map(([x,len])=>({x,len})).sort((a,b)=>b.len-a.len);
  return {ops:ops.fnArray.length, pageH:vp.height, pageW:vp.width,
    verticalCount:verticals.length, innerCount:inner.length, distinctX:cols.length,
    longest:cols.slice(0,16).map(v=>({x:v.x,len:Math.round(v.len)}))};
},bytes);
console.log(path.basename(FILE));
console.log('  operators',out.ops,'| page',Math.round(out.pageW)+'x'+Math.round(out.pageH));
console.log('  vertical segments:',out.verticalCount,'| interior:',out.innerCount,'| distinct x positions:',out.distinctX);
out.longest.forEach(v=>console.log('    x='+String(v.x).padStart(6),'length',String(v.len).padStart(5),`(${(100*v.len/out.pageH).toFixed(0)}% of page height)`));
await b.close();
