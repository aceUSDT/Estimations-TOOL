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

/* Completeness per board comes from buildCoverage — the project's ONE coverage
 * model, shared by the report, the Review queue and the coverage panel. A
 * second implementation of the same question was written during this work and
 * removed: two answers to "is this board complete?" is worse than none. */
{
  const { buildCoverage } = P.EstimationExtractorCore;
  const boards = { DB1GF: { norm: 'DB1GF', orig: 'DB-1-GF', type: 'DB', pages: [{ fileId: 'f', page: 1, primary: true }] } };
  const rows = [];
  for (let w = 1; w <= 11; w++) for (const ph of ['L1', 'L2', 'L3']) rows.push({ boardNorm: 'DB1GF', way: String(w), phase: ph, device: 'MCB', kind: 'schedule' });
  const pageText = 'REFERENCE DB-1-GF NUMBER OF WAYS 18 WAYS Circuit Ref 1-L1 10 Acti9 iC60H, MCB, Type C';
  const cov = buildCoverage({ boards, rows, pages: [{ fileId: 'f', page: 1, type: 'db-schedule', text: pageText }] });
  const board = (cov.perBoard || []).find((b) => b.norm === 'DB1GF');
  check('coverage reads the declared way count', Boolean(board && board.expectedWays === 18),
    board ? String(board.expectedWays) : 'no board');
  check('coverage counts what was captured', Boolean(board && board.capturedWays === 11),
    board ? String(board.capturedWays) : 'no board');
  check('coverage reports the shortfall', Boolean(board && board.unaccountedWays === 7),
    board ? String(board.unaccountedWays) : 'no board');

  /* A page that never states a way count must report null, not zero: unknown
     is not the same as complete. */
  const noWays = buildCoverage({ boards, rows, pages: [{ fileId: 'f', page: 1, type: 'db-schedule', text: 'REFERENCE DB-1-GF Circuit Ref' }] });
  const nb = (noWays.perBoard || []).find((b) => b.norm === 'DB1GF');
  check('undeclared way count ⇒ expectedWays null', Boolean(nb && nb.expectedWays == null),
    nb ? String(nb.expectedWays) : 'no board');
}

/* THE WHOLE CHAIN, on the real line shape: analyse the pages, then run the
 * project's coverage model over the result exactly as the app does.
 *
 * This is the check that would have caught the live failure. buildCoverage
 * keys off board.pages[].primary, and no board was ever marked primary because
 * the header never resolved from split cells — so the coverage panel, the
 * report's coverage column and the gap review items were ALL silently inert.
 * Nothing errored; they simply reported nothing, for months. */
{
  const { buildCoverage } = P.EstimationExtractorCore;
  // the app feeds coverage the page text joined from its lines, with the type
  const covPages = pages.map((pg) => ({ fileId: 'f', page: pg.page, text: pg.lines.join('\n'), type: pg.type }));
  // analyseDocument keys board pages by number; coverage keys by fileId#page
  const boards = {};
  Object.values(A.boards).forEach((b) => {
    boards[b.norm] = { ...b, pages: (b.pages || []).map((pn) => ({ fileId: 'f', page: pn, primary: Boolean(b.isHeader) })) };
  });
  const cov = buildCoverage({ boards, rows: A.rows, pages: covPages });

  check('coverage produced a per-board result', Array.isArray(cov.perBoard) && cov.perBoard.length > 0,
    JSON.stringify(cov.perBoard || []).slice(0, 120));

  const gf = (cov.perBoard || []).find((b) => b.norm === 'DB1GF');
  check('DB-1-GF declared ways read end to end', Boolean(gf && gf.expectedWays === 18),
    gf ? `expectedWays=${gf.expectedWays}` : 'board missing from coverage');

  // every board that declared a way count must be checkable — the failure mode
  // being guarded is expectedWays coming back null across the board, which is
  // what "silently inert" looked like.
  const checkable = (cov.perBoard || []).filter((b) => b.expectedWays != null).length;
  check('all three boards are checkable for completeness', checkable === 3, `${checkable} of 3`);
}

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log(`PASS: ${pages.length} schedule pages → ${boards.length} boards, split-cell headers, real continuations, capacity intact.`);

/* Rotated sheets must read exactly as upright ones.
 *
 * The owner's schedules are rotated, and pdf.js reports each run's own
 * transform. Grouping by y regardless merged different table rows together:
 * the header arrived as a line of LABELS and a line of VALUES tens of lines
 * apart, so no page declared a board and every page's devices went to whichever
 * board preceded it. */
{
  const { groupTextItemsIntoLines } = P.EstimationExtractorCore;
  const table = [
    { str: 'REFERENCE', x: 10, y: 100, w: 60, h: 10 }, { str: 'DB-1-GF', x: 80, y: 100, w: 50, h: 10 },
    { str: 'SERVED BY', x: 10, y: 80, w: 60, h: 10 }, { str: 'MEP MAIN DB', x: 80, y: 80, w: 60, h: 10 },
  ];
  const rotate = (deg) => table.map((i) => {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return { str: i.str, x: i.x * c - i.y * s, y: i.x * s + i.y * c, w: i.w, h: i.h, angle: a };
  });
  const upright = JSON.stringify(groupTextItemsIntoLines(rotate(0)).map((l) => l.text));
  for (const deg of [90, 180, 270]) {
    const got = JSON.stringify(groupTextItemsIntoLines(rotate(deg)).map((l) => l.text));
    if (got !== upright) { console.log(`FAIL [rotation] ${deg}° reads ${got}, upright reads ${upright}`); fail++; }
  }
  if (!/REFERENCE {2}DB-1-GF/.test(upright)) {
    console.log(`FAIL [rotation] label and value not on one line: ${upright}`); fail++;
  }
  /* A few rotated stamps on an otherwise upright drawing must NOT transpose the
     whole page — the majority decides. */
  const mostlyUpright = [...rotate(0), { str: 'SCALE 1:50', x: 5, y: 5, w: 40, h: 8, angle: Math.PI / 2 }];
  const stillUpright = groupTextItemsIntoLines(mostlyUpright).map((l) => l.text).join('|');
  if (!/REFERENCE {2}DB-1-GF/.test(stillUpright)) {
    console.log(`FAIL [rotation] minority rotation transposed the page: ${stillUpright}`); fail++;
  }
  if (!fail) console.log('PASS: rotated sheets read as upright ones.');
}
