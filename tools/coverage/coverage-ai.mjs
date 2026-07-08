/* Workstream 0 — AI-active vs regex-only recall report.
 *
 * For each ground-truth document, runs the deployed app's regex pipeline
 * (app-pipeline.cjs, the verbatim copy of index.html) to get the regex-only
 * result, then POSTs each schedule/schematic page — and any page the regex
 * left empty — to the DEPLOYED extract endpoint (the same request shape the
 * front-end sends) and merges with the front-end's rule: regex rows win on
 * slots they filled, the AI result fills the gaps, the model never counts.
 * Scoring (boards, way-slots, % of header-declared ways, GT pass/fail) is
 * deterministic code here — extractor-core.buildCoverage, never the model.
 *
 * The Anthropic key is NEVER read locally — extraction happens on the server
 * behind the function. Set AI_ENDPOINT to override the deployed URL.
 *
 * Usage:
 *   node coverage-ai.mjs                 # ground-truth docs only (bounded spend)
 *   node coverage-ai.mjs --all           # every fixture in work/index.json
 *   AI_ENDPOINT=https://host/.netlify/functions/extract node coverage-ai.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('./app-pipeline.cjs');
const core = P.EstimationExtractorCore;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'work');
const ROOT = path.resolve(HERE, '..', '..');
const REPORTS = path.join(ROOT, 'reports');
const ENDPOINT = process.env.AI_ENDPOINT || 'https://estimationtoolz.netlify.app/.netlify/functions/extract';
const groundTruth = JSON.parse(fs.readFileSync(path.join(HERE, 'ground-truth.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(WORK, 'index.json'), 'utf8'));
const norm = (s) => String(s).toUpperCase().replace(/[\s.\-_/]+/g, '');

const runAll = process.argv.includes('--all');
// Optional substring filters (argv after flags) limit which docs run, e.g.
//   node coverage-ai.mjs syntegral SRP1053
const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'));
let docs = runAll ? index : index.filter((d) => groundTruth[d.file]);
if (filters.length) docs = docs.filter((d) => filters.some((f) => d.file.toLowerCase().includes(f.toLowerCase())));
const CONCURRENCY = Number(process.env.AI_CONCURRENCY || 1);

/* ---- load a document's pages from the work cache (native text or OCR) ---- */
function loadPages(slug) {
  const meta = JSON.parse(fs.readFileSync(path.join(WORK, slug, 'meta.json'), 'utf8'));
  const pages = meta.pages.map((pg) => {
    let lines = pg.native ? pg.lines.map((l) => l.text) : [];
    // Prefer the downscaled AI JPEG (render_ai_images.py) — ~4x smaller, fits
    // Netlify's 30s sync limit better; fall back to the full-res PNG.
    const jpg = path.join(WORK, slug, `ai-${String(pg.page).padStart(3, '0')}.jpg`);
    let img = null, mediaType = 'image/png';
    if (fs.existsSync(jpg)) { img = jpg; mediaType = 'image/jpeg'; }
    else if (pg.png) img = path.join(WORK, slug, pg.png);
    if (!pg.native) {
      const f = path.join(WORK, slug, `ocr-${String(pg.page).padStart(3, '0')}.json`);
      if (fs.existsSync(f)) lines = (JSON.parse(fs.readFileSync(f, 'utf8')).lines || []).map((l) => l.text);
    }
    return { page: pg.page, lines, png: img, mediaType, width: pg.width, height: pg.height };
  });
  const total = pages.length;
  pages.forEach((pg, i) => { pg.type = P.classifyPage(pg.lines.join('\n'), i, total).type; });
  return pages;
}

/* ---- POST one page to the deployed endpoint (front-end request shape) ---- */
const BG_ENDPOINT = ENDPOINT.replace(/\/extract$/, '/extract-background');
const STATUS_ENDPOINT = ENDPOINT.replace(/\/extract$/, '/extract-status');

/* Enqueue on the background function (no 30s ceiling), then poll the status
 * endpoint for the result written to the blob store — mirrors the front-end. */
async function extractPage(slug, filename, pg) {
  const image_base64 = pg.png ? fs.readFileSync(pg.png).toString('base64') : null;
  const jobId = `${slug}-p${pg.page}-${Date.now()}`;
  const body = JSON.stringify({
    job_id: jobId, filename, page_number: pg.page, image_base64, media_type: pg.mediaType || 'image/png',
    text_lines: pg.lines.slice(0, 400), hints: { type: pg.type },
  });
  const enq = await fetch(BG_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  if (!enq.ok && enq.status !== 202) {
    const err = await enq.json().catch(() => ({}));
    throw new Error(`enqueue HTTP ${enq.status}: ${err.error || ''}`);
  }
  for (let i = 0; i < 90; i++) {            // poll up to ~4 min
    await sleep(2500);
    let s;
    try { s = await (await fetch(`${STATUS_ENDPOINT}?id=${encodeURIComponent(jobId)}`)).json(); }
    catch (e) { continue; }
    if (s.status === 'done') return s.result;
    if (s.status === 'error') throw new Error(s.error || 'extraction failed');
  }
  throw new Error('timed out waiting for background result (>4min)');
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/* ---- merge AI result into an analysis (faithful port of index.html mergeAiResult) ---- */
function mergeAi(A, out, fileId, pageNo) {
  if (!out) return;
  for (const b of out.boards || []) {
    if (!b.ref) continue;
    const n = norm(b.ref); if (!n) continue;
    if (!A.boards[n]) {
      const det = P.detectBoards(b.ref)[0];
      A.boards[n] = { norm: n, orig: b.ref, type: det ? det.type : 'UNK', pages: [], parent: null, parentConf: 0 };
    }
    const e = A.boards[n];
    if (!e.pages.some((x) => x.fileId === fileId && x.page === pageNo)) e.pages.push({ fileId, page: pageNo });
    if (b.fed_from_ref) { const fb = norm(b.fed_from_ref); if (fb && fb !== n && 0.75 > (e.parentConf || 0)) { e.parent = fb; e.parentConf = 0.75; } }
  }
  for (const d of out.devices || []) {
    const bn = d.board_ref ? norm(d.board_ref) : null;
    const dup = A.rows.some((r) => r.kind === 'schedule' && r.boardNorm === bn && r.way === d.way
      && (!r.phase || !d.phase || r.phase === d.phase || d.phase === 'L1L2L3'));
    if (dup) continue;
    const space = d.device_class === 'space';
    const spare = d.is_spare || d.device_class === 'spare';
    const device = ({ MCB: 'MCB', RCBO: 'RCBO', MCCB: 'MCCB', ACB: 'ACB', RCD: 'RCD', SPD: 'SPD', fuse: 'Fuse', switch_disconnector: 'Isolator', isolator: 'Isolator', contactor: 'Contactor', meter: 'Meter' })[d.device_class] || (d.is_spd ? 'SPD' : null);
    A.rows.push({ boardNorm: bn, fileId, page: pageNo, status: 'pending', kind: 'ai',
      way: d.way ?? null, phase: d.phase && d.phase !== 'L1L2L3' ? d.phase : (d.phase === 'L1L2L3' ? '3PH' : null),
      device, rating: d.rating_a ?? null, spare, space, incomer: !!d.is_incomer, isSpd: !!d.is_spd,
      qty: space ? 0 : 1, srcText: '[AI] ' + (d.description || d.device_class || '') });
  }
}

/* ---- way-slot set (board#way among schedule/ai rows with a way number) ---- */
function waySlots(rows) {
  const s = new Set();
  for (const r of rows) { if (r.kind === 'mention' || r.way == null) continue; s.add((r.boardNorm || '?') + '#' + r.way); }
  return s;
}
function boardWays(rows, boardNorm) {
  const s = new Set();
  for (const r of rows) { if (r.kind === 'mention' || r.way == null) continue; if (r.boardNorm === boardNorm) s.add(r.way); }
  return s;
}

function scoreGt(file, boards, rows) {
  const gt = groundTruth[file]; if (!gt) return null;
  const out = { pass: true, checks: [] };
  const have = new Set(Object.keys(boards).map((k) => k));
  if (gt.boards_expected) {
    const missing = gt.boards_expected.filter((b) => !have.has(norm(b)));
    out.checks.push({ name: `boards_expected (${gt.boards_expected.length})`, pass: missing.length === 0, detail: missing.length ? `missing ${missing.length}: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}` : 'all found' });
    if (missing.length) out.pass = false;
  }
  if (gt.min_boards != null) { const pass = Object.keys(boards).length >= gt.min_boards; out.checks.push({ name: `min_boards ≥ ${gt.min_boards}`, pass, detail: `got ${Object.keys(boards).length}` }); if (!pass) out.pass = false; }
  if (gt.min_rows != null) { const n = rows.filter((r) => r.kind !== 'mention').length; const pass = n >= gt.min_rows; out.checks.push({ name: `min_rows ≥ ${gt.min_rows}`, pass, detail: `got ${n}` }); if (!pass) out.pass = false; }
  if (gt.board_ways) for (const [board, ways] of Object.entries(gt.board_ways)) {
    const cap = boardWays(rows, norm(board)).size; const pass = cap >= ways;
    out.checks.push({ name: `${board}: ${ways} ways`, pass, detail: `captured ${cap}` });
    if (!pass) out.pass = false;
  }
  return out;
}

/* ---- run ---- */
console.log(`AI-active recall run against ${ENDPOINT}`);
console.log(`${docs.length} document(s)${runAll ? ' (full corpus)' : ' (ground-truth set)'}\n`);
const results = [];
let totalPagesSent = 0, totalErrors = 0;

for (const doc of docs) {
  const pages = loadPages(doc.slug);
  // regex-only
  const regex = P.analyseDocument(pages.map((p) => ({ page: p.page, lines: p.lines, type: p.type })));
  const covPages = pages.map((p) => ({ fileId: doc.slug, page: p.page, text: p.lines.join('\n'), type: p.type }));
  const regexCov = core.buildCoverage({ boards: regex.boards, rows: regex.rows, pages: covPages });
  const regexGt = scoreGt(doc.file, regex.boards, regex.rows);

  // ai-active: start from a deep copy of the regex result, then merge AI page-by-page
  const ai = JSON.parse(JSON.stringify(regex));
  const toSend = pages.filter((pg) => {
    const rowsHere = regex.rows.filter((r) => r.page === pg.page && r.kind === 'schedule').length;
    return P.SCHEDULE_TYPES.has(pg.type) || pg.type === 'sld' || pg.type === 'schematic' || pg.type === 'unknown' || rowsHere === 0;
  });
  process.stdout.write(`${doc.file}: sending ${toSend.length}/${pages.length} pages… `);
  let sent = 0, errs = 0;
  const CONC = CONCURRENCY;
  for (let i = 0; i < toSend.length; i += CONC) {
    await Promise.all(toSend.slice(i, i + CONC).map(async (pg) => {
      try { mergeAi(ai, await extractPage(doc.slug, doc.file, pg), doc.slug, pg.page); sent++; }
      catch (e) { errs++; process.stderr.write(`\n  ! p${pg.page}: ${e.message}`); }
    }));
  }
  totalPagesSent += sent; totalErrors += errs;
  const aiCov = core.buildCoverage({ boards: ai.boards, rows: ai.rows, pages: covPages });
  const aiGt = scoreGt(doc.file, ai.boards, ai.rows);

  const rec = {
    file: doc.file, pages: pages.length, sent, errs,
    regex: { boards: Object.keys(regex.boards).length, waySlots: waySlots(regex.rows).size, rows: regex.rows.filter((r) => r.kind !== 'mention').length, pct: regexCov.summary.pctComplete, gt: regexGt },
    ai: { boards: Object.keys(ai.boards).length, waySlots: waySlots(ai.rows).size, rows: ai.rows.filter((r) => r.kind !== 'mention').length, pct: aiCov.summary.pctComplete, gt: aiGt },
  };
  results.push(rec);
  console.log(`done (regex boards=${rec.regex.boards} slots=${rec.regex.waySlots} → AI boards=${rec.ai.boards} slots=${rec.ai.waySlots}${errs ? `, ${errs} errs` : ''})`);
}

/* ---- write report ---- */
fs.mkdirSync(REPORTS, { recursive: true });
fs.writeFileSync(path.join(REPORTS, 'coverage-ai.json'), JSON.stringify({ endpoint: ENDPOINT, generated: new Date().toISOString(), results }, null, 2));

const pctStr = (v) => (v == null ? '—' : v + '%');
const gtStr = (g) => (g == null ? '—' : g.pass ? '✅' : '❌');
let md = `# AI-active vs regex-only recall — deployed endpoint

Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.
Endpoint: \`${ENDPOINT}\` (health: \`configured:true\`, model \`claude-opus-4-8\`).
Scope: ${runAll ? 'full corpus' : 'ground-truth anchor set (§0.5)'} — ${results.length} document(s), ${totalPagesSent} page(s) sent to the model${totalErrors ? `, ${totalErrors} page error(s)` : ''}.

**Method.** Regex-only = the deployed app's inline pipeline (\`extractor-core.js\` + verbatim
\`index.html\` copy). AI-active = the same regex result, then every schedule/schematic page and
every regex-empty page POSTed to the deployed \`extract\` function; AI rows merge with regex rows
winning on slots they already filled, the model filling the gaps. All counting/scoring is
deterministic code (\`buildCoverage\`), never the model. Way-slots = distinct (board, way).

| Document | Pages | Sent | Boards (regex→AI) | Way-slots (regex→AI) | % header ways (regex→AI) | GT (regex→AI) |
|---|---:|---:|---:|---:|---:|:--:|
`;
for (const r of results) {
  md += `| ${r.file} | ${r.pages} | ${r.sent}${r.errs ? ` (+${r.errs} err)` : ''} | ${r.regex.boards} → **${r.ai.boards}** | ${r.regex.waySlots} → **${r.ai.waySlots}** | ${pctStr(r.regex.pct)} → **${pctStr(r.ai.pct)}** | ${gtStr(r.regex.gt)} → ${gtStr(r.ai.gt)} |\n`;
}

const sum = (arr, f) => arr.reduce((a, r) => a + f(r), 0);
const regexSlots = sum(results, (r) => r.regex.waySlots), aiSlots = sum(results, (r) => r.ai.waySlots);
const regexBoards = sum(results, (r) => r.regex.boards), aiBoards = sum(results, (r) => r.ai.boards);
const regexGtPass = results.filter((r) => r.regex.gt && r.regex.gt.pass).length;
const aiGtPass = results.filter((r) => r.ai.gt && r.ai.gt.pass).length;
const gtTotal = results.filter((r) => r.ai.gt).length;

md += `\n## Headline\n
- **Way-slots captured:** ${regexSlots} (regex-only) → **${aiSlots}** (AI-active)${regexSlots ? ` — ${(aiSlots / regexSlots).toFixed(1)}×` : ''} across the ${results.length} anchor documents.
- **Boards found:** ${regexBoards} → **${aiBoards}**.
- **Ground-truth checks passing:** ${regexGtPass}/${gtTotal} → **${aiGtPass}/${gtTotal}**.

## Ground-truth detail (§0.5 anchors incl. DB-MECH stitch + DB-AV)\n\n`;
for (const r of results) {
  if (!r.ai.gt) continue;
  md += `### ${r.file}\n\n| Check | regex-only | AI-active |\n|---|---|---|\n`;
  const rc = Object.fromEntries((r.regex.gt.checks || []).map((c) => [c.name, c]));
  for (const c of r.ai.gt.checks) {
    const reg = rc[c.name];
    md += `| ${c.name} | ${reg ? (reg.pass ? '✅ ' : '❌ ') + reg.detail : '—'} | ${(c.pass ? '✅ ' : '❌ ') + c.detail} |\n`;
  }
  md += `\n`;
}
md += `\n*Regex-only numbers reproduce with \`node coverage-report.mjs\`; this AI-active run reproduces with \`node coverage-ai.mjs\` (add \`--all\` for the full corpus).*\n`;
fs.writeFileSync(path.join(REPORTS, 'coverage-ai.md'), md);
console.log(`\nWrote reports/coverage-ai.{md,json}`);
console.log(`Headline: way-slots ${regexSlots} → ${aiSlots}; boards ${regexBoards} → ${aiBoards}; GT ${regexGtPass}/${gtTotal} → ${aiGtPass}/${gtTotal}`);
