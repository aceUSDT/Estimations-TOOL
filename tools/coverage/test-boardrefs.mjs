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
  // `normalised` (not the raw matched text) is the identity the app groups
  // boards by, so that is what these cases must hold to.
  'core extractBoardReferences': (line) => P.EstimationExtractorCore.extractBoardReferences(line).map((b) => b.normalised),
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
/* Way number + phase suffix are NOT part of a board's identity.
 *
 * Observed on a real job: 344 boards against 187 devices — more boards than
 * devices, which is impossible. Every schedule row was minting its own board
 * because the row's leading way number and its -L1/-L2/-L3 phase suffix were
 * being absorbed into the reference, so one board appeared once per way and
 * again once per phase. */
const CANON = [
  // [raw reference, canonical norm, wayPrefix, phase]
  ['154-DB-7-GCS-11-L2', 'DB7GCS11', 154, 'L2'],
  ['155-DB-7-GCS-11-L3', 'DB7GCS11', 155, 'L3'],
  ['156-DB-7-GCS-12-L1', 'DB7GCS12', 156, 'L1'],
  ['DB-1-GF-5-L3', 'DB1GF5', null, 'L3'],
  // a board whose name genuinely starts with a number keeps it: a leading
  // digit alone is not evidence of a way.
  ['2A4', '2A4', null, null],
  // the -L/-LP/-P split section names a real lighting/power section and must
  // survive the new phase rule.
  ['DB-01-21-L', 'DB0121', null, null],
];
for (const [raw, wantNorm, wantWay, wantPhase] of CANON) {
  const got = P.EstimationExtractorCore.canonicalBoardReference(raw);
  if (got.normalised !== wantNorm) { console.log(`FAIL [canonical] ${raw} → ${got.normalised}, want ${wantNorm}`); fail++; }
  if ((got.wayPrefix ?? null) !== wantWay) { console.log(`FAIL [canonical] ${raw} way ${got.wayPrefix}, want ${wantWay}`); fail++; }
  if ((got.phase ?? null) !== wantPhase) { console.log(`FAIL [canonical] ${raw} phase ${got.phase}, want ${wantPhase}`); fail++; }
}
if (P.EstimationExtractorCore.canonicalBoardReference('DB-01-21-L').splitSection !== 'L') {
  console.log('FAIL [canonical] split section L was swallowed by the phase rule'); fail++;
}

/* The end-to-end invariant the screenshot violated: three phase rows of two
 * boards are TWO boards, not six. */
{
  const rows = [
    '154-DB-7-GCS-11-L1 16A MCB', '155-DB-7-GCS-11-L2 16A MCB', '156-DB-7-GCS-11-L3 16A MCB',
    '157-DB-7-GCS-12-L1 16A MCB', '158-DB-7-GCS-12-L2 16A MCB', '159-DB-7-GCS-12-L3 16A MCB',
  ];
  for (const [name, fn] of Object.entries(engines)) {
    const distinct = new Set(rows.flatMap(fn));
    if (distinct.size !== 2) {
      console.log(`FAIL [${name}] 6 phase rows of 2 boards → ${distinct.size} boards [${[...distinct]}]`); fail++;
    }
  }
}

/* The header is the authority on a schedule page.
 *
 * Shape taken from a real 8-page LV distribution board schedule (the drawing
 * itself stays out of the repo). That job reported 15 boards where the
 * document defines 7: the extras were bare prefixes of a real ref, way/phase
 * extensions of it, and one device RATING read as a board. */
{
  const { reconcilePageBoards } = P.EstimationExtractorCore;
  const header = 'DB1GF';
  const candidates = ['DB1GF', 'DB1', 'DB1GF5L2', 'DB1GF11L3', 'MEPMAINDB', 'DB630A'];
  const kept = reconcilePageBoards(header, candidates);
  const want = ['DB1GF', 'MEPMAINDB', 'DB630A'];   // rating is dropped separately, at detection
  if (JSON.stringify(kept) !== JSON.stringify(want)) {
    console.log(`FAIL [reconcile] kept ${JSON.stringify(kept)}, want ${JSON.stringify(want)}`); fail++;
  }
  // the upstream board named in "SERVED BY MEP MAIN DB" is a real board and must survive
  if (!kept.includes('MEPMAINDB')) { console.log('FAIL [reconcile] dropped the upstream feeder board'); fail++; }
  // with no header (a schematic, say) nothing is second-guessed
  if (reconcilePageBoards(null, candidates).length !== candidates.length) {
    console.log('FAIL [reconcile] filtered candidates with no header board'); fail++;
  }
  // a rating must never become a board
  for (const line of ['INCOMER SIZE 630A', 'BOARD DEVICE TYPE 125A']) {
    for (const [name, fn] of Object.entries(engines)) {
      const got = fn(line).filter((n) => /^\w*\d{2,4}A$/.test(n));
      if (got.length) { console.log(`FAIL [${name}] rating became a board ${JSON.stringify(got)} in ${JSON.stringify(line)}`); fail++; }
    }
  }
}

/* A declared board plus a trailing WAY number is a way, not a board.
 *
 * Observed live: after the header fix the job still showed 219 boards, because
 * the AI returns one board_ref per ROW, so DB-1-GF's 18 ways arrived as
 * DB-1-GF-1 … DB-1-GF-18 and each registered as its own board. */
{
  const { planWayBoardMerges } = P.EstimationExtractorCore;
  const plan = planWayBoardMerges([
    { norm: 'DB1GF', isHeader: true },
    { norm: 'DB1GF1', isHeader: false },
    { norm: 'DB1GF11', isHeader: false },
    { norm: 'DB1GF5L2', isHeader: false },
    { norm: 'DB1GFMECH', isHeader: false },   // a real, differently-named board
    { norm: 'DB2GF', isHeader: true },
  ]);
  const got = plan.map((m) => `${m.drop}->${m.keep}`).sort();
  const want = ['DB1GF11->DB1GF', 'DB1GF1->DB1GF', 'DB1GF5L2->DB1GF'];
  if (JSON.stringify(got) !== JSON.stringify(want.sort())) {
    console.log(`FAIL [way-merge] got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); fail++;
  }
  if (got.some((s) => s.startsWith('DB1GFMECH'))) {
    console.log('FAIL [way-merge] absorbed a differently-named board'); fail++;
  }
  // only a board a header DECLARED may absorb others
  if (planWayBoardMerges([{ norm: 'DB1GF', isHeader: false }, { norm: 'DB1GF5', isHeader: false }]).length) {
    console.log('FAIL [way-merge] merged into a board no page header declared'); fail++;
  }
  // longest header wins: DB-1-GF-5 belongs to DB-1-GF, not DB-1
  const nested = planWayBoardMerges([
    { norm: 'DB1', isHeader: true }, { norm: 'DB1GF', isHeader: true }, { norm: 'DB1GF5', isHeader: false },
  ]);
  if (!(nested.length === 1 && nested[0].keep === 'DB1GF')) {
    console.log(`FAIL [way-merge] nested headers: ${JSON.stringify(nested)}`); fail++;
  }
}

/* Cover-page stubs fold into the real board — but only when unambiguous. */
{
  const { planPrefixMerges } = P.EstimationExtractorCore;
  const plan = planPrefixMerges([
    { norm: 'DB1', rowCount: 0 }, { norm: 'DB1GF', rowCount: 33 },
    { norm: 'DB2', rowCount: 0 }, { norm: 'DB2GF', rowCount: 37 },
  ]);
  const got = plan.map((m) => `${m.drop}->${m.keep}`).sort().join(',');
  if (got !== 'DB1->DB1GF,DB2->DB2GF') { console.log(`FAIL [merge] got ${got}`); fail++; }

  // a stub that prefixes TWO boards is ambiguous — leave it alone
  if (planPrefixMerges([{ norm: 'DB1', rowCount: 0 }, { norm: 'DB1GF', rowCount: 5 }, { norm: 'DB1FF', rowCount: 5 }]).length) {
    console.log('FAIL [merge] merged an ambiguous stub prefixing two boards'); fail++;
  }
  // a board that owns devices is never merged away, however short its ref
  if (planPrefixMerges([{ norm: 'DB1', rowCount: 12 }, { norm: 'DB1GF', rowCount: 33 }]).length) {
    console.log('FAIL [merge] merged a board that owns devices'); fail++;
  }
  // nothing to merge into (target has no rows either) ⇒ no merge
  if (planPrefixMerges([{ norm: 'DB5', rowCount: 0 }, { norm: 'DB5EX', rowCount: 0 }]).length) {
    console.log('FAIL [merge] merged into a board with no rows'); fail++;
  }
}

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log(`PASS: ${POSITIVE.length} positives, ${NEGATIVE.length} negatives, containment — both engines.`);

/* The board's own header block, and the arithmetic that must hold. */
{
  const { parseBoardHeaderFacts, boardCapacityWarnings } = P.EstimationExtractorCore;
  const header = ['REFERENCE DB-1-GF SERVED BY MEP MAIN DB DESCRIPTION GROUND FLOOR LIGHTING & POWER '
    + 'LOCATION LVAC ROOM NUMBER OF WAYS 18 WAYS INCOMER GENERIC ISOLATOR INCOMER SIZE 125A'];
  const f = parseBoardHeaderFacts(header);
  const expect = { waysTotal: 18, servedBy: 'MEP MAIN DB', location: 'LVAC ROOM', incomerRatingA: 125 };
  for (const [k, v] of Object.entries(expect)) {
    if (f[k] !== v) { console.log(`FAIL [header] ${k} = ${JSON.stringify(f[k])}, want ${JSON.stringify(v)}`); fail++; }
  }
  // "SERVED BY" must stop at the next label, not swallow the rest of the header
  if (/DESCRIPTION/i.test(String(f.servedBy))) { console.log('FAIL [header] servedBy ran into the next field'); fail++; }

  /* An 18-way three-phase board holds at most 54. This is the check that
     should have caught 86 devices on one board without a human noticing. */
  const warn = boardCapacityWarnings([
    { norm: 'DB1GF', waysTotal: 18, phases: 3, deviceCount: 86 },
    { norm: 'DB2GF', waysTotal: 24, phases: 3, deviceCount: 37 },
    { norm: 'DBSP', waysTotal: 12, phases: 1, deviceCount: 13 },
    { norm: 'DBUNKNOWN', waysTotal: null, phases: 3, deviceCount: 999 },
  ]);
  const flagged = warn.map((w) => w.norm).sort();
  if (JSON.stringify(flagged) !== JSON.stringify(['DB1GF', 'DBSP'])) {
    console.log(`FAIL [capacity] flagged ${JSON.stringify(flagged)}, want ["DB1GF","DBSP"]`); fail++;
  }
  const one = warn.find((w) => w.norm === 'DB1GF');
  if (!one || one.capacity !== 54) { console.log('FAIL [capacity] wrong capacity for 18-way TPN'); fail++; }
  // silence must mean "not checkable", never "verified"
  if (warn.some((w) => w.norm === 'DBUNKNOWN')) { console.log('FAIL [capacity] guessed at a board with no declared ways'); fail++; }
}

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: board header facts + capacity arithmetic.');
