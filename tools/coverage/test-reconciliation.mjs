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
check('no false positive on M25 WAYFINDING', core.expectedWaysFromText('the motorway junction') === null);
check('rejects way 1', core.expectedWaysFromText('WAY 1') === null); // 1 < min 2 threshold

/* pageLooksTabular */
check('phase-slot rows tabular', core.pageLooksTabular('1/L1 - SPARE\n1/L2 32 C\n1/L3 32 C\n2/L1 32 C\n2/L2 16 B'));
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

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: expectedWaysFromText, pageLooksTabular, buildCoverage (header-vs-rows, zero-row pages, no-header case)');
