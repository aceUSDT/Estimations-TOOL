import assert from 'node:assert/strict';

await import('../../extractor-core.js');
await import('../../spatial-schedule-core.js');
const Core = globalThis.EstimationExtractorCore;

assert.equal(Core.parseProtectionDescriptor('Hager h3+ MCCB P160 25kA 3-4P LSI 160').tripUnit, 'LSI');
assert.equal(Core.parseProtectionDescriptor('MCCB X250 TM-D').tripUnit, 'TM');
assert.equal(Core.parseProtectionDescriptor('MCCB LSNI').tripUnit, 'LSNI');
assert.equal(Core.parseProtectionDescriptor('MCCB ATFM').tripUnit, 'ATFM');
assert.equal(Core.parseProtectionDescriptor('MCCB ATAM').tripUnit, 'ATAM');
assert.equal(Core.parseProtectionDescriptor('MCCB LI').tripUnit, 'LI');
assert.equal(Core.parseProtectionDescriptor('Hager h3+ MCCB P160 LSI').productRange, 'H3+ / P160');

const word = (text, x, y, width = Math.max(8, String(text).length * 4.5), height = 10, rotation = 0) => ({
  text,
  bbox: [x, y, width, height],
  confidence: 0.98,
  rotation,
});

function threePhaseFixture() {
  const words = [
    word('Way', 10, 205, 12, 70, 90),
    word('Phase L1/L2/L3', 35, 205, 12, 70, 90),
    word('Device BS (EN)', 78, 205, 12, 70, 90),
    word('Type', 120, 205, 12, 70, 90),
    word('Rating (A)', 150, 205, 12, 70, 90),
    word('Short Circuit Capacity (kA)', 185, 205, 12, 70, 90),
    word('AFDD', 235, 205, 12, 70, 90),
    word('RCD', 265, 205, 12, 70, 90),
    word('RCD Operating Current (mA)', 290, 205, 12, 70, 90),
    word('Circuit Reference', 360, 205),
    word('Circuit Type', 450, 205, 12, 70, 90),
    word('Live (mm2)', 485, 205, 12, 70, 90),
    word('CPC (mm2)', 520, 205, 12, 70, 90),
    word('Cable Type', 555, 205, 12, 70, 90),
  ];
  const ratings = [100, 100, 100, 100, 50, 63, 63];
  ratings.forEach((rating, index) => {
    const way = index + 1;
    const y = 300 + index * 30;
    words.push(word(String(way), 12, y));
    words.push(word('L1', 42, y - 9), word('L2', 42, y), word('L3', 42, y + 9));
    words.push(word('60947', 82, y));
    words.push(word('6.2', 122, y));
    words.push(word(String(rating), 154, y));
    words.push(word('25', 194, y));
    words.push(word('X', 238, y));
    words.push(word('X', 268, y));
    words.push(word(`DB/Z1/00/0${way + 1}`, 350, y, 75));
    words.push(word('Rd', 452, y));
    words.push(word(index === 3 || index === 6 ? '50.0' : '25.0', 486, y));
    words.push(word(index === 3 || index === 6 ? '25.0' : '16.0', 521, y));
    words.push(word('A', 562, y));
  });
  const y = 300 + 7 * 30;
  words.push(word('8', 12, y));
  words.push(word('L1', 42, y - 9), word('L2', 42, y), word('L3', 42, y + 9));
  return words.flat();
}

const lines = [
  { text: 'DISTRIBUTION BOARD SCHEDULE' },
  { text: 'Job Reference: EXAMPLE PROJECT Job No: 1001' },
  { text: 'DIST/BD Ref: DB/Z1/00/01' },
  { text: 'Location: TEST PLANTROOM' },
  { text: 'Purpose: TEST ELECTRICAL SERVICES' },
  { text: 'Size: 8 WAY TPN' },
  { text: 'Supplied From: TRANSFER SWITCH FED VIA LVSB/Z1/00/01' },
  { text: 'No of Phases: 3 PHASE Voltage: 415V' },
  { text: 'Supply Cable Details: 120mm2 XLPE/SWA/LSF X3 IN PARALLEL' },
  { text: 'Supply CPD Details: 60947 400A MCCB MICROLOGIC 6.3 TRIP UNIT' },
  { text: 'Internal Isolator Details: 400A' },
  { text: 'Circuit Reference' },
  ...Array.from({ length: 7 }, (_, index) => ({ text: `${index + 1} DB/Z1/00/0${index + 2}` })),
];

const result = Core.parseSpatialSchedulePage({
  lines,
  words: threePhaseFixture(),
  pageWidth: 600,
  pageHeight: 700,
  pageType: 'db-schedule',
});

assert.equal(result.matched, true);
assert.equal(result.board.ref, 'DB/Z1/00/01');
assert.equal(result.board.classification.family, 'panelboard');
assert.equal(result.board.type, 'PB');
assert.match(result.board.classification.reasons.join(' '), /400A/);
assert.equal(result.board.header.ways_total, 8);
assert.equal(result.board.header.phase_config, 'TPN');
assert.equal(result.board.header.supply_cpd_rating_a, 400);
assert.equal(result.board.header.supply_cpd_class, 'MCCB');
assert.equal(result.board.header.supply_cpd_trip_unit, '6.3');
assert.equal(result.board.header.internal_isolator_rating_a, 400);

assert.equal(result.rows.length, 8);
assert.deepEqual(result.rows.slice(0, 7).map((row) => row.rating), [100, 100, 100, 100, 50, 63, 63]);
assert.ok(result.rows.slice(0, 7).every((row) => row.device === 'MCCB'));
assert.ok(result.rows.slice(0, 7).every((row) => row.tripUnit === '6.2'));
assert.ok(result.rows.slice(0, 7).every((row) => row.ka === 25));
assert.ok(result.rows.slice(0, 7).every((row) => row.poles === 3 && row.phase === '3PH'));
assert.equal(result.rows[7].space, true);
assert.equal(result.rows[7].qty, 0);
assert.equal(result.rows[7].requiresReview, true);
assert.equal(result.feeds.length, 7);
assert.ok(result.rows[0].fieldSources.rating.bbox);
assert.notDeepEqual(result.rows[0].fieldSources.rating.bbox, result.rows[0].fieldSources.circuitReference.bbox);
assert.ok(result.rows[0].fieldSources.rcdProtection.bbox);
assert.ok(result.rows[0].fieldSources.afdd.bbox);
assert.equal(result.rows[0].rcdProtected, false);
assert.equal(result.rows[0].afdd, false);
assert.ok(result.rows[0].highlightBbox[3] >= 18, 'a genuine merged three-phase row may span all phase lanes');

// A saved calibration must never make a document worse than the automatic
// geometry baseline. This deliberately points the way column at empty space.
const calibrationFallbackDocument = Core.parseSpatialScheduleDocument([{
  documentPage: 1,
  lines,
  words: threePhaseFixture(),
  pageWidth: 600,
  pageHeight: 700,
  pageType: 'db-schedule',
  calibrationHint: { applicable: 1, regions: [{ role: 'way', bbox: [540, 180, 25, 430] }], roles: ['way'] },
}]);
const calibrationFallback = calibrationFallbackDocument.pages[0];
assert.equal(calibrationFallback.result.rows.length, 8);
assert.equal(calibrationFallback.result.board.ref, 'DB/Z1/00/01');
assert.equal(calibrationFallback.result.calibration.fallback, 'automatic_baseline_recovered_rows');
assert.ok(calibrationFallback.result.warnings.includes('user_calibration_fell_back_to_automatic_geometry'));
assert.ok(calibrationFallback.attempts.some((attempt) => attempt.strategy === 'geometry-automatic-fallback' && attempt.selected));

const schematicWithLegend = Core.parseSpatialSchematicPage({
  lines: [{ text: 'LV SCHEMATIC' }, { text: 'Legend' }, { text: 'FAP Fire Alarm Panel' }, { text: 'LVS1 DB-G1-LP 125A MCCB' }],
  words: [
    word('LV SCHEMATIC', 10, 10), word('LVS1', 40, 100), word('DB-G1-LP', 160, 100),
    word('125A', 160, 130), word('MCCB', 160, 145),
    word('Legend', 510, 10), word('FAP', 520, 50), word('Fire Alarm Panel', 540, 50),
  ],
  pageWidth: 600,
  pageHeight: 300,
  pageType: 'sld',
});
assert.ok(!schematicWithLegend.boards.some((board) => board.norm === 'FAP'), 'legend keys must not become schematic board nodes');

for (const token of ['YES', 'Y', '1', '✓', '✔', '☑', '\uF0FC']) {
  assert.equal(Core.parseProtectionIndicator(token), true, `${token} must be recognised as a protection tick`);
}
for (const token of ['NO', 'N', '0', 'X', '×', '✕', '✖', '☐', '\uF0FB']) {
  assert.equal(Core.parseProtectionIndicator(token), false, `${token} must be recognised as a negative indicator`);
}

const roles = result.references.reduce((counts, reference) => {
  counts[reference.role] = (counts[reference.role] || 0) + 1;
  return counts;
}, {});
assert.equal(roles.primary_board, 1);
assert.equal(roles.circuit_reference, 7);

// A differently ordered compact schedule is mapped by header semantics, not
// by the first fixture's column positions.
const compactWords = [
  word('CCT', 10, 30), word('Duty', 55, 30), word('Device Family', 210, 30),
  word('Phase', 290, 30), word('Rating (A)', 340, 30), word('Trip Curve', 400, 30),
  word('RCD mA', 460, 30),
  word('1', 10, 80), word('Office lighting', 55, 80, 100), word('MCB', 215, 80),
  word('L1', 292, 80), word('16', 345, 80), word('B', 405, 80),
  word('2', 10, 110), word('Socket circuit', 55, 110, 100), word('RCBO', 215, 110),
  word('L2', 292, 110), word('32', 345, 110), word('C', 405, 110), word('30', 465, 110),
];
const compact = Core.parseSpatialSchedulePage({
  lines: [
    { text: 'DISTRIBUTION BOARD SCHEDULE' },
    { text: 'Board Reference: DB-TEST-02' },
    { text: 'Size: 6 WAY TPN' },
    { text: 'Internal Isolator Details: 125A' },
  ],
  words: compactWords,
  pageWidth: 520,
  pageHeight: 220,
  pageType: 'db-schedule',
});
assert.equal(compact.matched, true);
assert.deepEqual(compact.rows.filter((row) => !row.inferredWay).map((row) => [row.device, row.rating, row.curve]), [['MCB', 16, 'B'], ['RCBO', 32, 'C']]);
assert.equal(compact.rows.find((row) => row.way === 2).rcdProtected, true, 'a valid RCD sensitivity corroborates protection when the tick glyph is absent');
assert.equal(compact.rows.find((row) => row.way === 2).sens, 30);
assert.deepEqual(compact.rows.filter((row) => row.inferredWay).map((row) => row.way), [3, 4, 5, 6]);
assert.equal(compact.board.classification.family, 'distribution_board');

const inferredCurveWords = compactWords.filter((item) => !(item.text === 'B' && item.bbox[1] === 80));
const inferredCurveSchedule = Core.parseSpatialSchedulePage({
  lines: [
    { text: 'DISTRIBUTION BOARD SCHEDULE' },
    { text: 'Board Reference: DB-TEST-CURVE' },
    { text: 'Size: 6 WAY TPN' },
    { text: 'Internal Isolator Details: 125A' },
  ],
  words: inferredCurveWords,
  pageWidth: 520,
  pageHeight: 220,
  pageType: 'db-schedule',
});
const inferredCurveRow = inferredCurveSchedule.rows.find((row) => row.way === 1);
assert.equal(inferredCurveRow.curve, 'C');
assert.equal(inferredCurveRow.curveInferred, true);
assert.equal(inferredCurveRow.requiresReview, true);
assert.match(inferredCurveRow.resolutionReasons.join(' '), /125A distribution-board policy default/i);

// A TPN way can contain either one merged three-pole device or three distinct
// single-pole phase rows. Repeated per-phase evidence must remain three devices.
const phaseRowWords = [
  word('Way', 10, 30), word('Phase', 45, 30), word('Device BS (EN)', 90, 30),
  word('Type', 145, 30), word('Rating (A)', 180, 30),
  word('Short', 220, 30, 10, 28, 90), word('Circuit', 231, 30, 10, 28, 90),
  word('Capacity', 242, 30, 10, 28, 90), word('(kA)', 253, 30, 10, 28, 90),
  word('Circuit Reference', 330, 30),
];
for (const [way, baseY] of [[1, 100], [2, 175]]) {
  phaseRowWords.push(word(String(way), 12, baseY + 20));
  ['L1', 'L2', 'L3'].forEach((phase, phaseIndex) => {
    const y = baseY + phaseIndex * 20;
    phaseRowWords.push(word(phase, 47, y));
    if (way === 1 || phase === 'L1') {
      phaseRowWords.push(word('61009', 94, y), word('C', 148, y), word('20', 184, y), word('10', 247, y));
      phaseRowWords.push(word(`LOAD-${way}-${phase}`, 325, y, 65));
    } else {
      phaseRowWords.push(word('SPARE', 335, y));
    }
  });
}
// A full-width section title can sit inside the wider way band immediately
// above L1. It is structural context, not evidence for the first phase row.
phaseRowWords.push(word('METER SECTION 3-LIGHTING', 205, 160, 125));
const perPhase = Core.parseSpatialSchedulePage({
  lines: [
    { text: 'DISTRIBUTION BOARD SCHEDULE' },
    { text: 'Board Reference: DB-TEST-03' },
    { text: 'Size: 2 WAY TPN' },
    { text: 'Internal Isolator Details: 125A' },
  ],
  words: phaseRowWords,
  pageWidth: 430,
  pageHeight: 300,
  pageType: 'db-schedule',
});
assert.equal(perPhase.matched, true);
assert.deepEqual(perPhase.rows.map((row) => [row.way, row.phase, row.device, row.qty]), [
  [1, 'L1', 'RCBO', 1], [1, 'L2', 'RCBO', 1], [1, 'L3', 'RCBO', 1],
  [2, 'L1', 'RCBO', 1], [2, 'L2', null, 0], [2, 'L3', null, 0],
]);
assert.ok(perPhase.rows.slice(0, 4).every((row) => row.poles === 1));
assert.ok(perPhase.rows.slice(0, 4).every((row) => row.ka === 10));
assert.ok(perPhase.rows.slice(4).every((row) => row.spare));
const firstRowAfterSection = perPhase.rows.find((row) => row.way === 2 && row.phase === 'L1');
assert.doesNotMatch(firstRowAfterSection.srcText, /METER SECTION/i);
assert.ok(firstRowAfterSection.highlightBbox[1] >= 170, 'section headings above L1 must not expand the selected-row highlight');
const wayOneHighlights = perPhase.rows.filter((row) => row.way === 1).map((row) => row.highlightBbox);
for (let index = 1; index < wayOneHighlights.length; index += 1) {
  const prior = wayOneHighlights[index - 1];
  const current = wayOneHighlights[index];
  assert.ok(prior[1] + prior[3] <= current[1], 'single-phase review highlights must not overlap adjacent rows');
}

// A single populated middle phase with explicit spare neighbours is not a
// merged three-pole circuit. This is the production W-2 failure mode.
const middlePhaseWords = phaseRowWords.filter((item) => item.bbox[1] < 240).map((item) => ({ ...item }));
middlePhaseWords.push(word('3', 12, 270));
['L1', 'L2', 'L3'].forEach((phase, phaseIndex) => {
  const y = 250 + phaseIndex * 20;
  middlePhaseWords.push(word(phase, 47, y));
  if (phase === 'L2') {
    middlePhaseWords.push(
      word('60898', 94, y), word('C', 148, y), word('10', 184, y), word('10', 247, y),
      word('Calorifier Trace Heating: Plantroom', 325, y, 95),
    );
  } else {
    middlePhaseWords.push(word('SPARE', 335, y));
  }
});
const middlePhase = Core.parseSpatialSchedulePage({
  lines: [
    { text: 'DISTRIBUTION BOARD SCHEDULE' },
    { text: 'Board Reference: DB-TEST-MIDDLE-PHASE' },
    { text: 'Size: 3 WAY TPN' },
  ],
  words: middlePhaseWords,
  pageWidth: 430,
  pageHeight: 340,
  pageType: 'db-schedule',
  materializeMissingWays: false,
});
const middlePhaseWay = middlePhase.rows.filter((row) => row.way === 3);
assert.deepEqual(middlePhaseWay.map((row) => [row.phase, row.device, row.poles, row.poleConfiguration, row.spare, row.qty]), [
  ['L1', null, null, null, true, 0],
  ['L2', 'MCB', 1, 'SP', false, 1],
  ['L3', null, null, null, true, 0],
]);
assert.equal(middlePhaseWay.filter((row) => row.device).length, 1);
assert.ok(middlePhaseWay.every((row) => row.phase !== '3PH'), 'spare neighbours must prevent TP promotion');

// Source drawings can contain authored errors. Three physical phase lanes must
// survive repeated labels, and a repair is allowed only when the same page or
// board header supplies corroborating structural evidence.
const damagedPhaseWords = phaseRowWords.map((item) => {
  const [x, y] = item.bbox;
  if (x === 47 && [175, 195, 215].includes(y)) return { ...item, text: 'L1' };
  return { ...item };
});
const damagedPhases = Core.parseSpatialSchedulePage({
  lines: [
    { text: 'DISTRIBUTION BOARD SCHEDULE' },
    { text: 'Board Reference: DB-TEST-DAMAGED' },
    { text: 'Size: 2 WAY TPN' },
  ],
  words: damagedPhaseWords,
  pageWidth: 430,
  pageHeight: 300,
  pageType: 'db-schedule',
});
const repairedWay = damagedPhases.rows.filter((row) => row.way === 2);
assert.deepEqual(repairedWay.map((row) => row.phase), ['L1', 'L2', 'L3']);
assert.equal(repairedWay[1].phaseRepair.original, 'L1');
assert.equal(repairedWay[1].phaseRepair.inferred, 'L2');
assert.equal(repairedWay[1].fieldSources.phase.originalText, 'L1');
assert.equal(repairedWay[1].requiresReview, true);
assert.ok(repairedWay[1].conf <= 0.84);
assert.match(repairedWay[1].resolutionReasons.join(' '), /physical phase lanes/i);
assert.ok(damagedPhases.warnings.includes('source_phase_labels_reconciled'));

const uncorroboratedDamage = Core.parseSpatialSchedulePage({
  lines: [{ text: 'DISTRIBUTION BOARD SCHEDULE' }, { text: 'Board Reference: DB-AMBIGUOUS' }, { text: 'Size: 2 WAY TPN' }],
  words: phaseRowWords.map((item) => item.bbox[0] === 47 && item.bbox[1] >= 100 ? { ...item, text: 'L1' } : { ...item }),
  pageWidth: 430,
  pageHeight: 300,
  pageType: 'db-schedule',
});
const unresolvedRows = uncorroboratedDamage.rows.filter((row) => row.way === 2);
assert.ok(unresolvedRows.length >= 1);
assert.ok(unresolvedRows.every((row) => !row.phaseRepair && row.phaseConflict));
assert.ok(unresolvedRows.every((row) => row.requiresReview && row.conf <= 0.55));
assert.ok(uncorroboratedDamage.warnings.includes('source_phase_labels_unresolved'));

// A damaged or cropped early page may need a column schema learned from a
// later healthy page in the same document. Coordinates are deliberately scaled
// to prove that reuse is normalised, not tied to one page size.
const sourcePageWords = [
  word('Way', 10, 25), word('Phase', 45, 25), word('Device BS (EN)', 90, 25),
  word('Type', 145, 25), word('Rating (A)', 180, 25), word('Circuit Reference', 225, 25),
  word('1', 12, 90), word('L1', 47, 80), word('L2', 47, 90), word('L3', 47, 100),
  word('60898', 94, 90), word('C', 148, 90), word('20', 184, 90), word('LOAD-1', 225, 90),
  word('2', 12, 150), word('L1', 47, 140), word('L2', 47, 150), word('L3', 47, 160),
  word('61009', 94, 150), word('C', 148, 150), word('32', 184, 150), word('LOAD-2', 225, 150),
];
const scaleWord = (item, scale) => ({
  ...item,
  bbox: item.bbox.map((value) => value * scale),
});
const croppedFirstPage = sourcePageWords.filter((item) => item.bbox[1] > 30 && item.bbox[1] <= 110)
  .map((item) => scaleWord(item, 1.25));
const adaptiveDocument = Core.parseSpatialScheduleDocument([
  {
    documentPage: 1,
    lines: [{ text: 'Board Reference: DB-ADAPT-01' }],
    words: croppedFirstPage,
    pageWidth: 325,
    pageHeight: 275,
    pageType: 'db-schedule',
  },
  {
    documentPage: 2,
    lines: [{ text: 'DISTRIBUTION BOARD SCHEDULE' }, { text: 'Board Reference: DB-ADAPT-02' }],
    words: sourcePageWords,
    pageWidth: 260,
    pageHeight: 220,
    pageType: 'db-schedule',
  },
]);
const adaptiveFirst = adaptiveDocument.pages.find((entry) => entry.input.documentPage === 1);
assert.equal(adaptiveFirst.result.matched, true);
assert.equal(adaptiveFirst.schemaSourcePage, 2);
assert.ok(adaptiveFirst.attempts.some((attempt) => attempt.strategy === 'geometry-document-schema' && attempt.matched));
assert.equal(adaptiveFirst.result.rows.find((row) => row.way === 1)?.rating, 20);

const unrelatedWords = [
  word('1', 12, 90), word('L1', 47, 90), word('NOTES', 100, 90),
  word('2', 12, 150), word('L2', 47, 150), word('REVISION', 100, 150),
];
const rejectedTransfer = Core.parseSpatialScheduleDocument([
  { documentPage: 1, lines: [{ text: 'Board Reference: DB-UNPROVEN' }], words: unrelatedWords, pageWidth: 260, pageHeight: 220, pageType: 'db-schedule' },
  { documentPage: 2, lines: [{ text: 'Board Reference: DB-ADAPT-02' }], words: sourcePageWords, pageWidth: 260, pageHeight: 220, pageType: 'db-schedule' },
]);
const unprovenPage = rejectedTransfer.pages.find((entry) => entry.input.documentPage === 1);
assert.equal(unprovenPage.result.matched, false, 'schema transfer must remain fail-closed when protection cells do not reconcile');
assert.equal(unprovenPage.schemaSourcePage, null);

const boardlessSourceTransfer = Core.parseSpatialScheduleDocument([
  {
    documentPage: 1,
    lines: [{ text: 'Board Reference: DB-TARGET-01' }],
    words: croppedFirstPage,
    pageWidth: 325,
    pageHeight: 275,
    pageType: 'db-schedule',
  },
  {
    documentPage: 2,
    lines: [{ text: 'DISTRIBUTION BOARD SCHEDULE' }],
    words: sourcePageWords,
    pageWidth: 260,
    pageHeight: 220,
    pageType: 'db-schedule',
  },
]);
assert.equal(boardlessSourceTransfer.catalogue.length, 0, 'a boardless page must never teach a reusable document schema');
assert.equal(boardlessSourceTransfer.pages[0].schemaSourcePage, null);

// A continuation page can legitimately contain only merged spare or blank
// bands. It may consume a proven adjacent schema, but it must not become a
// schema source itself because it has no printed board identity or headers.
const spareContinuationWords = [];
[
  ['L-3', 90, 'SPARE'],
  ['L-4', 150, 'FITTED BLANK'],
].forEach(([way, centreY, occupancy]) => {
  spareContinuationWords.push(word(way, 12, centreY));
  ['L1', 'L2', 'L3'].forEach((phase, phaseIndex) => {
    const y = centreY + (phaseIndex - 1) * 12;
    spareContinuationWords.push(word(phase, 47, y));
  });
  spareContinuationWords.push(word(occupancy, 225, centreY, 40));
});
const occupancyContinuation = Core.parseSpatialScheduleDocument([
  {
    documentPage: 1,
    lines: [{ text: 'DISTRIBUTION BOARD SCHEDULE' }, { text: 'Board Reference: DB-CONT-01' }],
    words: sourcePageWords,
    pageWidth: 260,
    pageHeight: 220,
    pageType: 'db-schedule',
  },
  {
    documentPage: 2,
    lines: [{ text: 'L-3 SPARE' }, { text: 'L-4 FITTED BLANK' }],
    words: spareContinuationWords,
    pageWidth: 260,
    pageHeight: 220,
    pageType: 'db-schedule',
  },
]);
const recoveredOccupancyPage = occupancyContinuation.pages.find((entry) => entry.input.documentPage === 2);
assert.equal(recoveredOccupancyPage.result.matched, true, 'an all-spare continuation must survive document schema recovery');
assert.equal(recoveredOccupancyPage.schemaSourcePage, 1);
assert.ok(recoveredOccupancyPage.attempts.some((attempt) => attempt.strategy === 'geometry-document-schema'
  && attempt.matched && attempt.occupancyContinuation));
assert.deepEqual([...new Set(recoveredOccupancyPage.result.rows.map((row) => row.way))], ['L-3', 'L-4']);
assert.ok(recoveredOccupancyPage.result.rows.every((row) => row.spare || row.space));
assert.ok(recoveredOccupancyPage.result.rows.some((row) => row.spare));
assert.ok(recoveredOccupancyPage.result.rows.some((row) => row.space));
assert.equal(occupancyContinuation.catalogue.length, 1, 'only the identified source page may teach the document schema');

// Mirrored schedules are valid layouts too; the way column is discovered by
// sequence and phase support rather than a hard-coded left-page position.
const mirroredCompact = compactWords.map((item) => {
  const [x, y, width, height] = item.bbox;
  return { ...item, bbox: [520 - x - width, y, width, height] };
});
const mirrored = Core.parseSpatialSchedulePage({
  lines: [{ text: 'DISTRIBUTION BOARD SCHEDULE' }, { text: 'Board Reference: DB-MIRROR-01' }],
  words: mirroredCompact,
  pageWidth: 520,
  pageHeight: 220,
  pageType: 'db-schedule',
});
assert.equal(mirrored.matched, true);
assert.deepEqual(mirrored.rows.map((row) => [row.way, row.rating]), [[1, 16], [2, 32]]);

const correctedStandard = Core.resolveProtectionDevice({ standard: '60974', tripUnit: 'TMD' });
assert.equal(correctedStandard.device, 'MCCB');
assert.equal(correctedStandard.standardCode, '60947');
assert.match(correctedStandard.reasons.join(' '), /60974/);

const spatialMcbWithRcd = Core.resolveProtectionDevice({standard:'BS EN 60898',rcdProtected:true,sensitivityMa:30});
assert.equal(spatialMcbWithRcd.device, 'MCB');
assert.equal(spatialMcbWithRcd.classBasis, 'bs_en');

const splitPageWords = [
  word('Way', 10, 25), word('Phase', 45, 25), word('Device BS (EN)', 90, 25),
  word('Type', 145, 25), word('Rating (A)', 180, 25),
  word('1', 12, 90), word('L1', 47, 80), word('L2', 47, 90), word('L3', 47, 100),
  word('60898', 94, 90), word('C', 148, 90), word('20', 184, 90),
  word('2', 12, 150), word('L1', 47, 140), word('L2', 47, 150), word('L3', 47, 160),
  word('60898', 94, 150), word('C', 148, 150), word('20', 184, 150),
  // Way 3 begins at the page edge; its printed way number and L2/L3 are on the continuation page.
  word('L1', 47, 188), word('61009', 94, 188), word('C', 148, 188), word('32', 184, 188),
];
const splitPage = Core.parseSpatialSchedulePage({
  lines: [
    { text: 'DISTRIBUTION BOARD SCHEDULE' },
    { text: 'Board Reference: DB-SPLIT-01' },
    { text: 'Size: 3 WAY TPN' },
  ],
  words: splitPageWords,
  pageWidth: 260,
  pageHeight: 220,
  pageType: 'db-schedule',
});
const recoveredSplit = splitPage.rows.find((row) => row.resolutionSource === 'source_standard_reconciliation');
assert.equal(recoveredSplit?.way, 3);
assert.equal(recoveredSplit?.phase, 'L1');
assert.equal(recoveredSplit?.device, 'RCBO');
assert.equal(recoveredSplit?.wayNumberInferred, true);

const indexRefs = Core.extractContextualBoardReferences([
  'DISTRIBUTION BOARD SUMMARY INDEX',
  'DB-A-01 Plantroom 12 Way',
  'DB-A-02 Office 8 Way',
], { pageType: 'db-schedule', isSchedule: true });
assert.equal(indexRefs.filter((reference) => reference.role === 'index_board').length, 2);

const hint = Core.buildSpatialLayoutHint(result);
assert.equal(hint.version, 1);
assert.equal(hint.table.rows.length, 8);
assert.ok(hint.table.columns.some((column) => column.role === 'circuit_reference'));

const feederResult = Core.deduplicateFeederRelationships([
  { id: 'schedule', from: 'DB-A', to: 'DB-B', way: 4, rating: 63, fileId: 'f1', page: 3, conf: 0.91, spatial: true },
  { id: 'ai', from: 'db-a', to: 'db-b', rating: 63, poles: 3, fileId: 'f1', page: 3, conf: 0.72, ai: true },
  { id: 'parallel', from: 'DB-A', to: 'DB-B', way: 7, rating: 63, fileId: 'f1', page: 4, conf: 0.9 },
]);
assert.equal(feederResult.feeders.length, 2);
assert.equal(feederResult.duplicates.length, 1);
assert.equal(feederResult.feeders.find((feeder) => feeder.way === 4).poles, 3);
assert.equal(feederResult.feeders.find((feeder) => feeder.way === 4).evidence.length, 2);

const schematicWords = [
  word('DB-A-01', 100, 360, 10, 42, -90), word('[Office]', 110, 360, 10, 42, -90), word('12-Way', 115, 360, 10, 42, -90),
  word('DB-B-02', 200, 360, 10, 42, -90), word('[Kitchen]', 210, 360, 10, 42, -90), word('24-Way', 215, 360, 10, 42, -90),
  word('125A', 130, 600, 20, 10), word('TPN', 132, 620, 16, 10), word('MCCB', 128, 640, 24, 10),
  word('50mm2 4C XLPE/SWA/LSZH', 135, 450, 10, 120, -90), word('M', 138, 420, 4, 10),
  word('250A', 230, 600, 20, 10), word('TPN', 232, 620, 16, 10), word('MCCB', 228, 640, 24, 10),
  word('120mm2 4C XLPE/SWA/LSZH', 235, 450, 10, 120, -90), word('1+2', 233, 420, 14, 10),
  word('LVS1 (Main LV Switchboard)', 50, 760, 160, 14),
];
const schematic = Core.parseSpatialSchematicPage({
  lines: [{ text: 'LV SCHEMATIC' }],
  words: schematicWords,
  pageWidth: 900,
  pageHeight: 820,
  pageType: 'sld',
});
assert.equal(schematic.matched, true);
assert.equal(schematic.feeds.length, 2);
assert.deepEqual(schematic.feeds.map((feed) => [feed.fromRef, feed.toRef, feed.rating, feed.device, feed.poleConfiguration, feed.cable.size]), [
  ['LVS1', 'DB-A-01', 125, 'MCCB', 'TPN', 50],
  ['LVS1', 'DB-B-02', 250, 'MCCB', 'TPN', 120],
]);
assert.deepEqual(schematic.boards.filter((board) => /^DB/.test(board.norm)).map((board) => [board.norm, board.location, board.waysTotal]), [
  ['DBA01', 'Office', 12],
  ['DBB02', 'Kitchen', 24],
]);
assert.ok(schematic.devices.some((device) => device.boardRef === 'DB-A-01' && device.device === 'Meter'));
assert.ok(schematic.devices.some((device) => device.boardRef === 'DB-B-02' && device.device === 'SPD'));

// A user-authored calibration is a parser input, not a cosmetic overlay. It
// must recover an unfamiliar, unlabelled layout, preserve blank/spare ways,
// and bind optional protection/accessory columns to the same physical row.
const calibratedWords = [
  word('DB-CAL-01', 210, 18, 70),
  word('TP&N distribution board', 315, 18, 145),
  word('1', 15, 85), word('L1', 48, 85), word('MCB', 95, 85), word('20', 155, 85),
  word('Office sockets', 230, 85, 90), word('Y', 345, 85), word('N', 380, 85), word('Y', 420, 85),
  word('2', 15, 120), word('L2', 48, 120), word('RCBO', 95, 120), word('16', 155, 120),
  word('Kitchen lighting', 230, 120, 95), word('Y', 345, 120), word('N', 380, 120), word('Y', 455, 120),
  word('3', 15, 155), word('L3', 48, 155), word('SPARE', 230, 155, 45),
];
const calibrated = Core.parseSpatialSchedulePage({
  lines: [{ text: 'Electrical schedule' }],
  words: calibratedWords,
  pageWidth: 520,
  pageHeight: 220,
  pageType: 'unknown',
  calibrationHint: { regions: [
    { role: 'board_ref', bbox: [205, 10, 82, 24] },
    { role: 'board_type', bbox: [305, 10, 165, 24] },
    { role: 'outgoing_table', bbox: [4, 60, 480, 120] },
    { role: 'single_phase_rows', bbox: [4, 60, 480, 120] },
    { role: 'way', bbox: [5, 60, 30, 120] },
    { role: 'phase', bbox: [36, 60, 34, 120] },
    { role: 'device_class', bbox: [78, 60, 52, 120] },
    { role: 'rating', bbox: [140, 60, 40, 120] },
    { role: 'description', bbox: [205, 60, 125, 120] },
    { role: 'rcd', bbox: [334, 60, 28, 120] },
    { role: 'afdd', bbox: [368, 60, 28, 120] },
    { role: 'contactor', bbox: [406, 60, 28, 120] },
    { role: 'epo', bbox: [442, 60, 30, 120] },
  ] },
});
assert.equal(calibrated.matched, true);
assert.equal(calibrated.board.ref, 'DB-CAL-01');
assert.equal(calibrated.board.header.board_type_text, 'TP&N distribution board');
assert.equal(calibrated.board.classification.family, 'distribution_board');
assert.equal(calibrated.rows.filter((row) => !row.inferredWay).length, 3);
assert.equal(calibrated.rows.find((row) => row.way === 1).rcdProtected, true);
assert.equal(calibrated.rows.find((row) => row.way === 1).afdd, false);
assert.ok(calibrated.rows.find((row) => row.way === 1).associatedDevices.some((item) => item.device === 'Contactor'));
assert.ok(calibrated.rows.find((row) => row.way === 2).associatedDevices.some((item) => item.device === 'Emergency power off'));
assert.equal(calibrated.rows.find((row) => row.way === 3).spare, true);
assert.equal(calibrated.rows.find((row) => row.way === 3).qty, 0);
assert.ok(calibrated.calibration.roles.includes('outgoing_table'));
assert.ok(calibrated.calibration.roles.includes('single_phase_rows'));
assert.equal(calibrated.board.header.phase_config, 'SPN');

console.log('PASS: adaptive spatial schedules, damaged phase repair, precise rows, schematic feeder lanes, policy classification, and provenance.');
