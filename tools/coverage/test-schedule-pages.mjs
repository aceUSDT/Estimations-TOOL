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

/* Line tolerance must scale with the text, not with A4.
 *
 * On a large-format drawing sheet one table row's cells sit tens of units
 * apart, so a fixed 5-unit band made every CELL its own line: a circuit's way
 * arrived on one line and its device type on another, and the row parser could
 * match neither. */
{
  const { groupTextItemsIntoLines } = P.EstimationExtractorCore;

  // large sheet: 40-unit text, one row whose cells span 20 units of drift
  const bigRow = [
    { str: '11-L3', x: 0, y: 1000, w: 60, h: 40, angle: 0 },
    { str: '16', x: 100, y: 1012, w: 20, h: 40, angle: 0 },
    { str: 'Acti9 iC60H, MCB, Type B', x: 160, y: 992, w: 200, h: 40, angle: 0 },
    { str: 'MALE WC WATER HEATER', x: 400, y: 1005, w: 220, h: 40, angle: 0 },
    { str: '10-L3', x: 0, y: 400, w: 60, h: 40, angle: 0 },   // a genuinely different row
  ];
  const big = groupTextItemsIntoLines(bigRow).map((l) => l.text);
  const rowLine = big.find((t) => t.includes('11-L3'));
  if (!rowLine || !/16/.test(rowLine) || !/Type B/.test(rowLine) || !/WATER HEATER/.test(rowLine)) {
    console.log(`FAIL [tolerance] large-sheet row not assembled: ${JSON.stringify(big)}`); fail++;
  }
  if (big.length !== 2) { console.log(`FAIL [tolerance] expected 2 rows, got ${big.length}: ${JSON.stringify(big)}`); fail++; }

  // normal page: 10-unit text, 12 units apart — must stay separate lines
  const small = groupTextItemsIntoLines([
    { str: 'REFERENCE', x: 10, y: 100, w: 60, h: 10, angle: 0 },
    { str: 'SERVED BY', x: 10, y: 88, w: 60, h: 10, angle: 0 },
  ]).map((l) => l.text);
  if (small.length !== 2) { console.log(`FAIL [tolerance] normal page lines merged: ${JSON.stringify(small)}`); fail++; }

  if (!fail) console.log('PASS: line tolerance scales with the text.');
}

/* The line band is MEASURED from the page, not assumed.
 *
 * On a table the gaps between text bands are bimodal — small within a row, one
 * large between rows. Measured on a real schedule: ~2 and ~21 units within a
 * row against ~636 between rows. Reading that separation is what took the
 * deterministic pass from 41 device rows to 161 on that document, with every
 * board's count matching its declared way count. */
{
  const { groupTextItemsIntoLines } = P.EstimationExtractorCore;

  // a table: 6 rows, cells scattered within each row, rows far apart
  const table = [];
  for (let r = 0; r < 6; r++) {
    const base = 1000 - r * 600;
    table.push({ str: `${r + 1}-L1`, x: 0, y: base, w: 40, h: 10, angle: 0 });
    table.push({ str: '16', x: 100, y: base + 20, w: 20, h: 10, angle: 0 });
    table.push({ str: 'Acti9 iC60H, MCB, Type B', x: 160, y: base + 2, w: 180, h: 10, angle: 0 });
    table.push({ str: `CIRCUIT ${r + 1}`, x: 400, y: base + 21, w: 90, h: 10, angle: 0 });
  }
  const rows = groupTextItemsIntoLines(table).map((l) => l.text);
  if (rows.length !== 6) { console.log(`FAIL [measured] ${rows.length} rows, want 6: ${JSON.stringify(rows.slice(0, 3))}`); fail++; }
  const first = rows.find((t) => /1-L1/.test(t)) || '';
  if (!/16/.test(first) || !/Type B/.test(first) || !/CIRCUIT 1/.test(first)) {
    console.log(`FAIL [measured] row not assembled: ${JSON.stringify(first)}`); fail++;
  }

  /* Ordinary body text is NOT bimodal — every gap is about a line height — so
     nothing may be inferred and evenly spaced lines must stay separate. */
  const prose = [];
  for (let i = 0; i < 10; i++) prose.push({ str: `line ${i}`, x: 10, y: 500 - i * 12, w: 50, h: 10, angle: 0 });
  const proseLines = groupTextItemsIntoLines(prose).map((l) => l.text);
  if (proseLines.length !== 10) {
    console.log(`FAIL [measured] evenly spaced text collapsed to ${proseLines.length} lines`); fail++;
  }

  if (!fail) console.log('PASS: line band measured from page geometry.');
}

/* A page whose board cannot be NAMED must not donate its devices to the
 * previous board.
 *
 * This is the defect that reached a user's screen as one board holding 83
 * devices against an 18-way capacity of 54, while every board after it held
 * none. Unattributed is the correct outcome — an estimator can see and fix a
 * gap, but silently wrong attribution looks like a finished take-off. */
{
  const declared = boardPage('DB-8-EX', 18, 'MEP MAIN DB', 'EXTERNAL', 6);
  // a real page from the owner's document: a 110V board whose reference is a
  // description, with circuit refs the schedule parser does not recognise
  const unnamed = ['REFERENCE', 'SP&N DISTRIBUTION BOARD', 'SERVED BY', 'LVAC SWITCHBOARD',
    'NUMBER OF WAYS', '12 WAYS', 'Circuit Ref',
    'MCB/21  16  30mA  2 x 1/core x 2.5  1 x 1.5  Sockets Radial  GIS HALL 110V SOCKETS 1',
    'MCB/22  16  30mA  2 x 1/core x 2.5  1 x 1.5  Sockets Radial  GIS HALL 110V SOCKETS 2'];
  const rawMix = [{ page: 1, lines: declared }, { page: 2, lines: unnamed }];
  const mixed = rawMix.map((pg, i) => ({ ...pg, type: P.classifyPage(pg.lines.join('\n'), i, rawMix.length).type }));
  const M = P.analyseDocument(mixed);

  const leaked = M.rows.filter((r) => r.page === 2 && r.boardNorm === 'DB8EX');
  if (leaked.length) {
    console.log(`FAIL [leak] ${leaked.length} rows from an unnamed board attributed to DB8EX`); fail++;
  }
  const own = M.rows.filter((r) => r.page === 1);
  if (own.some((r) => r.boardNorm !== 'DB8EX')) {
    console.log('FAIL [leak] the declared page lost its own rows'); fail++;
  }
  if (!fail) console.log('PASS: an unnamed board does not donate devices to its neighbour.');
}

/* A board named by DESCRIPTION is still a board.
 *
 * A real page reads "REFERENCE  110V AC DISTRIBUTION BOARD" and carries
 * fourteen circuits. No code-shaped pattern matches it, so it resolved nothing
 * and its devices sat unattributed — a bucket of homeless rows where a board
 * should be. The name is taken only from the REFERENCE cell of a genuine
 * header block, so body text cannot invent boards. */
{
  const descriptive = ['REFERENCE', '110V AC DISTRIBUTION BOARD', 'SERVED BY', 'LVAC SWITCHBOARD',
    'NUMBER OF WAYS', '12 WAYS', 'INCOMER', 'GENERIC ISOLATOR', 'Circuit Ref',
    'MCB/21  16  30mA  2 x 1/core x 2.5  Sockets Radial  GIS HALL 110V SOCKETS 1'];
  const got = P.scheduleBoardFromLines(descriptive);
  check('a descriptively named board resolves', Boolean(got && /110V AC/i.test(got.orig)),
    got ? got.orig : 'NONE');

  /* Codes still win: a page carrying both must resolve to the code. */
  const coded = ['REFERENCE', 'DB-1-GF', 'SERVED BY', 'MEP MAIN DB', 'NUMBER OF WAYS', '18 WAYS',
    'INCOMER', 'GENERIC ISOLATOR', 'SCHNEIDER ELECTRIC 125A DB-1-GF LVAC ROOM'];
  const codedGot = P.scheduleBoardFromLines(coded);
  check('a code-shaped reference still wins', Boolean(codedGot && codedGot.norm === 'DB1GF'),
    codedGot ? codedGot.orig : 'NONE');

  /* And the negatives must hold: no header block, no board. */
  for (const page of [['Incoming Cable Reference', 'F28', 'Cable schedule'],
                      ['Drawing Reference', '847-RME-XX', 'Revision B'],
                      ['REFERENCE', 'SOME TEXT']]) {   // REFERENCE but no header block
    const bad = P.scheduleBoardFromLines(page);
    if (bad) { console.log(`FAIL [descriptive] ${page[0]} became board ${bad.orig}`); fail++; }
  }
}


/* Device-prefixed circuit refs — "MCB/21 ..." rather than "21-L1 ...".
 *
 * A real 110V AC board numbers its ways by device, and no dialect matched, so
 * all fourteen of its circuits were dropped on the floor. */
{
  const { parseKnownScheduleLine } = P.EstimationExtractorCore;

  const rcbo = parseKnownScheduleLine('MCB/21  16  30mA  2 x 1/core x 2.5  1 x 1.5  Sockets Radial  GIS HALL 110V SOCKETS 1');
  check('device-ref row parses', Boolean(rcbo), 'null');
  if (rcbo) {
    check('way comes from the ref', rcbo.way === 21, String(rcbo.way));
    check('rating read', rcbo.rating === 16, String(rcbo.rating));
    /* An RCD value promotes a declared MCB to an RCBO: a device with residual
       current protection is an RCBO whatever the drawing labels it. */
    check('RCD promotes MCB to RCBO', rcbo.device === 'RCBO', String(rcbo.device));
    check('sensitivity read', rcbo.sens === 30, String(rcbo.sens));
    /* Only the circuit NAME becomes the description — not the cable and CPC
       columns that precede it. That requires matching the raw line, because
       collapsing whitespace first destroys the column separators. */
    check('description is the circuit name only', rcbo.desc === 'GIS HALL 110V SOCKETS 1', rcbo.desc);
  }

  const plain = parseKnownScheduleLine('MCB/05  32  No  2 x 1/core x 6  1 x 2.5  Fixed Power  TELECOMS ROOM 110V');
  check('no RCD stays an MCB', Boolean(plain && plain.device === 'MCB'), plain ? plain.device : 'null');
  check('name read without an RCD column', Boolean(plain && plain.desc === 'TELECOMS ROOM 110V'), plain ? plain.desc : 'null');

  /* The way-and-phase dialect must be untouched by the new one. */
  const wayPhase = parseKnownScheduleLine('11-L3  16  Acti9 iC60H, MCB, Type B  No  2 x 1/core x 2.5  Fixed Power  MALE WC WATER HEATER');
  check('way-phase rows do not match the device-ref dialect',
    !wayPhase || wayPhase.way !== 11 || wayPhase.phase === 'L3', JSON.stringify(wayPhase));
}

/* The exit gate is LAST on purpose: it once sat mid-file, so checks appended
   after it could fail while the suite still reported green. */
if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: descriptive board names, with codes still winning.');
