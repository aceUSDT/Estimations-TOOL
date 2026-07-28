/* Regression test: WS0.3 reconciliation pass (extractor-core buildCoverage). */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../../extractor-core.js');
const core = globalThis.EstimationExtractorCore;

let fail = 0;
const check = (name, cond, detail) => {
  if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; }
};

/* expectedWaysFromText */
check('18 WAY TP&N', core.expectedWaysFromText('18 WAY TP&N 250A RATED METERED BOARD')?.ways === 18);
check('12-way', core.expectedWaysFromText('a 12-way SP&N board')?.ways === 12);
check('Number of ways', core.expectedWaysFromText('Number of ways (TP): 6')?.ways === 6);
check('No of Ways', core.expectedWaysFromText('No of Ways 8')?.ways === 8);
check('split board ways', core.expectedWaysFromText('125A TP+N/12 Way Power + 8 Way Lighting Split Distribution Board')?.ways === 20);
check('no false positive on M25 WAYFINDING', core.expectedWaysFromText('the motorway junction') === null);
check('rejects way 1', core.expectedWaysFromText('WAY 1') === null); // 1 < min 2 threshold

/* pageLooksTabular */
check('phase-slot rows tabular', core.pageLooksTabular('1/L1 - SPARE\n1/L2 32 C\n1/L3 32 C\n2/L1 32 C\n2/L2 16 B'));
check('TBA phase rows tabular', core.pageLooksTabular('L1 20 K C\n1 L2 Spare\nL3 Spare\nL1 16 M C'));
check('prose not tabular', !core.pageLooksTabular('This specification describes the works.\nAll cables shall comply.'));

/* buildCoverage — DB-MECH-like scenario: header says 18 ways, 8 captured */
const boards = { DBMECH: { norm: 'DBMECH', orig: 'DB-MECH', pages: [{ fileId: 'f1', page: 11 }] } };
const rows = [];
for (let w = 1; w <= 8; w++) rows.push({ boardNorm: 'DBMECH', way: w, page: 11, fileId: 'f1', kind: 'schedule' });
const pages = [
  { fileId: 'f1', page: 11, text: 'Board Reference: DB-MECH\n18 WAY TP&N 250A RATED\n1/L1 - SPARE\n1/L2 32 C\n2/L1 32 C\n3/L1 32 C\n4/L1 16 C', type: 'db-schedule' },
  { fileId: 'f1', page: 12, text: '9/L1 16 C AHU\n10/L1 16 C AHU\n11/L1 - SPARE\n12/L2 20 C', type: 'db-schedule' },
];
const cov = core.buildCoverage({ boards, rows, pages });
const mech = cov.perBoard.find((b) => b.norm === 'DBMECH');
check('expectedWays=18', mech.expectedWays === 18, `got ${mech.expectedWays}`);
check('capturedWays=8', mech.capturedWays === 8, `got ${mech.capturedWays}`);
check('unaccounted=10', mech.unaccountedWays === 10, `got ${mech.unaccountedWays}`);
check('evidence page 11', mech.evidence && mech.evidence.page === 11);
check('zero-row page 12 flagged', cov.zeroRowSchedulePages.some((z) => z.page === 12),
  JSON.stringify(cov.zeroRowSchedulePages));
check('page 11 not flagged (has rows)', !cov.zeroRowSchedulePages.some((z) => z.page === 11));
check('summary pct', cov.summary.pctComplete === Math.round((8 / 18) * 100), `got ${cov.summary.pctComplete}`);

/* board with no header — no phantom expectation */
const cov2 = core.buildCoverage({
  boards: { DBX: { norm: 'DBX', orig: 'DB-X', pages: [{ fileId: 'f1', page: 1 }] } },
  rows: [{ boardNorm: 'DBX', way: 1, page: 1, fileId: 'f1', kind: 'schedule' }],
  pages: [{ fileId: 'f1', page: 1, text: 'DB-X sockets 32A ring', type: 'db-schedule' }],
});
check('no header ⇒ expectedWays null', cov2.perBoard[0].expectedWays === null);
check('no header ⇒ unaccounted null', cov2.perBoard[0].unaccountedWays === null);

const splitRows = [];
for (let way = 1; way <= 12; way++) splitRows.push({ boardNorm: 'DBX01', boardSection: 'P', way, page: 1, fileId: 'f2', kind: 'schedule' });
for (let way = 1; way <= 8; way++) splitRows.push({ boardNorm: 'DBX01', boardSection: 'L', way, page: 2, fileId: 'f2', kind: 'schedule' });
const splitCoverage = core.buildCoverage({
  boards: { DBX01: { norm: 'DBX01', orig: 'DB-X-01', pages: [{ fileId: 'f2', page: 1 }, { fileId: 'f2', page: 2 }] } },
  rows: splitRows,
  pages: [
    { fileId: 'f2', page: 1, text: '12 Way Power + 8 Way Lighting Split Distribution Board', type: 'db-schedule' },
    { fileId: 'f2', page: 2, text: '12 Way Power + 8 Way Lighting Split Distribution Board', type: 'db-schedule' },
  ],
});
check('split board expected=20', splitCoverage.perBoard[0].expectedWays === 20);
check('split board captured=20', splitCoverage.perBoard[0].capturedWays === 20);
check('split board complete', splitCoverage.perBoard[0].unaccountedWays === 0);

const ownedCoverage = core.buildCoverage({
  boards: {
    DBA: { norm: 'DBA', orig: 'DB-A', pages: [{ fileId: 'f3', page: 1, primary: true }, { fileId: 'f3', page: 3, primary: true }] },
    DBB: { norm: 'DBB', orig: 'DB-B', pages: [{ fileId: 'f3', page: 1, primary: false }, { fileId: 'f3', page: 2, primary: true }] },
  },
  rows: [
    { boardNorm: 'DBA', way: 1, page: 1, fileId: 'f3', kind: 'schedule' },
    { boardNorm: 'DBB', way: 1, page: 2, fileId: 'f3', kind: 'schedule' },
  ],
  pages: [
    { fileId: 'f3', page: 1, text: 'DB REFERENCE DB-A\n18 Way\nDB-B outgoing feeder', type: 'db-schedule' },
    { fileId: 'f3', page: 2, text: 'DB REFERENCE DB-B\n6 Way', type: 'db-schedule' },
    { fileId: 'f3', page: 3, text: 'Distribution Board Schedule cover page', type: 'db-schedule' },
  ],
});
check('incidental board mention does not inherit feeder page ways', ownedCoverage.perBoard.find((b) => b.norm === 'DBB').expectedWays === 6);
check('footer-only primary page is not a zero-row schedule', !ownedCoverage.zeroRowSchedulePages.some((page) => page.page === 3));

const upstreamCoverage = core.buildCoverage({
  boards: { SWB1: { norm: 'SWB1', orig: 'SWB1', type: 'UNK', pages: [{ fileId: 'f4', page: 1, primary: true }] } },
  rows: [],
  pages: [{ fileId: 'f4', page: 1, text: 'DB REFERENCE SWB1\n36 Way', type: 'db-schedule' }],
});
check('upstream switchboard excluded from DB take-off coverage', upstreamCoverage.summary.boards === 0);
check('upstream switchboard does not create a zero-row warning', upstreamCoverage.zeroRowSchedulePages.length === 0);

/* A page OCR could not read has no header, does not look tabular and declares
 * no way count, so every test in the zero-row walk skips it. Before this it
 * appeared in no count anywhere: the take-off was short a whole schematic and
 * said nothing. It has to be reported. */
const unreadableCoverage = core.buildCoverage({
  boards: {},
  rows: [],
  pages: [{ fileId: 'f5', page: 1, text: 'fli HHI hilt jl\nHH ILL iE il ili oi J', type: 'unknown', unreadable: true }],
});
check('unreadable page is reported', unreadableCoverage.unreadablePages.length === 1);
check('unreadable page is counted in the summary', unreadableCoverage.summary.unreadablePages === 1);
check('unreadable page is not miscounted as a zero-row schedule',
  unreadableCoverage.zeroRowSchedulePages.length === 0);

/* Once the vision agent has read it, the page is no longer an omission and
 * must drop out of the warning — otherwise the warning is permanent noise. */
const rescued = core.buildCoverage({
  boards: { SWB1: { norm: 'SWB1', orig: 'SWB1', type: 'UNK', pages: [{ fileId: 'f5', page: 1, primary: true }] } },
  rows: [{ fileId: 'f5', page: 1, boardNorm: 'SWB1', kind: 'schedule', way: 1, device: 'MCCB' }],
  pages: [{ fileId: 'f5', page: 1, text: 'fli HHI hilt jl', type: 'unknown', unreadable: true }],
});
check('an unreadable page that the vision agent read is no longer reported',
  rescued.unreadablePages.length === 0);

/* Ways the drawing declares SPARE without printing a row for them.
 *
 * Trimble's board-data block states the proportion ("Spare: 53.8") and prints
 * nothing for a spare way, so every such board looked short by exactly its
 * spare capacity. Measured across the ten boards of a real 386-page tender, the
 * declared percentage equalled the reported shortfall EXACTLY on all eight
 * boards that state one — 53.8% of 26 ways is 14, and 14 was the shortfall;
 * 100% of 12 is 12, and that board reported all twelve missing. Every alarm on
 * that document was false, and a check that cries wolf on every board stops
 * being read. */
{
  const mk = (sparePercent, liveWays) => {
    const rows = [];
    for (let w = 1; w <= liveWays; w += 1) rows.push({ boardNorm: 'DB1', way: String(w), device: 'MCB', kind: 'schedule', fileId: 'f', page: 1 });
    return core.buildCoverage({
      boards: { DB1: { norm: 'DB1', orig: 'DB-1', type: 'DB', header: { spare_percent: sparePercent }, pages: [{ fileId: 'f', page: 1, primary: true }] } },
      rows,
      pages: [{ fileId: 'f', page: 1, type: 'db-schedule', text: 'DB REFERENCE DB-1\n26 Way\nCircuit Ref' }],
    });
  };
  // 110-AC-MCB: 26 ways, 53.8% spare = 14 spare, 12 live, 12 captured
  const partial = mk(53.8, 12).perBoard.find((b) => b.norm === 'DB1');
  check('spare capacity: declared spare ways are not a shortfall', partial.unaccountedWays === 0,
    `unaccounted=${partial.unaccountedWays} spareWays=${partial.spareWays}`);
  check('spare capacity: the spare count is reported', partial.spareWays === 14, String(partial.spareWays));
  check('spare capacity: the declared total is unchanged', partial.expectedWays === 26, String(partial.expectedWays));

  // DB-6-SEC: 12 ways, 100% spare, no rows at all — complete, not empty
  const allSpare = mk(100, 0).perBoard.find((b) => b.norm === 'DB1');
  check('spare capacity: a fully spare board is complete', allSpare.unaccountedWays === 0,
    String(allSpare.unaccountedWays));

  // and a board with a REAL gap must still report it
  const short = mk(0, 12).perBoard.find((b) => b.norm === 'DB1');
  check('spare capacity: a real shortfall is still reported', short.unaccountedWays === 14, String(short.unaccountedWays));
  const noDeclaration = mk(null, 12).perBoard.find((b) => b.norm === 'DB1');
  check('spare capacity: a board declaring no spare is unchanged', noDeclaration.unaccountedWays === 14,
    String(noDeclaration.unaccountedWays));

  /* A fully spare board's schedule page correctly produces no rows, so it is
   * not a page to investigate. */
  check('spare capacity: a fully spare board is not a zero-row failure',
    mk(100, 0).zeroRowSchedulePages.length === 0,
    JSON.stringify(mk(100, 0).zeroRowSchedulePages));
  check('spare capacity: a genuinely empty schedule page still is',
    mk(0, 0).zeroRowSchedulePages.length === 1,
    JSON.stringify(mk(0, 0).zeroRowSchedulePages));
}

/* The header block states it; the coverage model must be able to read it. */
{
  const facts = core.parseBoardHeaderFacts([
    'Id No:  DB-6-SEC  ModelNo:  L1  L2  L3',
    'Name:  SECURITY  No. of Ways:  12  Spare:  100  Total Connected Load (A):  0.00  0.00  0.00',
  ]);
  check('spare capacity: percentage read from the board-data block', facts.sparePercent === 100, String(facts.sparePercent));
  check('spare capacity: way count still read alongside it', facts.waysTotal === 12, String(facts.waysTotal));
  const decimal = core.parseBoardHeaderFacts(['Name:  110V AC DB  No. of Ways:  26  Spare:  53.8  Total Connected Load (A):  65.95']);
  check('spare capacity: a decimal percentage is read', decimal.sparePercent === 53.8, String(decimal.sparePercent));
  const none = core.parseBoardHeaderFacts(['REFERENCE DB-1-GF NUMBER OF WAYS 18 WAYS']);
  check('spare capacity: a board that states none reports null', none.sparePercent === null, String(none.sparePercent));
}

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: expectedWaysFromText, pageLooksTabular, buildCoverage (header-vs-rows, zero-row pages, unreadable pages, no-header case)');
