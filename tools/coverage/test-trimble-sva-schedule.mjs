import assert from 'node:assert/strict';

await import('../../extractor-core.js');
await import('../../spatial-schedule-core.js');
const Core = globalThis.EstimationExtractorCore;
const { createTrimbleSvaSyntheticDocument } = await import('./fixtures/trimble-sva-synthetic.mjs');
const { createTrimbleCableScheduleSyntheticPage } = await import('./fixtures/trimble-cable-schedule-synthetic.mjs');

const pages = createTrimbleSvaSyntheticDocument();
const parseStarted = performance.now();
const parsed = Core.parseSpatialScheduleDocument(pages, { maxSchemaCandidates: 4 });
const parseElapsedMs = performance.now() - parseStarted;
const results = parsed.pages.map((entry) => entry.result);
const activeRows = results.flatMap((result) => (result.rows || []).map((row) => Core.reconcileCombinedProtection(row)))
  .filter((row) => row.device && row.qty > 0 && !row.spare && !row.space);
const boards = new Set(results.map((result) => result.board?.ref).filter(Boolean));
const boardRecords = [...new Map(results.filter((result) => result.board).map((result) => [result.board.ref, result.board])).values()];
const countItems = (items, selector) => items.reduce((counts, item) => {
  const key = selector(item);
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});

assert.equal(results.length, 55, 'all schedule pages must be evaluated');
assert.ok(results.every((result) => result.matched), 'all healthy Trimble pages must prove their grid');
assert.ok(results.every((result) => result.schema?.dialect === 'trimble_stacked_protection'));
assert.equal(boards.size, 7, 'all Board Data / Id No identities must be bound');
assert.deepEqual(countItems(boardRecords, (board) => board.classification.family), { switchboard: 1, distribution_board: 6 });
assert.ok(boardRecords.every((board) => board.header.description === 'Power TPN'));
assert.ok(boardRecords.every((board) => board.header.board_model === 'Schneider'));
assert.equal(activeRows.length, 246, 'every printed active row group must be captured exactly once');
assert.ok(activeRows.every((row) => row.boardRef), 'no active row may be boardless');

const countBy = (key) => activeRows.reduce((counts, row) => {
  const value = typeof key === 'function' ? key(row) : row[key];
  counts[value] = (counts[value] || 0) + 1;
  return counts;
}, {});

assert.deepEqual(countBy('device'), { MCCB: 17, MCB: 200, RCBO: 29 });
assert.deepEqual(countBy((row) => row.poleConfiguration === 'TP' ? 'TP' : 'SP'), { TP: 34, SP: 212 });
assert.deepEqual(countBy('ka'), { 10: 168, 15: 61, 18: 2, 25: 15 });
assert.equal(activeRows.filter((row) => row.separateRcd?.device === 'RCD').length, 9);
assert.equal(activeRows.filter((row) => row.rcdArrangement === 'integral').length, 29);
assert.ok(activeRows.filter((row) => row.rcdProtected).every((row) => row.sens === 30));
assert.ok(activeRows.every((row) => row.arcFlashDevice == null && row.afdd !== true));
assert.ok(activeRows.every((row) => row.fieldSources?.device?.bbox && row.fieldSources?.rating?.bbox));
assert.ok(parseElapsedMs < 5000, `55-page deterministic parse exceeded the 5s release budget (${Math.round(parseElapsedMs)}ms)`);

const corrupted = structuredClone(pages[0]);
corrupted.documentPage = 1;
corrupted.page = 1;
corrupted.words = corrupted.words.filter((item) => {
  const [x, y] = item.bbox;
  return !(x >= 80 && x < 230 && y >= 158 && y <= 174);
});
const healthy = structuredClone(pages[1]);
healthy.documentPage = 2;
healthy.page = 2;
const failClosed = Core.parseSpatialScheduleDocument([corrupted, healthy]);
assert.equal(failClosed.pages[0].result.matched, false, 'an active schedule page without board identity must fail closed');
assert.equal(failClosed.pages[0].schemaSourcePage, null, 'a healthy neighbour must not hide a missing board identity');
assert.ok(failClosed.pages[0].result.warnings.includes('primary_board_not_resolved'));

const conflictPage = structuredClone(pages.find((page) => page.words.some((item) => /Hager, MCB/.test(item.text))));
const conflictingDescriptor = conflictPage.words.find((item) => /Hager, MCB/.test(item.text));
conflictingDescriptor.text = conflictingDescriptor.text.replace('BS EN60898', 'BS EN61009');
const conflict = Core.parseSpatialSchedulePage(conflictPage);
const conflictingRow = conflict.rows.find((row) => row.classConflict);
assert.equal(conflictingRow?.device, 'MCB', 'explicit source class remains visible when the standard conflicts');
assert.equal(conflictingRow?.requiresReview, true);
assert.match(conflictingRow?.classConflict?.reason || '', /conflict/i);

const cableSchedule = Core.parseSpatialSchedulePage(createTrimbleCableScheduleSyntheticPage());
assert.equal(cableSchedule.matched, true, 'the cable-schedule dialect must prove its own bounded grid');
assert.equal(cableSchedule.schema.dialect, 'trimble_cable_schedule');
assert.equal(cableSchedule.board.ref, 'FF-L&P-3');
assert.equal(cableSchedule.board.classification.family, 'distribution_board');
assert.equal(cableSchedule.board.header.phase_config, 'TPN');
assert.equal(cableSchedule.board.header.ways_observed, 3);
assert.deepEqual(cableSchedule.rows.map((row) => [row.way, row.phase, row.device, row.rating, row.poles]), [
  ['L1', 'L1', 'MCB', 10, 1],
  ['L1', 'L2', 'MCB', 10, 1],
  ['L1', 'L3', 'MCB', 10, 1],
  ['L2', 'L1', 'MCB', 10, 1],
  ['L2', 'L2', 'MCB', 10, 1],
  ['P1', '3PH', 'MCB', 32, 3],
]);
assert.ok(cableSchedule.rows.every((row) => row.boardRef === 'FF-L&P-3'));
assert.ok(cableSchedule.rows.every((row) => row.rcdProtected === false && row.afdd === false));
assert.ok(cableSchedule.rows.every((row) => row.curve == null && row.requiresReview),
  'an unprinted curve must remain reviewable when the cable schedule has no board-rating evidence');
assert.ok(cableSchedule.references.some((reference) => reference.role === 'primary_board' && reference.original === 'FF-L&P-3'));
assert.ok(cableSchedule.references.filter((reference) => reference.role === 'circuit_reference').length >= 6);
assert.equal(cableSchedule.references.filter((reference) => reference.role === 'primary_board').length, 1,
  'connected-to circuit references must not be promoted to schedule boards');

console.log('PASS: Trimble/SVA stacked and cable schedules bind hierarchical boards, rows, protection records, phases, units, and fail-closed conflicts.');
