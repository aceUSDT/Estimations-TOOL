import assert from 'node:assert/strict';

await import('../../extractor-core.js');
await import('../../spatial-schedule-core.js');
const Core = globalThis.EstimationExtractorCore;

const word = (text, x, y, width = Math.max(9, String(text).length * 5), height = 10) => ({
  text,
  bbox: [x, y, width, height],
  confidence: 0.99,
});

const notes = Core.parseGoverningNotes([
  { text: '(#5) Circuit wired via contactors to mushroom push button emergency stop key reset buttons within kitchen', bbox: [12, 18, 420, 12] },
  { text: 'Servery Counter (28) (#5)' },
]);
assert.equal(notes.length, 1);
assert.equal(notes[0].label, '5');
const governed = Core.applyGoverningNotes({ desc: 'Servery Counter (28) (#5)', associatedDevices: [] }, notes);
assert.deepEqual(governed.noteReferences, ['5']);
assert.equal(governed.governingNotes[0].label, '5');
assert.deepEqual(governed.associatedDevices.map((item) => item.device), ['Contactor', 'Emergency power off', 'Key reset']);
assert.ok(!governed.noteReferences.includes('28'), 'ordinary equipment tags must not become note references');

const splitWayWords = [
  word('Way', 10, 28), word('Phase', 65, 28), word('Device BS (EN)', 115, 28),
  word('Type', 200, 28), word('Rating (A)', 245, 28), word('Circuit Description', 320, 28),
];
['L7', 'L8', 'P1', 'P2'].forEach((way, index) => {
  const y = 80 + index * 34;
  splitWayWords.push(word(way, 12, y), word('L1', 68, y), word('60898', 120, y), word('C', 203, y), word(String(10 + index * 6), 250, y), word(`Circuit ${way}`, 322, y, 80));
});
const splitWay = Core.parseSpatialSchedulePage({
  lines: [
    { text: 'DISTRIBUTION BOARD SCHEDULE' },
    { text: 'Board Reference: DB-SPLIT-PL' },
    { text: 'Way - 2+2' },
    { text: 'Internal Isolator Details: 125A' },
  ],
  words: splitWayWords,
  pageWidth: 460,
  pageHeight: 270,
  pageType: 'db-schedule',
});
assert.equal(splitWay.matched, true);
assert.deepEqual(splitWay.rows.map((row) => row.way), ['L7', 'L8', 'P1', 'P2']);
assert.equal(splitWay.board.header.ways_total, 4);

const phaseSpan = Core.parseSpatialSchedulePage({
  lines: [
    { text: 'DISTRIBUTION BOARD SCHEDULE' },
    { text: 'Board Reference: DB-PHASE-SPAN' },
    { text: 'Size: 2 WAY TPN' },
  ],
  words: [
    word('Way', 10, 28), word('Phase', 60, 28), word('Device BS (EN)', 120, 28), word('Rating (A)', 220, 28), word('Description', 300, 28),
    word('1', 12, 88), word('L1-L3', 62, 88), word('60947-2', 125, 88), word('32', 225, 88), word('Three phase fan', 302, 88, 90),
    word('2', 12, 122), word('L1-L3', 62, 122), word('60947-2', 125, 122), word('40', 225, 122), word('Three phase pump', 302, 122, 90),
  ],
  pageWidth: 430,
  pageHeight: 160,
  pageType: 'db-schedule',
  allowSingleWay: true,
});
assert.equal(phaseSpan.rows.length, 2);
assert.equal(phaseSpan.rows[0].phase, '3PH');
assert.equal(phaseSpan.rows[0].poles, 3);
assert.equal(phaseSpan.rows[0].occupies_ways, 3);

const sectionScope = Core.buildDocumentExtractionScope([
  { page: 1, type: 'cover', text: 'Project cover' },
  { page: 2, type: 'register', text: 'DOCUMENT CONTENTS\nCircuit Charts' },
  { page: 3, type: 'unknown', text: 'DISTRIBUTION BOARD SCHEDULE\nDB REFERENCE DB-A' },
  { page: 4, type: 'unknown', text: 'Way 1 MCB 10A\nWay 2 MCB 16A\nWay 3 MCB 20A\nWay 4 MCB 32A' },
  { page: 5, type: 'cable-schedule', text: 'CABLE SCHEDULES' },
  { page: 6, type: 'sld', text: 'LV SINGLE LINE DIAGRAM' },
  { page: 7, type: 'spec', text: 'Specification' },
], { longDocumentThreshold: 5 });
assert.equal(sectionScope.enforced, true);
assert.deepEqual(sectionScope.pages, [3, 4, 6]);
assert.deepEqual(sectionScope.scheduleRange, { start: 3, end: 4 });

const scoped = Core.applyBoardScope({
  MSDB01: { norm: 'MSDB01', orig: 'A0.MSDB.01', type: 'SB' },
  DBFUSE: { norm: 'DBFUSE', orig: 'DB-FUSE', type: 'DB' },
  DBOK: { norm: 'DBOK', orig: 'DB-OK', type: 'DB' },
}, [
  ...Array.from({ length: 4 }, (_, index) => ({ id: `f${index}`, boardNorm: 'DBFUSE', device: 'Fuse', qty: 1, status: 'confirmed' })),
  { id: 'ok', boardNorm: 'DBOK', device: 'MCB', qty: 1, status: 'confirmed' },
]);
assert.equal(scoped.boards.MSDB01.inScope, false);
assert.ok(scoped.boards.MSDB01.outOfScopeReasons.includes('MSDB_ASSEMBLY'));
assert.equal(scoped.boards.DBFUSE.inScope, false);
assert.ok(scoped.boards.DBFUSE.outOfScopeReasons.includes('FOUR_OR_MORE_FUSE_OUTGOINGS'));
assert.equal(scoped.boards.DBOK.inScope, true);
assert.equal(scoped.rows.filter((row) => row.outOfScope).length, 4);

console.log('PASS: note links, alphanumeric ways, phase spans, document scoping, and take-off exclusions');
