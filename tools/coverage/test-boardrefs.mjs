/* Regression test: board-reference detection (WS0.2).
 * Positive refs come from BUILD_BRIEF §3/§7 and the real fixtures; negatives are
 * prose that must NOT become boards. Exits non-zero on any failure.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('./app-pipeline.cjs');

const norm = (s) => String(s).toUpperCase().replace(/[\s.\-_/]+/g, '');

const POSITIVE = [
  // [input line, expected norm ref]
  ['Board Reference: DB-MECH', 'DBMECH'],
  ['Board Reference: DB-AV', 'DBAV'],
  ['Reference : DB-00-08P Food Room', 'DB0008P'],
  ['Sub-main to DB/GF in riser 2', 'DBGF'],
  ['DB Reference G1-GF-DB-LL', 'G1GFDBLL'],
  ['MCCB PANELBOARD PB01 FORM 4 TYPE 6', 'PB01'],
  ['fed from MSB1 via 4C 95mm²', 'MSB1'],
  ['Served by SB12', 'SB12'],
  ['Reference 2A4', '2A4'],
  ['outgoing to DB-ESS-01 life safety', 'DBESS01'],
  ['feeder to DB-00-SUBEXT external', 'DB00SUBEXT'],
  ['DB-01-21 First Floor Power', 'DB0121'],
  ['Consumer Unit (General Apartment) 8 ways', 'CUGENERALAPARTMENT'],
  ['Consumer Unit (Cluster Bedroom)', 'CUCLUSTERBEDROOM'],
  ['SMDB-01 sub-main board', 'SMDB01'],
  ['DB/L/M lighting & mechanical', 'DBLM'],
];
const NEGATIVE = [
  'DISTRIBUTION BOARD SCHEDULE',
  'DB Schedule for project 5321',
  'DB Fed From',
  'Incoming Cable Reference : F28',
  'Drawing Reference: 847-RME-XX',
  'DB Rating 250A',
];
// the longer ref must win over its own sub-match
const CONTAINMENT = [['feeder to DB-00-SUBEXT external', 'DB00']];

let fail = 0;
const engines = {
  'app detectBoards': (line) => P.detectBoards(line).map((b) => b.norm),
  'core extractBoardReferences': (line) => P.EstimationExtractorCore.extractBoardReferences(line).map((b) => norm(b.original)),
};
for (const [name, fn] of Object.entries(engines)) {
  for (const [line, want] of POSITIVE) {
    const got = fn(line);
    if (!got.includes(want)) { console.log(`FAIL [${name}] missing ${want} in ${JSON.stringify(line)} — got [${got}]`); fail++; }
  }
  for (const line of NEGATIVE) {
    const got = fn(line);
    if (got.length) { console.log(`FAIL [${name}] false positive [${got}] in ${JSON.stringify(line)}`); fail++; }
  }
  for (const [line, mustNot] of CONTAINMENT) {
    const got = fn(line);
    if (got.includes(mustNot)) { console.log(`FAIL [${name}] kept sub-match ${mustNot} in ${JSON.stringify(line)} — got [${got}]`); fail++; }
  }
}
if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log(`PASS: ${POSITIVE.length} positives, ${NEGATIVE.length} negatives, containment — both engines.`);
