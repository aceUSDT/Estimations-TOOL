/* End-to-end regression: a multi-board schedule in the line shape the APP
 * really produces.
 *
 * Every earlier fix in this area was verified against page text reconstructed
 * by joining table cells into rows. The app does not produce that shape —
 * pdf.js emits ONE LINE PER CELL, so "REFERENCE" and "DB-1-GF" arrive as two
 * separate lines. Verifying against the wrong shape is how four consecutive
 * fixes passed their tests and changed nothing in the product.
 *
 * The document modelled here is a real LV distribution board schedule:
 * per-board header block, way/phase circuit refs, a spare block at the end.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('./app-pipeline.cjs');

let fail = 0;
const check = (name, cond, detail) => {
  if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; }
};

/* One line per cell, exactly as pdf.js hands them over. */
function boardPage(ref, ways, servedBy, description, liveWays) {
  const cells = [
    'REFERENCE', ref,
    'SERVED BY', servedBy,
    'DESCRIPTION', description,
    'LOCATION', 'LVAC ROOM',
    'NUMBER OF WAYS', `${ways} WAYS`,
    'INCOMER', 'GENERIC ISOLATOR',
    'INCOMER SIZE', '125A',
    'Circuit Ref', 'Device Rating (A)', 'Device Type', 'RCD Applied', 'Circuit Type', 'Name',
  ];
  for (let w = 1; w <= liveWays; w++) {
    for (const phase of ['L1', 'L2', 'L3']) {
      cells.push(`${w}-${phase}`, '10', 'Acti9 iC60H, MCB, Type C', 'No', 'Lighting, radial circuits', `CIRCUIT ${w} ${phase}`);
    }
  }
  cells.push(`${liveWays + 1}-L1,L2,L3 - ${ways}-L1,L2,L3`, '-', 'SPARE');
  return cells;
}

const raw = [
  { page: 1, lines: boardPage('DB-1-GF', 18, 'MEP MAIN DB', 'GROUND FLOOR LIGHTING & POWER', 11) },
  { page: 2, lines: boardPage('DB-2-GF', 24, 'MEP MAIN DB', 'GROUND FLOOR MECHANICAL', 12) },
  { page: 3, lines: boardPage('DB-3-FF', 18, 'MEP MAIN DB', 'FIRST FLOOR LIGHTING & POWER', 9) },
];
/* The app classifies at ingest and analyseDocument reads pg.type, so the test
   must classify too — otherwise it exercises a path the product never takes. */
const pages = raw.map((pg, i) => ({ ...pg, type: P.classifyPage(pg.lines.join('\n'), i, raw.length).type }));
for (const pg of pages) {
  check(`page ${pg.page} classified as a schedule`, P.SCHEDULE_TYPES.has(pg.type), `got ${pg.type}`);
}

const A = P.analyseDocument(pages);
const boards = Object.keys(A.boards).sort();

/* 1. Three board schedules are THREE boards. Not one per way, not one per
      phase, and not one board that swallowed the other two. */
check('three schedule pages ⇒ three boards', boards.length === 3, `got ${boards.length}: ${boards.join(', ')}`);
for (const want of ['DB1GF', 'DB2GF', 'DB3FF']) {
  check(`board ${want} present`, boards.includes(want), `got ${boards.join(', ')}`);
}

/* 2. No board name may carry a way number or a phase. */
const wayShaped = boards.filter((b) => /\d(L[123])?$/.test(b) && !['DB1GF', 'DB2GF', 'DB3FF'].includes(b));
check('no way/phase-shaped board names', wayShaped.length === 0, wayShaped.join(', '));

/* 3. Each page declared its own board — none is a continuation of the one
      before it. This is what stops one board absorbing the whole document. */
for (const norm of ['DB1GF', 'DB2GF', 'DB3FF']) {
  const b = A.boards[norm];
  check(`${norm} was declared by a page header`, Boolean(b && b.isHeader));
  check(`${norm} pages`, Boolean(b && b.pages.length === 1), b ? `on pages ${b.pages.join(',')}` : 'missing');
}

/* 4. The declared way count is read from the header block. */
check('DB1GF ways read from header', A.boards.DB1GF && A.boards.DB1GF.waysTotal === 18,
  A.boards.DB1GF ? String(A.boards.DB1GF.waysTotal) : 'missing');
check('DB2GF ways read from header', A.boards.DB2GF && A.boards.DB2GF.waysTotal === 24,
  A.boards.DB2GF ? String(A.boards.DB2GF.waysTotal) : 'missing');

/* 5. The upstream feed is the document's own words. */
check('DB1GF served-by captured', A.boards.DB1GF && /MEP MAIN DB/i.test(String(A.boards.DB1GF.servedBy || '')),
  A.boards.DB1GF ? String(A.boards.DB1GF.servedBy) : 'missing');

/* 6. Nothing may exceed its own capacity — the arithmetic that caught 83
      devices on an 18-way board. */
check('no board exceeds ways × phases', (A.capacityWarnings || []).length === 0,
  JSON.stringify(A.capacityWarnings || []));

/* A board whose schedule genuinely SPANS two pages must still work.
 *
 * The continuation rule exists for this: page 2 carries more ways of the same
 * board and no header of its own, so it inherits. Tightening header detection
 * must not break it — the failure being guarded against is the opposite one,
 * a page that DOES declare a board being treated as a continuation. */
{
  const first = boardPage('DB-9-EX', 36, 'MEP MAIN DB', 'EXTERNAL LIGHTING', 12);
  const contCells = [];
  for (let w = 13; w <= 20; w++) {
    for (const phase of ['L1', 'L2', 'L3']) {
      contCells.push(`${w}-${phase}`, '16', 'Acti9 iC60H, MCB, Type B', 'No', 'Fixed Power', `CIRCUIT ${w} ${phase}`);
    }
  }
  const rawSpan = [{ page: 1, lines: first }, { page: 2, lines: contCells }];
  const spanPages = rawSpan.map((pg, i) => ({ ...pg, type: P.classifyPage(pg.lines.join('\n'), i, rawSpan.length).type }));
  const S = P.analyseDocument(spanPages);
  const spanBoards = Object.keys(S.boards);

  check('a board spanning two pages stays ONE board', spanBoards.length === 1, `got ${spanBoards.join(', ')}`);
  check('the spanning board is the declared one', spanBoards[0] === 'DB9EX', `got ${spanBoards[0]}`);
  const b = S.boards.DB9EX;
  check('continuation page is attributed to the same board', Boolean(b && b.pages.length === 2),
    b ? `pages ${b.pages.join(',')}` : 'missing');
  check('declared ways survive the continuation', Boolean(b && b.waysTotal === 36), b ? String(b.waysTotal) : 'missing');
}

/* Completeness per board, accumulated across every page it occupies. */
{
  const { boardWayCoverage } = P.EstimationExtractorCore;
  const rows = [];
  for (let w = 1; w <= 11; w++) for (const ph of ['L1', 'L2', 'L3']) rows.push({ way: String(w), phase: ph, device: 'MCB' });
  const gap = boardWayCoverage({ waysTotal: 18 }, rows);
  check('gap: 7 of 18 ways unaccounted', gap.checkable && gap.missing.length === 7 && gap.missing[0] === '12',
    JSON.stringify(gap.missing));
  check('gap: not reported complete', gap.complete === false);

  const full = [];
  for (let w = 1; w <= 18; w++) full.push({ way: String(w), device: 'MCB', spare: w > 11 });
  const done = boardWayCoverage({ waysTotal: 18 }, full);
  check('complete when every declared way has a row', done.complete === true, JSON.stringify(done.missing));
  check('spare ways are counted as accounted for', done.spare.length === 7, JSON.stringify(done.spare));

  // a board that never declares a way count is NOT checkable, and must never
  // read as "complete" — silence is not proof.
  const unknown = boardWayCoverage({ waysTotal: null }, rows);
  check('undeclared way count ⇒ not checkable', unknown.checkable === false);
  check('undeclared way count ⇒ never claims complete', unknown.complete === false);

  // ways captured across TWO pages of the same board both count
  const split = [{ way: '1', device: 'MCB' }, { way: '2', device: 'MCB' }, { way: '3', device: 'MCB' }];
  const spanCov = boardWayCoverage({ waysTotal: 3 }, split);
  check('ways from separate pages accumulate', spanCov.complete === true, JSON.stringify(spanCov.missing));
}

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log(`PASS: ${pages.length} schedule pages → ${boards.length} boards, split-cell headers, real continuations, capacity intact.`);
