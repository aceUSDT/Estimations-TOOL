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
check('missing protection fields are surfaced', mech.incompleteProtectionRows === 8, `got ${mech.incompleteProtectionRows}`);
check('board protection gap is summarized', cov.summary.boardsWithProtectionGaps === 1, `got ${cov.summary.boardsWithProtectionGaps}`);

const spatialHeaderCoverage = core.buildCoverage({
  boards: { DB2: { norm: 'DB2', orig: 'DB-2', pages: [{ fileId: 'f-spatial', page: 1, primary: true }],
    header: { ways_total: 12 }, headerEvidence: { ways_total: { text: '12', confidence: 0.98, extractionMethod: 'Spatial board header parser' } } } },
  rows: [{ boardNorm: 'DB2', way: 1, page: 1, fileId: 'f-spatial', kind: 'schedule', device: 'MCB', rating: 50 }],
  pages: [{ fileId: 'f-spatial', page: 1,
    text: 'No. of Ways 125 Device Rating 125A\nWay Phase Overcurrent Protective Device', type: 'db-schedule' }],
});
check('trusted spatial way count overrides ambiguous text adjacency', spatialHeaderCoverage.perBoard[0].expectedWays === 12,
  `got ${spatialHeaderCoverage.perBoard[0].expectedWays}`);

const trimbleHeader = core.extractBoardHeader([
  'No. of Ways: 12 Spare: 50',
  'Board Rating (A): 125',
]);
check('compact Trimble spare percentage is extracted', trimbleHeader.header.spare_capacity_pct === 50,
  `got ${trimbleHeader.header.spare_capacity_pct}`);

const declaredSpareCoverage = core.buildCoverage({
  boards: { DB2: { norm: 'DB2', orig: 'DB-2', pages: [{ fileId: 'f-spare', page: 1, primary: true }],
    header: { ways_total: 12, spare_capacity_pct: 50 },
    headerEvidence: {
      ways_total: { text: '12', confidence: 0.98, extractionMethod: 'Spatial board header parser' },
      spare_capacity_pct: { text: '50', confidence: 0.98, extractionMethod: 'Spatial board header parser' },
    } } },
  rows: Array.from({ length: 6 }, (_, index) => ({ boardNorm: 'DB2', way: index + 1, page: 1,
    fileId: 'f-spare', kind: 'schedule', device: 'MCB', rating: 20 })),
  pages: [{ fileId: 'f-spare', page: 1,
    text: 'No. of Ways: 12 Spare: 50\nWay Phase Overcurrent Protective Device\n1 L1 MCB 20A', type: 'db-schedule' }],
});
check('trusted declared spare capacity accounts for unprinted ways', declaredSpareCoverage.perBoard[0].capturedWays === 12,
  JSON.stringify(declaredSpareCoverage.perBoard[0]));
check('declared spare reconciliation preserves observed-way count', declaredSpareCoverage.perBoard[0].observedWays === 6);
check('declared spare reconciliation records six unprinted spare ways', declaredSpareCoverage.perBoard[0].declaredUnprintedSpareWays === 6);
check('declared spare reconciliation closes the coverage gap', declaredSpareCoverage.perBoard[0].unaccountedWays === 0);

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

const protectionCoverage = core.buildCoverage({
  boards: { DBC: { norm: 'DBC', orig: 'DB-C', pages: [{ fileId: 'f5', page: 1, primary: true }] } },
  rows: [
    { boardNorm: 'DBC', way: 1, page: 1, fileId: 'f5', kind: 'schedule', device: 'MCB', rating: 16 },
    { boardNorm: 'DBC', way: 2, page: 1, fileId: 'f5', kind: 'schedule', device: 'MCB', rating: null },
    { boardNorm: 'DBC', way: 3, page: 1, fileId: 'f5', kind: 'schedule', spare: true, device: null, rating: null },
  ],
  pages: [{ fileId: 'f5', page: 1, text: 'DB REFERENCE DB-C\n3 Way\n1 16A MCB\n2 MCB\n3 Spare', type: 'db-schedule' }],
});
check('spares do not count as incomplete protection rows', protectionCoverage.perBoard[0].incompleteProtectionRows === 1);
check('protection row count excludes spare ways', protectionCoverage.perBoard[0].protectionRows === 2);

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: expectedWaysFromText, pageLooksTabular, buildCoverage (header-vs-rows, zero-row pages, no-header case)');
