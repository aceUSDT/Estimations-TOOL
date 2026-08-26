import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [cablePath, stackedPath] = process.argv.slice(2);
if (!cablePath || !stackedPath) {
  throw new Error('Usage: node tools/coverage/verify-db-schedule-manual-private.mjs <cable-page-json> <stacked-page-json>');
}

await import('../../extractor-core.js');
await import('../../spatial-schedule-core.js');

const Core = globalThis.EstimationExtractorCore;
const parseDocument = async (sourcePath) => {
  const pages = JSON.parse(await readFile(sourcePath, 'utf8'));
  return Core.parseSpatialScheduleDocument(pages, { maxSchemaCandidates: 4 }).pages[0].result;
};

const started = performance.now();
const cable = await parseDocument(cablePath);
const stacked = await parseDocument(stackedPath);
const elapsedMs = performance.now() - started;

assert.equal(cable.matched, true);
assert.equal(cable.dialect, 'trimble_cable_schedule');
assert.equal(cable.board.ref, 'FF-L&P-3');
assert.equal(cable.board.header.phase_config, 'TPN');
assert.equal(cable.board.header.ways_observed, 2);
assert.deepEqual(cable.rows.map((row) => [row.way, row.phase, row.device, row.rating]), [
  ['L1', 'L1', 'MCB', 10],
  ['L1', 'L2', 'MCB', 10],
  ['L1', 'L3', 'MCB', 10],
  ['L2', 'L1', 'MCB', 10],
  ['L2', 'L2', 'MCB', 10],
]);
assert.ok(cable.rows.every((row) => row.rcdProtected === false && row.afdd === false));
assert.ok(cable.rows.every((row) => row.curve == null && row.requiresReview));
assert.deepEqual(cable.references.filter((reference) => reference.role === 'primary_board').map((reference) => reference.original), ['FF-L&P-3']);
assert.ok(cable.references.filter((reference) => reference.role === 'circuit_reference').some((reference) => reference.original === 'GF-05'));

assert.equal(stacked.matched, true);
assert.equal(stacked.dialect, 'trimble_stacked_protection');
assert.equal(stacked.board.ref, 'DB-2');
assert.equal(stacked.board.header.description, 'Power TPN');
assert.equal(stacked.board.header.board_model, 'Schneider');
assert.equal(stacked.board.header.ways_total, 12);
assert.equal(stacked.board.header.board_rating_a, 125);
assert.equal(stacked.board.header.fault_ka, 25);
assert.equal(stacked.board.header.incomer_class, 'Isolating Switch');
assert.equal(stacked.board.header.incomer_rating_a, 125);
assert.deepEqual(stacked.rows.map((row) => [row.way, row.phase, row.device, row.rating, row.curve]), [
  [1, 'L1', 'MCB', 50, 'C'],
  [1, 'L2', 'MCB', 50, 'C'],
  [1, 'L3', 'MCB', 50, 'C'],
  [2, 'L1', 'MCB', 50, 'C'],
]);
assert.ok(stacked.rows.every((row) => row.rcdProtected === false && row.afdd === false && !row.requiresReview));
assert.ok(elapsedMs < 5000, `manual private replay exceeded the 5s deterministic parse budget (${Math.round(elapsedMs)}ms)`);

console.log(`PASS: both private manual schedules met their audited board, row, protection, and review-state contracts in ${Math.round(elapsedMs)}ms.`);
