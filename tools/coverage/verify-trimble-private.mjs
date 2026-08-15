import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Usage: node tools/coverage/verify-trimble-private.mjs <private-page-json>');

await import('../../extractor-core.js');
await import('../../spatial-schedule-core.js');

const Core = globalThis.EstimationExtractorCore;
const pages = JSON.parse(await readFile(sourcePath, 'utf8'));
const parseStarted = performance.now();
const parsed = Core.parseSpatialScheduleDocument(pages, { maxSchemaCandidates: 4 });
const parseElapsedMs = performance.now() - parseStarted;
const results = parsed.pages.map((entry) => entry.result);
const boardRecords = [...new Map(results.filter((result) => result.board).map((result) => [result.board.ref, result.board])).values()];
const rows = results.flatMap((result) => (result.rows || []).map((row) => Core.reconcileCombinedProtection(row)))
  .filter((row) => row.device && row.qty > 0 && !row.spare && !row.space);
const countBy = (selector) => rows.reduce((counts, row) => {
  const key = selector(row);
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});

assert.equal(results.length, 55);
assert.equal(results.filter((result) => result.matched).length, 55);
assert.equal(new Set(results.map((result) => result.board?.ref).filter(Boolean)).size, 7);
assert.deepEqual(boardRecords.reduce((counts, board) => {
  const key = board.classification.family;
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {}), { switchboard: 1, distribution_board: 6 });
assert.deepEqual(boardRecords.reduce((counts, board) => {
  const key = String(board.header.board_rating_a);
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {}), { 100: 5, 160: 1, 400: 1 });
assert.ok(boardRecords.every((board) => board.header.ze_ohm > 0 && board.header.incomer_rating_a > 0));
assert.equal(rows.length, 246);
assert.deepEqual(countBy((row) => row.device), { MCCB: 17, MCB: 200, RCBO: 29 });
assert.deepEqual(countBy((row) => row.poleConfiguration), { TP: 34, SP: 212 });
assert.deepEqual(countBy((row) => String(row.ka)), { 10: 168, 15: 61, 18: 2, 25: 15 });
assert.deepEqual(countBy((row) => row.rcdArrangement || 'none'), { none: 208, integral: 29, separate: 9 });
assert.equal(rows.filter((row) => row.rcdProtected && row.sens === 30).length, 38);
assert.equal(rows.filter((row) => !row.boardRef).length, 0);
assert.equal(rows.filter((row) => row.classConflict).length, 0);
assert.equal(rows.filter((row) => row.poleConflict).length, 2);
assert.equal(rows.filter((row) => row.afdd || row.arcFlashDevice).length, 0);
assert.ok(parseElapsedMs < 5000, `private replay exceeded the 5s deterministic parse budget (${Math.round(parseElapsedMs)}ms)`);

console.log(`PASS: private 55-page replay matched the audited 7-board / 246-device acceptance contract in ${Math.round(parseElapsedMs)}ms; two authored phase/pole contradictions remain reviewable.`);
