/* Workstream 0 coverage harness — the deployed app's extraction pipeline,
 * copied VERBATIM from index.html so the harness measures the real code paths.
 *
 *   - knowledge base + detectors + classifier + parsers: index.html lines 733–978
 *   - schedule/board/feeder walk (runAnalysis auto mode):  index.html lines 1475–1563
 *
 * Do NOT "improve" anything here — if index.html changes, re-copy. The point of
 * this file is that a coverage number produced here is a coverage number for
 * the shipped app.
 */
'use strict';

require('../../extractor-core.js'); // attaches globalThis.EstimationExtractorCore
const EstimationExtractorCore = globalThis.EstimationExtractorCore;

/* ==================== ELECTRICAL KNOWLEDGE BASE (index.html:733) ==================== */
const DEVICE_DEFS = [
  {name:'AFDD+RCBO', re:/\b(?:AFDD|AFFD)\s*(?:\+|combined\s+with)?\s*RCBO\b|\bRCBO\s*(?:\+|combined\s+with)\s*(?:AFDD|AFFD)\b/i},
  {name:'RCBO',      re:/\bRCBOs?\b/i},
  {name:'MCCB',      re:/\bMCCBs?\b/i},
  {name:'ACB',       re:/\bACBs?\b/i},
  {name:'MCB',       re:/\bMCBs?\b/i},
  {name:'RCD',       re:/\bRCDs?\b|\bRCCBs?\b/i},
  {name:'SPD',       re:/\bSPDs?\b|\bsurge protect(?:ion|ive) device\b/i},
  {name:'Isolator',  re:/\bisolators?\b|\bswitch[- ]disconnectors?\b/i},
  {name:'Contactor', re:/\bcontactors?\b/i},
  {name:'Time clock',re:/\b(?:time\s*clock|timeclock)s?\b/i},
  {name:'Photocell', re:/\b(?:photo\s*cell|photocell)s?\b/i},
  {name:'Relay',     re:/\brelays?\b/i},
  {name:'Timer',     re:/\btimers?\b/i},
  {name:'Starter',   re:/\b(?:motor\s+)?starters?\b/i},
  {name:'Overload',  re:/\boverloads?\b/i},
  {name:'Transformer',re:/\btransformers?\b/i},
  {name:'DALI controller',re:/\bDALI\s+(?:headend|controller|control\s+unit)\b/i},
  {name:'Fuse',      re:/\bfuses?\b|\bHRC\b/i},
  {name:'Meter',     re:/\bMID meter\b|\bkWh meter\b|\bmeters?\b/i},
  {name:'Switch',    re:/\bmain switch\b|\bswitch fuse\b/i},
];

const BOARD_TYPES = {
  MAIN:'Main LV panel', MDB:'Main distribution board', MCC:'Motor-control centre',
  SMDB:'Sub-main distribution board', DB:'Distribution board', LDB:'Lighting board',
  PDB:'Power board', MECH:'Mechanical board', FA:'Fire-alarm panel', CTRL:'Control panel',
  SB:'Switchboard', PB:'Panelboard', CU:'Consumer unit', UNK:'Unknown panel',
};

const BOARD_REF_STOPWORDS = new Set(['SCHEDULE','SCHEDULES','REFERENCE','REF','BOARD','BOARDS','FED','FROM',
  'TO','SERVING','SERVED','TYPE','RATING','SIZE','WAY','WAYS','NO','NUMBER','DATA','INCOMER','LOCATION',
  'NOTES','NOTE','LEGEND','CHART','CHARTS','IDENTITY','AND','OR','THE','FOR','WITH','IS','ARE','MODEL']);

const BOARD_PATTERNS = [
  {re:/\b([A-Z0-9]{1,6}(?:-[A-Z0-9]{1,6})*-DB(?:-[A-Z0-9]{1,6})+)\b/gi, type:'DB'},
  {re:/\b(S\s?M\s?D\s?B[\s.\-_\/]?\d*[A-Z]?)\b/gi, type:'SMDB'},
  {re:/\b(M\s?D\s?B[\s.\-_\/]?\d*[A-Z]?)\b/gi, type:'MDB'},
  {re:/\b(L\s?D\s?B[\s.\-_\/]?\d*[A-Z]?)\b/gi, type:'LDB'},
  {re:/\b(P\s?D\s?B[\s.\-_\/]?\d*[A-Z]?)\b/gi, type:'PDB'},
  {re:/\b(DB\s?[.\-_\/]\s?[A-Z0-9]{1,8}(?:[.\-_\/][A-Z0-9]{1,8})*)\b/gi, type:'DB', guard:true},
  {re:/\b(D\.?\s?B\.?(?:[\s.\-_\/]?\d+[A-Z]?)+(?:\s+[A-Z])?)\b/gi, type:'DB'},
  {re:/\b(MCC(?!B)[\s.\-_\/]?\d*)\b/gi, type:'MCC'},
  {re:/\b(MCP[\s.\-_\/]?\d*[A-Z]?)\b/gi, type:'MECH'},
  {re:/\b(SB[\s.\-_\/]?\d+[A-Z]?)\b/g, type:'SB'},
  {re:/\b((?:PB|MSB)[\s.\-_\/]?\d+[A-Z]?)\b/gi, type:'PB'},
  {re:/\b(FACP|FAP)[\s.\-_\/]?(\d*)\b/gi, type:'FA'},
  {re:/\bmain\s+lv\s+(?:panel|switchboard)\b/gi, type:'MAIN', fixed:'Main LV Panel'},
  {re:/\bmain\s+switch\s?board\b|\bMSB\b/gi, type:'MAIN', fixed:'Main LV Panel'},
  {re:/\b[Cc]onsumer\s+[Uu]nit\s*\(([^)]{2,30})\)/g, type:'CU', prefix:'CU '},
  {re:/(?<!(?:[Cc]able|[Dd]rawing|[Dd]ocument|[Pp]roject|[Jj]ob|[Ss]chedule)\s)\b(?:[Bb]oard\s+)?(?:[Rr]eference|[Ii]dentity)\s*[:\-]?\s+([A-Z0-9][A-Z0-9\/._-]{1,14})/g, type:'UNK', header:true},
  {re:/\b[Pp]anel\s+([A-Z](?:[\s.\-_]?\d+)?)\b/g, type:'CTRL', prefix:'Panel '},
];
const normBoard = s => String(s).toUpperCase().replace(/[\s.\-_\/]+/g,'');
const canonicalBoardRef = EstimationExtractorCore.canonicalBoardReference;

const CABLE_PATTERNS = [
  {re:/(\d+)\s*[Cc]\s*(?:\+\s*E)?\s*[x×]?\s*(\d+(?:\.\d+)?)\s*mm[²2]?/g, cores:1, size:2},
  {re:/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm[²2]?/g, cores:1, size:2},
  {re:/6242Y\s*(\d+(?:\.\d+)?)\s*mm[²2]?/gi, cores:null, size:1, construction:'6242Y flat T&E'},
  {re:/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*mm[²2]?/g, size:1, cpc:2},
  {re:/(\d+(?:\.\d+)?)\s*mm[²2]?\s*CPC/gi, cpc:1},
];
const CONSTRUCTIONS = ['XLPE','SWA','PVC','LSZH','LSF','FP200','MICC','AWA'];

const ratingOf = s => { const m=s.match(/\b(\d+(?:\.\d+)?)\s*A(?:mps?)?\b/i); return m?parseFloat(m[1]):null; };
const curveOf  = s => { const m=s.match(/\b(?:type|curve)\s*([BCD])\b/i); return m?m[1].toUpperCase():null; };
const polesOf  = s => {
  const m=s.match(/\b([1234])\s*P(?:ole)?\b/i); if(m) return +m[1];
  if (/\bTP&?N\b|\bfour[- ]pole\b/i.test(s)) return 4;
  if (/\bTP\b|\bthree[- ]pole\b/i.test(s)) return 3;
  if (/\bDP\b|\bdouble[- ]pole\b/i.test(s)) return 2;
  if (/\bSP\b|\bsingle[- ]pole\b/i.test(s)) return 1;
  return null;
};
const sensOf   = s => { const m=s.match(/\b(\d+)\s*mA\b/); return m?+m[1]:null; };
const phaseOf  = s => { const m=s.match(/\b(L[123])\b/); return m?m[1]:(/\bTP&?N\b|\b3PH\b|\bthree phase\b/i.test(s)?'3PH':null); };
const kaOf     = s => { const m=s.match(/\b(\d+(?:\.\d+)?)\s*kA\b/i); return m?parseFloat(m[1]):null; };

/* ==================== BOARD DETECTION (index.html:806) ==================== */
function detectBoards(line){
  const found=[];
  for (const bp of BOARD_PATTERNS){
    bp.re.lastIndex=0; let m;
    while((m=bp.re.exec(line))!==null){
      let orig = bp.fixed || (bp.prefix? bp.prefix+m[1] : m[1]);
      orig = orig.trim();
      if (bp.guard){
        const tokens = orig.split(/[\s.\-_\/]+/).slice(1);
        if (!tokens.length || BOARD_REF_STOPWORDS.has(tokens[0].toUpperCase())) continue;
      }
      if (bp.header){
        orig = orig.replace(/[.,:]+$/,'');
        if (!/[\d\/-]/.test(orig) || BOARD_REF_STOPWORDS.has(orig.toUpperCase())) continue;
      }
      const canonical = canonicalBoardRef(orig);
      orig = canonical.display;
      const norm = canonical.normalised;
      if (!norm || /^(DB|MDB|SMDB|LDB|PDB|MCC|MCP)$/.test(norm) && !bp.fixed && !/\d/.test(norm) && norm!=='MDB' && norm!=='SMDB') continue;
      if (found.some(f=>f.norm===norm)) continue;
      if (bp.type==='DB' && !bp.guard){
        const pre = line[m.index-1];
        if (pre && /[A-Za-z]/.test(pre)) continue;
      }
      found.push({orig, norm, type:bp.type, section:canonical.splitSection, start:m.index, end:m.index+m[0].length});
    }
  }
  return found
    .filter(f=>!found.some(o=>o!==f && o.start<=f.start && o.end>=f.end && (o.end-o.start)>(f.end-f.start)))
    .map(({orig,norm,type,section})=>({orig,norm,type,section}));
}

function scheduleBoardFromLines(lines){
  let sawLabel=false;
  for(const line of lines){
    const source=String(line||'');
    const label=source.match(/\bDB\s+REFERENCE\b|\b(?:DISTRIBUTION\s+)?BOARD\s*(?:REFERENCE|REF|IDENTITY)?\s*[:=\-]|\bDISTRIBUTION\s+BOARD\s+SCHEDULE\b\s*[—–:\-]\s*(?=[A-Z0-9])/i);
    if(!label) continue;
    sawLabel=true;
    const tail=source.slice(label.index+label[0].length).trim();
    const detected=detectBoards(tail)[0];
    if(detected) return detected;
    const token=tail.match(/^([A-Z0-9][A-Z0-9._\/-]{1,30})/i)?.[1];
    if(!token||!/[\d._\/-]/.test(token)) continue;
    const canonical=canonicalBoardRef(token);
    if(canonical.normalised) return {orig:canonical.display,norm:canonical.normalised,type:'UNK',section:canonical.splitSection};
  }
  if(sawLabel) return null;
  const topN=Math.max(6,Math.ceil(lines.length/3));
  for(let index=0;index<Math.min(topN,lines.length);index++){
    if(!/\b(?:board|panel)\b/i.test(String(lines[index]||''))) continue;
    const boards=detectBoards(lines[index]);if(boards.length)return boards[0];
  }
  return null;
}

function hasScheduleBoardHeader(lines){
  return (lines||[]).some(line=>/\bDB\s+REFERENCE\b|\b(?:DISTRIBUTION\s+)?BOARD\s*(?:REFERENCE|REF|IDENTITY)?\s*[:=\-]|\bDISTRIBUTION\s+BOARD\s+SCHEDULE\b\s*[—–:\-]\s*(?=[A-Z0-9])/i.test(String(line||'')));
}

/* ==================== CABLE DETECTION (index.html:828) ==================== */
function detectCables(line){
  const out=[];
  const consFound = CONSTRUCTIONS.filter(c=> new RegExp('\\b'+c+'\\b','i').test(line));
  for (const cp of CABLE_PATTERNS){
    cp.re.lastIndex=0; let m;
    while((m=cp.re.exec(line))!==null){
      const rec = {orig:m[0].trim(), cores:null,size:null,cpc:null,construction:consFound.join('/')||cp.construction||null};
      if (cp.cores) rec.cores=+m[cp.cores];
      if (cp.size)  rec.size=parseFloat(m[cp.size]);
      if (cp.cpc)   rec.cpc=parseFloat(m[cp.cpc]);
      if (/\+\s*E/i.test(m[0])) rec.earth=true;
      if (rec.size!==null || rec.cpc!==null){
        const tail = line.slice(m.index+m[0].length).match(/^\s*((?:[A-Z\/]{2,}\s*)+)/);
        if (tail && CONSTRUCTIONS.some(c=>tail[1].toUpperCase().includes(c))) rec.orig=(m[0]+tail[0]).trim();
        if (!out.some(o=>o.orig===rec.orig)) out.push(rec);
      }
    }
  }
  return out;
}

/* ==================== PAGE CLASSIFICATION (index.html:851) ==================== */
function classifyPage(text, pageIdx, totalPages){
  const low = text.toLowerCase();
  const scores = {};
  const add=(t,n)=>scores[t]=(scores[t]||0)+n;
  if (/drawing register|drawing list|drawing index|dwg register/.test(low)) add('register',8);
  if (/\blegend\b/.test(low) && /symbol|description|abbrev/.test(low)) add('legend',5);
  if (/lighting (?:layout|plan|drawing)/.test(low)) add('lighting-plan',5);
  if (/small.?power|power (?:layout|plan)/.test(low)) add('power-plan',5);
  if (/fire.?alarm (?:layout|plan|drawing)|fire detection layout/.test(low)) add('fire-plan',5);
  if (/containment|cable tray layout|trunking layout|basket layout/.test(low)) add('containment-plan',5);
  if (/single.?line|schematic|busbar|incoming supply|main switchboard/.test(low)) add('sld',4);
  if (/distribution board schedule|board schedule|db schedule/.test(low)) add('db-schedule',6);
  if (/main (?:panel|lv panel|switch\s?board).{0,30}schedule/.test(low)) add('main-schedule',6);
  if (/cable schedule/.test(low)) add('cable-schedule',6);
  if (/equipment schedule/.test(low)) add('equipment-schedule',6);
  if (/specification|shall be provided|shall comply|bs 7671|clause/.test(low)) add('spec',3);
  if (/general notes|electrical notes/.test(low)) add('notes',4);
  const hasWays = (low.match(/\bway\s*\d+|\bcct\s*\d+|\bcircuit\s*\d+/g)||[]).length;
  if (hasWays>=3) add('db-schedule',4);
  if (/board ref|board reference/.test(low)) add('db-schedule',2);
  const phaseRows=(text.match(/\bL[123]\b/g)||[]).length;
  const codedRows=(text.match(/(?:^|\n)\s*(?:\d{1,3}\s+)?(?:L[123]\s+)?\d+(?:\.\d+)?\s+[JKLMN]\s+[BCD]\b[^\n]*\b(?:Ri|Ra)\s+[LP]\b/gim)||[]).length;
  if(codedRows>=2&&phaseRows>=3) add('db-schedule',9);
  if (pageIdx===0 && totalPages>1 && /project|issued|revision/.test(low) && hasWays===0) add('cover',3);
  if (/contents/.test(low) && pageIdx===0) add('register',2);
  let best='unknown', bestS=0;
  Object.entries(scores).forEach(([t,s])=>{ if(s>bestS){best=t;bestS=s;} });
  const conf = best==='unknown'?0.3:Math.min(0.97, 0.5+bestS*0.08);
  return {type:best, conf};
}

/* ==================== SCHEDULE ROW PARSER (index.html:881) ==================== */
const HEADER_WORDS = /\b(way|cct|ckt|circuit|description|load desc|rating|amps|device|protection|protective|cable|wiring|conductor|cpc|earth|poles?|phase|curve|type)\b/i;
function isHeaderLine(line){
  if (/^\s*\d{1,3}\b/.test(line)) return false;
  const hits = (line.match(/way|cct|circuit|description|rating|device|protect|cable|phase|poles|cpc|earth|curve/gi)||[]).length;
  return hits>=2 && !ratingOf(line);
}
const isSeparator = line => /^[\s\-=_~·|+]{6,}$/.test(line);
const isNoteLine = line => /^\s*(note|nb|remark)s?\b[:.\s]/i.test(line);

function detectDeviceIn(line){
  for (const d of DEVICE_DEFS){ if (d.re.test(line)) return d.name; }
  return null;
}
function qtyIn(line, devName){
  const re = new RegExp('(\\d+)\\s*[x×]\\s*(?:\\d+\\s*A\\s*)?'+devName,'i');
  const m = re.exec(line);
  if (m) return +m[1];
  const re2 = new RegExp(devName+'s?\\s*[x×]\\s*(\\d+)','i');
  const m2 = re2.exec(line);
  return m2? +m2[1] : 1;
}

/* (index.html:905) */
function parseScheduleLine(line, ctx){
  if (isSeparator(line) || !line.trim()) return null;
  if (isNoteLine(line)) { ctx.inNotes=true; return null; }
  if (ctx.inNotes) return null;
  if (isHeaderLine(line)) { ctx.sawHeader=true; return null; }
  const structured = EstimationExtractorCore && EstimationExtractorCore.parseBamScheduleLine(line, ctx);
  if (structured) return structured;
  const dialect = EstimationExtractorCore && EstimationExtractorCore.parseKnownScheduleLine(line, ctx);
  if (dialect) return dialect;
  const wayM = line.match(/^\s*(?:way|cct|ckt|circuit)?\s*[:#]?\s*(\d{1,3})\b/i);
  const spare = /\bspare\b/i.test(line);
  const space = /\bspace\b/i.test(line);
  const device = detectDeviceIn(line);
  const rating = ratingOf(line);
  const isIncomer = /\bincomer\b|\bincoming\b|\bmain switch\b/i.test(line);
  if (!( (wayM && (device||spare||space)) || (isIncomer && device) )) return null;
  const cables = detectCables(line);
  const row = {
    way: wayM? +wayM[1] : null,
    desc: line.replace(/^\s*(?:way|cct|ckt|circuit)?\s*[:#]?\s*\d{1,3}\s*/i,'').trim(),
    device, rating,
    poles: polesOf(line), curve: curveOf(line), sens: sensOf(line),
    phase: phaseOf(line), ka: kaOf(line),
    cable: cables.length? cables[0] : null,
    spare, space, incomer: isIncomer,
    qty: device? qtyIn(line, device) : 1,
    srcText: line.trim(),
  };
  let conf = 0.6;
  if (row.way!==null) conf+=0.15;
  if (row.device) conf+=0.1;
  if (row.rating!==null) conf+=0.1;
  if (ctx.sawHeader) conf+=0.05;
  if (ctx.board) conf+=0.05; else conf-=0.2;
  row.conf = Math.max(0.2, Math.min(0.97, conf));
  return row;
}

/* ==================== FEEDER / RELATIONSHIP PARSER (index.html:944) ==================== */
function parseFeeders(line, pageBoards, ctxBoard){
  const out=[];
  const cables = detectCables(line);
  const dev = detectDeviceIn(line);
  const rating = ratingOf(line);
  const mkFeeder=(from,to)=>({from:from||null, to, cable:cables[0]||null, device:dev, rating,
    poles:polesOf(line), srcText:line.trim(), conf: from?0.85:0.6});
  let m = line.match(/\bsub-?main(?:\s+feeder)?\s+to\s+(.{2,30}?)(?:\s+in\b|\s+via\b|,|$)/i);
  if (m){ const tb=detectBoards(m[1])[0]; if (tb) out.push(mkFeeder(ctxBoard, tb.norm)); }
  m = line.match(/(.{2,30}?)\s+(?:fed|supplied)\s+from\s+(.{2,40})/i);
  if (m){
    const tb=detectBoards(m[1])[0], fb=detectBoards(m[2])[0];
    const fromName = fb? fb.norm : (/transformer/i.test(m[2])?'TRANSFORMER': /generator/i.test(m[2])?'GENERATOR': /\bATS\b|transfer switch/i.test(m[2])?'ATS': null);
    if (tb && fromName) out.push(mkFeeder(fromName, tb.norm));
  }
  m = line.match(/(.{2,30}?)\s+supplies\s+(.{2,40})/i);
  if (m){ const fb=detectBoards(m[1])[0], tb=detectBoards(m[2])[0]; if (fb&&tb) out.push(mkFeeder(fb.norm, tb.norm)); }
  m = line.match(/\b(?:outgoing\s+)?feeder\s+to\s+(.{2,30})/i);
  if (m){ const tb=detectBoards(m[1])[0]; if (tb) out.push(mkFeeder(ctxBoard, tb.norm)); }
  return out;
}

/* ==================== DOCUMENT WALK (index.html:1475 runAnalysis, auto mode) ==================== */
const SCHEDULE_TYPES=new Set(['db-schedule','main-schedule','equipment-schedule','cable-schedule']);
const MENTION_TYPES=new Set(['lighting-plan','power-plan','fire-plan','containment-plan','unknown','spec']);

/**
 * Run the app's auto analysis over one document.
 * @param pages [{page, type, lines:[string]}] — pre-classified pages with text lines
 * @returns {boards, rows, cables, feeders}
 */
function analyseDocument(pages){
  const A={ boards:{}, rows:[], cables:[], feeders:[] };
  const regBoard=(b,pageNo)=>{
    if(!A.boards[b.norm]) A.boards[b.norm]={norm:b.norm, orig:b.orig, type:b.type, pages:[], parent:null, parentConf:0};
    const e=A.boards[b.norm];
    if (!e.pages.includes(pageNo)) e.pages.push(pageNo);
    if (String(b.orig||'').length>String(e.orig||'').length) e.orig=b.orig;
  };
  let prevBoard=null;
  for (const pg of pages){
    const pageNo=pg.page;
    const lines=pg.lines;
    const pageBoards=[];
    lines.forEach(t=>detectBoards(t).forEach(b=>{ if(!pageBoards.some(x=>x.norm===b.norm)) pageBoards.push(b); }));
    pageBoards.forEach(b=>regBoard(b,pageNo));
    const isSched=SCHEDULE_TYPES.has(pg.type) && pg.type!=='cable-schedule';
    let ctxBoard=null;
    if (isSched){
      ctxBoard=scheduleBoardFromLines(lines);
      const hasBoardHeader=hasScheduleBoardHeader(lines);
      if (!ctxBoard && !hasBoardHeader && prevBoard) ctxBoard=prevBoard;
      if (ctxBoard){ regBoard(ctxBoard,pageNo); prevBoard=ctxBoard; }
      else if(hasBoardHeader) prevBoard=null;
    } else prevBoard=null;
    const parsedLegend=EstimationExtractorCore.parseProtectionLegend(lines.join('\n'));
    const ctx={board:ctxBoard?ctxBoard.norm:null, boardOrig:ctxBoard?ctxBoard.orig:null, boardSection:ctxBoard?ctxBoard.section||null:null, sawHeader:false, inNotes:false,
      lastWay:null, lastPhase:null, pendingRows:[], protectionLegend:parsedLegend.legend};
    const codedPage=isSched&&EstimationExtractorCore.parseTbaSchedulePage
      ? EstimationExtractorCore.parseTbaSchedulePage(lines,ctx)
      : {matched:false,rows:[]};
    if(codedPage.matched){
      codedPage.rows.forEach(row=>A.rows.push({boardNorm:ctx.board, boardSection:ctx.boardSection, page:pageNo, line:row.line,
        status:'pending', kind:'schedule', ...row}));
    }
    lines.forEach((t,li)=>{
      detectCables(t).forEach(c=>{
        A.cables.push({page:pageNo, line:li, boardNorm:ctx.board, srcText:t.trim(),
          conf: (isSched||pg.type==='cable-schedule')?0.85:0.7, status:'pending', ...c});
      });
      if (isSched){
        const row=codedPage.matched?null:parseScheduleLine(t, ctx);
        if (row){
          A.rows.push({boardNorm:ctx.board, boardSection:ctx.boardSection, page:pageNo, line:li, status:'pending', kind:'schedule', ...row});
        }
        parseFeeders(t, pageBoards, ctx.board).forEach(fd=>A.feeders.push({page:pageNo,line:li,...fd}));
      } else if (pg.type==='sld'||pg.type==='schematic'||pg.type==='notes'){
        const mainCtx = pageBoards.find(b=>b.type==='MAIN') || pageBoards.find(b=>b.type==='SMDB'||b.type==='MDB');
        parseFeeders(t, pageBoards, mainCtx?mainCtx.norm:null).forEach(fd=>A.feeders.push({page:pageNo,line:li,...fd}));
      }
      if (MENTION_TYPES.has(pg.type) && !isNoteLine(t)){
        const dev=detectDeviceIn(t);
        if (dev && (ratingOf(t)!==null || /\d+\s*[x×]/i.test(t))){
          const bs=detectBoards(t);
          const bn=bs.length?bs[0].norm:null;
          A.rows.push({boardNorm:bn, page:pageNo, line:li, status:'pending', kind:'mention',
            way:null, desc:t.trim(), device:dev, rating:ratingOf(t), poles:polesOf(t), curve:curveOf(t),
            sens:sensOf(t), phase:phaseOf(t), ka:kaOf(t), cable:detectCables(t)[0]||null,
            spare:false, space:false, incomer:false, qty:qtyIn(t,dev), srcText:t.trim(), conf:0.55});
        }
      }
    });
    if (isSched&&!codedPage.matched){
      const flushed = EstimationExtractorCore.finalizeScheduleContext(ctx);
      flushed.forEach(row=>{ /* rows already pushed by parseBamScheduleLine path; nothing extra */ });
    }
    A.feeders.forEach(fd=>{
      if (!fd.to) return;
      const child=A.boards[fd.to];
      if (child && fd.from && fd.from!==fd.to && (fd.conf>(child.parentConf||0))){
        child.parent=fd.from; child.parentConf=fd.conf;
      }
    });
  }
  return A;
}

module.exports = {
  EstimationExtractorCore,
  BOARD_TYPES, normBoard,
  detectBoards, detectCables, classifyPage,
  scheduleBoardFromLines,
  isHeaderLine, isSeparator, isNoteLine, detectDeviceIn, qtyIn,
  parseScheduleLine, parseFeeders, analyseDocument,
  SCHEDULE_TYPES, MENTION_TYPES,
};
