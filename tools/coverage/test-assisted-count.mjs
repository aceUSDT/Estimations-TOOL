/* Regression test: the assisted take-off helpers and per-board aggregation in
 * extractor-core.js — assistedSeedFromText / matchAssistedRows (the "click a
 * line, count every matching way on this board" action), aggregateDevices (the
 * deterministic per-board totals), and toThreeType (the three-class page
 * taxonomy the UI and pipeline speak in).
 *
 * Counting is code, never a model: these pin what is and is not counted.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('./load-extractor-core.cjs');

let fail = 0;
const check = (name, cond, detail) => {
  if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; }
};

/* ---------- normaliseAssistedDevice -------------------------------------- */
check('device: combined AFDD/RCBO collapses to one class', core.normaliseAssistedDevice('AFDD + RCBO') === 'AFDD+RCBO');
check('device: RCBO recognised', core.normaliseAssistedDevice('  rcbo ') === 'RCBO');
check('device: MCCB is not read as MCB', core.normaliseAssistedDevice('MCCB') === 'MCCB');
check('device: RCD recognised', core.normaliseAssistedDevice('30mA RCD') === 'RCD');
check('device: HRC fuse recognised', core.normaliseAssistedDevice('HRC fuse') === 'FUSE');
check('device: unknown text is normalised, not dropped', core.normaliseAssistedDevice('switch  disconnector') === 'SWITCH DISCONNECTOR');
check('device: empty input has no device', core.normaliseAssistedDevice('  ') === null && core.normaliseAssistedDevice(null) === null);

/* ---------- assistedSeedFromText ----------------------------------------- */
let seed = core.assistedSeedFromText('WAY 4  32A RCBO  Ring final circuit');
check('seed: rating before the device', seed && seed.device === 'RCBO' && seed.rating === 32 && seed.label === '32A RCBO', JSON.stringify(seed));
seed = core.assistedSeedFromText('MCB rated 6 A lighting circuit');
check('seed: rating after the device', seed && seed.device === 'MCB' && seed.rating === 6);
seed = core.assistedSeedFromText('AFDD + RCBO 20A bedroom sockets');
check('seed: combined device keeps its rating', seed && seed.device === 'AFDD+RCBO' && seed.rating === 20, JSON.stringify(seed));
seed = core.assistedSeedFromText('  16A   RCBO\n socket   circuit ');
check('seed: source text is whitespace-normalised for display', seed && seed.source === '16A RCBO socket circuit');
seed = core.assistedSeedFromText('', { srcText: 'WAY 7 40A MCB', device: 'MCB', rating: 40 });
check('seed: an existing row seeds without re-parsing', seed && seed.rating === 40 && seed.device === 'MCB');
check('seed: a rating with no device is not a seed', core.assistedSeedFromText('WAY 9 32A spare') === null);
check('seed: a device with no rating is not a seed', core.assistedSeedFromText('Provide RCBOs throughout') === null);
check('seed: empty input is not a seed', core.assistedSeedFromText('') === null);

/* ---------- matchAssistedRows -------------------------------------------- */
const rows = [
  { id: 'r1', boardNorm: 'DB1', fileId: 'f1', device: 'RCBO', rating: 32, qty: 1, status: 'pending' },
  { id: 'r2', boardNorm: 'DB1', fileId: 'f1', device: 'rcbo', rating: '32', qty: 2, status: 'confirmed' },
  { id: 'r3', boardNorm: 'DB1', fileId: 'f1', device: 'RCBO', rating: 16, qty: 1, status: 'pending' },
  { id: 'r4', boardNorm: 'DB2', fileId: 'f1', device: 'RCBO', rating: 32, qty: 5, status: 'pending' },
  { id: 'r5', boardNorm: 'DB1', fileId: 'f2', device: 'RCBO', rating: 32, qty: 5, status: 'pending' },
  { id: 'r6', boardNorm: 'DB1', fileId: 'f1', device: 'RCBO', rating: 32, qty: 1, status: 'rejected' },
  { id: 'r7', boardNorm: 'DB1', fileId: 'f1', device: 'RCBO', rating: 32, qty: 1, status: 'pending', space: true },
];
const target = { device: 'RCBO', rating: 32 };
let matched = core.matchAssistedRows(rows, target, { boardNorm: 'DB1', fileId: 'f1' });
check('match: only this board and document are counted',
  matched.rows.map((row) => row.id).join(',') === 'r1,r2', matched.rows.map((row) => row.id).join(','));
check('match: quantities are summed, not row counted', matched.quantity === 3);
check('match: rejected rows and blank ways are never counted', !matched.rows.some((row) => row.id === 'r6' || row.id === 'r7'));

matched = core.matchAssistedRows(rows, target, { boardNorm: 'DB1' });
check('match: without a document filter every board-1 match counts', matched.quantity === 8, String(matched.quantity));
matched = core.matchAssistedRows(rows, { device: 'MCB', rating: 32 }, { boardNorm: 'DB1' });
check('match: a different device class matches nothing', matched.rows.length === 0 && matched.quantity === 0);
matched = core.matchAssistedRows(rows, null);
check('match: no seed means no count', matched.rows.length === 0 && matched.quantity === 0);
matched = core.matchAssistedRows(null, target, { boardNorm: 'DB1' });
check('match: an unanalysed project counts nothing', matched.quantity === 0);
matched = core.matchAssistedRows(rows, { device: 'RCBO', rating: 32, boardNorm: 'DB2', fileId: 'f1' });
check('match: the seed can carry its own board/file scope', matched.quantity === 5);

/* ---------- aggregateDevices --------------------------------------------- */
const totals = core.aggregateDevices([
  { device: 'MCB', rating: 6, curve: 'B', poles: 1, qty: 2, way: 1, phase: 'L1', srcText: 'WAY 1 6A MCB' },
  { device: 'MCB', rating: 6, curve: 'B', poles: 1, qty: 3, way: 2, phase: 'L2', srcText: 'WAY 2 6A MCB' },
  { device: 'MCB', rating: 6, curve: 'C', poles: 1, qty: 1, way: 3, srcText: 'WAY 3 6A MCB type C' },
  { device: 'RCBO', rating: 32, poles: 1, sens: 30, rcdType: 'A', qty: 1, way: 4, srcText: 'WAY 4 32A RCBO' },
  { device: 'MCB', rating: 6, curve: 'B', poles: 1, qty: 1, way: 5, space: true, srcText: 'WAY 5' },
  { device: 'MCB', rating: 6, curve: 'B', poles: 1, qty: 0, way: 6, srcText: 'WAY 6' },
  { device: '', rating: 10, qty: 1, way: 7, srcText: 'WAY 7 spare' },
  null,
]);
const mcbB = totals.find((item) => item.device === 'MCB' && item.curve === 'B');
const mcbC = totals.find((item) => item.device === 'MCB' && item.curve === 'C');
const rcbo = totals.find((item) => item.device === 'RCBO');
check('aggregate: identical specifications merge', Boolean(mcbB) && mcbB.quantity === 5);
check('aggregate: a different curve is a different line', Boolean(mcbC) && mcbC.quantity === 1);
check('aggregate: RCD detail is kept on the line', rcbo.sensitivityMa === 30 && rcbo.rcdType === 'A' && rcbo.quantity === 1);
check('aggregate: blank ways, zero quantities and deviceless rows are excluded', totals.length === 3, JSON.stringify(totals.map((t) => t.device + (t.curve || ''))));
check('aggregate: every counted way keeps its evidence',
  mcbB.evidence.length === 2 && mcbB.evidence[0].way === 1 && mcbB.evidence[0].phase === 'L1' && mcbB.evidence[1].source === 'WAY 2 6A MCB');
check('aggregate: no rows → no totals', core.aggregateDevices().length === 0);

/* ---------- toThreeType --------------------------------------------------- */
check('taxonomy: single-line diagrams are schematics', core.toThreeType('sld') === 'schematic' && core.toThreeType('schematic') === 'schematic');
check('taxonomy: every schedule dialect is a DB schedule',
  ['db-schedule', 'main-schedule', 'cable-schedule', 'equipment-schedule', 'cu', 'switchboard', 'mccb']
    .every((type) => core.toThreeType(type) === 'db_schedule'));
check('taxonomy: specifications', core.toThreeType('spec') === 'specification');
check('taxonomy: an already-collapsed value is stable', core.toThreeType('db_schedule') === 'db_schedule');
check('taxonomy: case is ignored', core.toThreeType('DB-Schedule') === 'db_schedule');
check('taxonomy: plans and registers carry no take-off',
  ['lighting-plan', 'register', 'legend', 'notes', 'cover', 'unknown'].every((type) => core.toThreeType(type) === 'other'));
check('taxonomy: a missing type is other', core.toThreeType(null) === 'other' && core.toThreeType('') === 'other');
check('taxonomy: the three classes have labels',
  core.THREE_TYPES.schematic === 'Schematic' && core.THREE_TYPES.db_schedule === 'Distribution Board Schedule' && core.THREE_TYPES.specification === 'Specification');

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: assisted counting, device aggregation, and three-type classification.');
