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

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log(`PASS: ${pages.length} schedule pages → ${boards.length} boards, headers resolved from split cells, capacity intact.`);
