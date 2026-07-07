/* Perfect-text dialect probe — separates "OCR failed" from "dialect not understood".
 *
 * Feeds hand-transcribed lines (read visually from the actual fixture pages) through
 * the app's own parseScheduleLine with a schedule context, exactly as runAnalysis
 * would. If a dialect yields 0 rows HERE, the miss is the parser, not the OCR.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('./app-pipeline.cjs');

const FIXTURES = {
  'BAM/EPO (EPO_Ashfield p2 — board DB-00-08P, the dialect the regex targets)': [
    'L1 32 P1 32A SP&N Isolator for Range Cooker* EPO 3 6 T5 31, 5',
    '13 L2 32 P1 SPARE',
    'L3 32 P1 32A SP&N Isolator for Range Cooker* EPO 1 6 T5 31, 5',
    '14 L2 32 P1 32A SP&N Isolator for Range Cooker* EPO 3 6 T5 31, 5',
    'L3 32 P1 Teachaers Wall Ring Circuits, cleaners & Fridge 4 T5 31, 5',
    'L1 20 P1 Electrical Oven - Radial* EPO 3 4 T5 31, 5',
    '15 L2 32 P1 SPARE',
    'L1 20 P1 Electrical Hob - Radial* EPO 3 4 T5 31, 5',
    '16 L2 32 P1 SPARE',
    'L3 20 P1 3no Heat maintenance tape spurs 2.5 T5 31, 5',
    'L1 B',
    '17 L2 B',
    'L3 B',
  ],
  'Syntegral (25057 p11 — board DB-MECH, 18 WAY TP&N)': [
    '1/L1 - - - - - - - - SPARE',
    '1/L2 32 C - NO 2 10.0 10.0 RAD AHU 01 - CONDENSOR - ROOF',
    '1/L3 32 C - NO 2 6.0 6.0 RAD AHU 03a - CONDENSOR - ROOF',
    '2/L1 32 C - NO 2 6.0 6.0 RAD AHU 04a - CONDENSOR - ROOF',
    '3/L2 32 C 30 NO 5 10.0 6.0 RAD PLANT ROOM - BOOSTER SET',
    '4/L2 16 C - NO 2 6.0 SWA RAD AHU 01 - ROOF',
    '8/L1 - - - - - - - - SPARE',
    '8/L2 16 C - NO 2 2.5 SWA RAD AHU 05 - ROOF',
  ],
  'Hevacomp (The Angel — board 2A4, per BUILD_BRIEF §4A)': [
    '7/L1 Spare',
    '7/L2 20 6.0 2.5 LSF Singles Fixed power Branch selectors',
    '9/L3 Spare',
    '1/L1 10 1.5 1.5 LSF Singles Lighting Bedroom lighting 1-8',
  ],
  'BES/Brenbar (Kings Road — G1-GF-DB-LL style rows)': [
    '1 L1 LIGHTING FLAT 1 RAD 6 B 30 NO',
    '2 L1 SOCKETS FLAT 1 RING 32 B 30 YES',
    '3 L2 COOKER FLAT 2 RAD 32 B 30 NO',
  ],
  'Amtech (Broomfield — per-way In/Ir/Type/RCD/AFDD/Cable/Cores/CPC)': [
    '1 Lighting Ground Floor 6 B 30 1.5 2 1.5',
    '2 Sockets Kitchen Ring 32 B 30 2.5 2 1.5',
    '3 Spare 0',
  ],
};

console.log('=== parseScheduleLine on PERFECT text (ctx.board set, as in runAnalysis) ===\n');
for (const [name, lines] of Object.entries(FIXTURES)) {
  const ctx = { board: 'TESTBOARD', sawHeader: true, inNotes: false, lastWay: null, lastPhase: null, pendingRows: [], protectionLegend: null };
  let parsed = 0;
  const misses = [];
  for (const t of lines) {
    const r = P.parseScheduleLine(t, ctx);
    if (r) parsed++;
    else misses.push(t);
  }
  P.EstimationExtractorCore.finalizeScheduleContext(ctx);
  console.log(`${name}\n  parsed ${parsed}/${lines.length} rows${misses.length ? '  — MISSED: ' + misses.slice(0, 3).map(m => JSON.stringify(m.slice(0, 45))).join(' | ') : ''}\n`);
}

console.log('=== board-reference detection on PERFECT refs ===\n');
const REFS = ['DB-00-08P', 'DB-MECH', 'DB-AV', 'DB/GF', 'G1-GF-DB-LL', 'PB01', 'MCCB PANELBOARD PB01', 'DB-01-21', '2A4', 'SB12', 'DB-ESS-01', 'DB-00-SUBEXT'];
for (const ref of REFS) {
  const app = P.detectBoards(`Board Reference: ${ref}`).map(b => b.orig);
  const core = P.EstimationExtractorCore.extractBoardReferences(`Board Reference: ${ref}`).map(b => b.original);
  console.log(`  ${ref.padEnd(22)} app detectBoards: ${app.length ? app.join(',') : '✗ MISS'}   core extractBoardReferences: ${core.length ? core.join(',') : '✗ MISS'}`);
}
