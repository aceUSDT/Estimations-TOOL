/* Workstream 0 coverage harness — step 3: expected-vs-captured coverage report.
 *
 * Runs the deployed app's real pipeline (app-pipeline.cjs — verbatim copy of
 * index.html's extraction path + the shared extractor-core.js) over every
 * fixture in examples/, in two modes:
 *
 *   auto — what "Analyse documents" gets on ingest: the native text layer only.
 *          (On this corpus every page is image-only, so this is the true
 *          out-of-the-box behaviour of the deployed app.)
 *   ocr  — what the user gets after clicking "OCR scans": the same pipeline
 *          over tesseract text (the app's own ocrWordsToLines reconstruction).
 *
 * Expected-vs-captured signals per document:
 *   - expected ways from board headers ("18 WAY", "Number of ways: 12", …)
 *   - board refs named anywhere in the text vs boards that got ≥1 schedule row
 *   - pages with a schedule/text signature but zero extracted rows
 *   - ground-truth anchors (ground-truth.json) from BUILD_BRIEF §0.5
 *
 * Output: reports/coverage-baseline.json + reports/coverage-baseline.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('./app-pipeline.cjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'work');
const ROOT = path.resolve(HERE, '..', '..');
const REPORTS = path.join(ROOT, 'reports');
const groundTruth = JSON.parse(fs.readFileSync(path.join(HERE, 'ground-truth.json'), 'utf8'));

/* ---- expected-way detection (coverage signal, NOT part of the app pipeline) ---- */
const WAY_HEADER_PATTERNS = [
  /\b(\d{1,3})\s*[- ]?WAY\b/i,                       // "18 WAY TP&N", "12-way"
  /\bWAYS?\s*[:=]?\s*(\d{1,3})\b/i,                  // "Ways: 12"
  /\bN(?:o|umber)\.?\s*of\s*ways?\s*(?:\(SP\)|\(TP\))?\s*[:=]?\s*(\d{1,3})/i,
];
function expectedWaysIn(text) {
  for (const re of WAY_HEADER_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n >= 2 && n <= 200) return n;
    }
  }
  return null;
}

/* a page "looks tabular" if several lines start with a way-number-ish token */
function looksTabular(lines) {
  let hits = 0;
  for (const t of lines) {
    if (/^\s*\d{1,3}\s*[\/ ]\s*L[123]\b/i.test(t)) hits++;       // "4/L1"
    else if (/^\s*(?:way|cct|ckt|circuit)?\s*\d{1,3}\b/i.test(t) && /\b(\d+(?:\.\d+)?)\s*A?\b/.test(t)) hits++;
  }
  return hits >= 4;
}

function analyseMode(meta, ocrCache, mode) {
  // build the page list the way ingestFile + classifyFilePages would
  const pages = meta.pages.map((pg) => {
    let lines;
    if (mode === 'auto') lines = pg.native ? pg.lines.map((l) => l.text) : [];
    else lines = pg.native ? pg.lines.map((l) => l.text) : (ocrCache[pg.page] || []);
    return { page: pg.page, lines, native: pg.native };
  });
  const total = pages.length;
  pages.forEach((pg, i) => {
    const cls = P.classifyPage(pg.lines.join('\n'), i, total);
    pg.type = cls.type;
    pg.conf = cls.conf;
  });
  const A = P.analyseDocument(pages);

  /* ---- coverage metrics ---- */
  const boardsNamed = Object.keys(A.boards);
  const rowsByBoard = {};
  for (const r of A.rows) {
    const bn = r.boardNorm || '__none__';
    (rowsByBoard[bn] = rowsByBoard[bn] || []).push(r);
  }
  const boardsWithRows = boardsNamed.filter((b) => (rowsByBoard[b] || []).length);
  const expected = [];  // {page, board, ways}
  pages.forEach((pg) => {
    const text = pg.lines.join('\n');
    const ways = expectedWaysIn(text);
    if (ways) {
      const bs = [];
      pg.lines.forEach((t) => P.detectBoards(t).forEach((b) => { if (!bs.some((x) => x.norm === b.norm)) bs.push(b); }));
      expected.push({ page: pg.page, board: bs[0] ? bs[0].norm : null, ways });
    }
  });
  const zeroRowPages = pages.filter((pg) => {
    if (!pg.lines.length) return false; // blank/no-text page counted separately
    const isSched = P.SCHEDULE_TYPES.has(pg.type) || looksTabular(pg.lines);
    const nRows = A.rows.filter((r) => r.page === pg.page).length;
    return isSched && nRows === 0;
  }).map((pg) => pg.page);
  const noTextPages = pages.filter((pg) => !pg.lines.length).map((pg) => pg.page);

  const devices = P.EstimationExtractorCore.aggregateDevices(A.rows.filter((r) => r.kind !== 'mention'));
  const deviceQty = devices.reduce((s, d) => s + d.quantity, 0);

  const expWays = expected.reduce((s, e) => s + e.ways, 0);
  // captured ways: distinct way numbers per (board,page-run); approximate with distinct (board, way)
  const seenWays = new Set();
  for (const r of A.rows) {
    if (r.kind === 'mention' || r.way == null) continue;
    seenWays.add((r.boardNorm || '?') + '#' + r.way);
  }

  return {
    pages: pages.map((pg) => ({
      page: pg.page, type: pg.type, lines: pg.lines.length,
      rows: A.rows.filter((r) => r.page === pg.page).length,
      boards: [...new Set([].concat(...pg.lines.map((t) => P.detectBoards(t).map((b) => b.norm))))],
    })),
    classification: Object.fromEntries(pages.map((pg) => [pg.page, pg.type])),
    boardsNamed, boardsWithRows, rowsTotal: A.rows.length,
    scheduleRows: A.rows.filter((r) => r.kind !== 'mention').length,
    mentionRows: A.rows.filter((r) => r.kind === 'mention').length,
    cables: A.cables.length, feeders: A.feeders.length,
    deviceGroups: devices.length, deviceQty,
    expectedWayHeaders: expected, expectedWaysTotal: expWays,
    capturedWaySlots: seenWays.size,
    zeroRowPages, noTextPages,
  };
}

/* ---- ground-truth check ---- */
function gtCheck(file, res) {
  const gt = groundTruth[file];
  if (!gt) return null;
  const norm = (s) => String(s).toUpperCase().replace(/[\s.\-_\/]+/g, '');
  const out = { pass: true, checks: [] };
  if (gt.boards_expected) {
    const have = new Set(res.boardsNamed.map(norm));
    const missing = gt.boards_expected.filter((b) => !have.has(norm(b)));
    out.checks.push({ name: `boards_expected (${gt.boards_expected.length})`, missing, pass: missing.length === 0 });
    if (missing.length) out.pass = false;
  }
  if (gt.min_boards != null) {
    const pass = res.boardsNamed.length >= gt.min_boards;
    out.checks.push({ name: `min_boards ≥ ${gt.min_boards}`, actual: res.boardsNamed.length, pass });
    if (!pass) out.pass = false;
  }
  if (gt.min_rows != null) {
    const pass = res.scheduleRows >= gt.min_rows;
    out.checks.push({ name: `min_rows ≥ ${gt.min_rows}`, actual: res.scheduleRows, pass });
    if (!pass) out.pass = false;
  }
  if (gt.board_ways) {
    for (const [board, ways] of Object.entries(gt.board_ways)) {
      const bn = norm(board);
      const captured = new Set();
      // way slots captured for this board
      for (const k of res._waySlots || []) {
        const [b, w] = k.split('#');
        if (b === bn) captured.add(w);
      }
      out.checks.push({ name: `${board}: ${ways} ways expected`, captured: captured.size, pass: captured.size >= ways });
      if (captured.size < ways) out.pass = false;
    }
  }
  return out;
}

/* ---- run ---- */
const index = JSON.parse(fs.readFileSync(path.join(WORK, 'index.json'), 'utf8'));
const results = [];
for (const doc of index) {
  const meta = JSON.parse(fs.readFileSync(path.join(WORK, doc.slug, 'meta.json'), 'utf8'));
  const ocrCache = {};
  for (const pg of meta.pages) {
    const f = path.join(WORK, doc.slug, `ocr-${String(pg.page).padStart(3, '0')}.json`);
    if (fs.existsSync(f)) {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      ocrCache[pg.page] = (j.lines || []).map((l) => l.text);
    }
  }
  const auto = analyseMode(meta, ocrCache, 'auto');
  const ocr = analyseMode(meta, ocrCache, 'ocr');
  // stash way slots for gt check
  ocr._waySlots = [];
  {
    // recompute way slots (board#way) for gt
    const pages = meta.pages.map((pg) => ({
      page: pg.page,
      lines: pg.native ? pg.lines.map((l) => l.text) : (ocrCache[pg.page] || []),
    }));
    const total = pages.length;
    pages.forEach((pg, i) => { pg.type = P.classifyPage(pg.lines.join('\n'), i, total).type; });
    const A = P.analyseDocument(pages);
    const seen = new Set();
    for (const r of A.rows) {
      if (r.kind === 'mention' || r.way == null) continue;
      seen.add((r.boardNorm || '?') + '#' + r.way);
    }
    ocr._waySlots = [...seen];
  }
  const gt = gtCheck(doc.file, ocr);
  results.push({ file: doc.file, pages: doc.pages, nativePages: doc.native_pages, auto, ocr, groundTruth: gt });
  console.log(`${doc.file}: auto rows=${auto.scheduleRows} | ocr rows=${ocr.scheduleRows} boards=${ocr.boardsNamed.length} gt=${gt ? (gt.pass ? 'PASS' : 'FAIL') : '—'}`);
}

fs.mkdirSync(REPORTS, { recursive: true });
fs.writeFileSync(path.join(REPORTS, 'coverage-baseline.json'), JSON.stringify(results, null, 2));

/* ---- markdown summary ---- */
const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '—');
let md = `# Coverage baseline — deployed extractor vs examples/ corpus

Generated ${new Date().toISOString().slice(0, 10)} by \`tools/coverage/\` (Workstream 0, BUILD_BRIEF §2A).
Pipeline under test: **the deployed app's own code** — \`extractor-core.js\` + a verbatim copy of
\`index.html\`'s inline extraction path (classify → detect boards → parse schedule lines → feeders).

Two modes per document:
- **auto** — what "⚙ Analyse documents" extracts on ingest (native text layer only).
- **ocr** — the same pipeline after the manual "OCR scans" action (tesseract text via the app's \`ocrWordsToLines\`).

> **Corpus reality check:** every page of every fixture is image-only (re-rendered scans, no text layer),
> so the deployed app's automatic path extracts **zero rows from the entire corpus** until the user
> manually clicks OCR. That is failure mode §0.2‑4 (no auto-OCR) at 100% incidence.

| Document | Pages | auto rows | OCR rows | Boards named | Boards w/ rows | Way-slots captured | Expected ways (headers) | 0-row sched. pages | GT |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
`;
for (const r of results) {
  const gt = r.groundTruth ? (r.groundTruth.pass ? '✅' : '❌') : '';
  md += `| ${r.file} | ${r.pages} | ${r.auto.scheduleRows} | ${r.ocr.scheduleRows} | ${r.ocr.boardsNamed.length} | ${r.ocr.boardsWithRows.length} | ${r.ocr.capturedWaySlots} | ${r.ocr.expectedWaysTotal || '—'} | ${r.ocr.zeroRowPages.length ? r.ocr.zeroRowPages.join(',') : '—'} | ${gt} |\n`;
}
md += `\n## Ground-truth anchor checks (BUILD_BRIEF §0.5)\n\n`;
for (const r of results) {
  if (!r.groundTruth) continue;
  md += `### ${r.file} — ${r.groundTruth.pass ? 'PASS' : '**FAIL**'}\n`;
  for (const c of r.groundTruth.checks) {
    md += `- ${c.pass ? '✅' : '❌'} ${c.name}`;
    if (c.actual != null) md += ` — actual ${c.actual}`;
    if (c.captured != null) md += ` — captured ${c.captured}`;
    if (c.missing && c.missing.length) md += ` — missing: ${c.missing.slice(0, 25).join(', ')}${c.missing.length > 25 ? '…' : ''}`;
    md += `\n`;
  }
  md += `\n`;
}
md += `## Per-document page detail (OCR mode)\n\n`;
for (const r of results) {
  md += `<details><summary><b>${r.file}</b> — ${r.ocr.rowsTotal} rows, boards: ${r.ocr.boardsNamed.slice(0, 12).join(', ') || 'none'}${r.ocr.boardsNamed.length > 12 ? '…' : ''}</summary>\n\n`;
  md += `| Page | Classified as | Lines | Rows | Boards on page |\n|---:|---|---:|---:|---|\n`;
  for (const pg of r.ocr.pages) {
    md += `| ${pg.page} | ${pg.type} | ${pg.lines} | ${pg.rows} | ${pg.boards.slice(0, 6).join(', ')} |\n`;
  }
  md += `\n</details>\n\n`;
}
fs.writeFileSync(path.join(REPORTS, 'coverage-baseline.md'), md);
console.log('\nWrote reports/coverage-baseline.{json,md}');
