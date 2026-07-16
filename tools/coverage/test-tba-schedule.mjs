import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

await import('../../extractor-core.js');
const Core = globalThis.EstimationExtractorCore;
const require = createRequire(import.meta.url);
const Pipeline = require('./app-pipeline.cjs');

const canonical = Core.canonicalBoardReference('DB/F/01/LP');
assert.equal(canonical.display, 'DB-F-01');
assert.equal(canonical.normalised, 'DBF01');
assert.equal(canonical.splitSection, 'LP');

const lines = [
  'JOB NO: 100 DB REFERENCE DB-X-01-P',
  'L1 10 K C 10 Ra L Lighting classroom C 3 1.5 1.5 Z N N/A N',
  '1 L2 20 M C 30 10 Ri P Socket circuit C 3 2.5 2.5 Z N N/A N',
  'L3 6 K C 10 Ra L Contactor control circuit C 3 1.5 1.5 Z N N/A N',
  'L1',
  '2 L2 32 K C 10 Ra P Extract canopy C 5 6.0 6.0 Z N N/A N',
  'L3',
  '20 M C 30 10 Ri P Detached circuit C 3 4.0 4.0 Z N N/A N',
  'L1',
  '3 L2 Spare',
  'L3 Spare',
  'L1',
  '4 L2',
  'L3',
  'J MCCB K MCB L FUSE M RCBO N RCBO Combined with AFFD',
];

const classification = Core.classifyPageText(lines.join('\n'));
assert.equal(classification.type, 'db-schedule');

const parsed = Core.parseTbaSchedulePage(lines);
assert.equal(parsed.matched, true);
assert.equal(parsed.codedCount, 5);
assert.equal(parsed.detachedCount, 1);
assert.equal(parsed.rows.filter((row) => row.device && row.poles === 3).length, 1);
assert.equal(parsed.rows.find((row) => row.rating === 6).associatedDevices[0].device, 'Contactor');
assert.equal(parsed.rows.find((row) => row.rating === 32).phase, '3PH');
assert.equal(parsed.rows.find((row) => row.way === 4).space, true);

const afdd = Core.parseTbaProtectionLine('L1 16 N C 30 10 Ra P AFDD socket C 3 2.5 2.5 Z N N/A Y');
assert.equal(afdd.device, 'AFDD+RCBO');
assert.equal(afdd.afdd, true);

const singlePhase = Core.parseTbaSchedulePage([
  '1 L2 10 K C 10 Ra L Lighting C 3 1.5 1.5 Z N N/A N',
  '2 L2 16 K C 10 Ra P Comms socket C 3 2.5 2.5 Z N N/A N',
  '3 L2 Spare',
]);
assert.deepEqual(singlePhase.rows.map((row) => row.way), [1, 2, 3]);
assert.equal(singlePhase.rows[2].spare, true);

const continuation = [
  'L1 10 K C 10 Ra L Lighting store C 3 1.5 1.5 Z N N/A N',
  '4 L2 10 K C 10 Ra L Lighting office C 3 1.5 1.5 Z N N/A N',
  'L3 10 K C 10 Ra L Lighting corridor C 3 1.5 1.5 Z N N/A N',
];
const analysis = Pipeline.analyseDocument([
  { page: 1, type: 'db-schedule', lines },
  { page: 2, type: 'db-schedule', lines: ['DB-FEEDER-01 downstream reference', ...continuation] },
]);
const active = analysis.rows.filter((row) => row.device);
assert.equal(active.length, 8);
assert.ok(active.every((row) => row.boardNorm === 'DBX01'));
assert.equal(analysis.boards.DBX01.orig, 'DB-X-01');

console.log('TBA coded-schedule regression tests passed.');
