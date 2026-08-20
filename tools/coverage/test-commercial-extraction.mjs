import assert from 'node:assert/strict';
import fs from 'node:fs';

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

const wrappedPhaseSpan = Core.parseSpatialSchedulePage({
  lines: [
    { text: 'DISTRIBUTION BOARD SCHEDULE' },
    { text: 'Board Reference: DB-WRAPPED-PHASE-SPAN' },
    { text: 'Size: 2 WAY TPN' },
  ],
  words: (() => {
    const words = [
      word('Way', 10, 28), word('Phase', 60, 28), word('Type', 120, 28),
      word('Rating (A)', 220, 28), word('Description', 300, 28),
    ];
    const devices = [
      ['RCBO', 32], ['MCB', 25], ['MCB', 25], ['RCBO', 25], ['RCBO', 20],
      ['RCBO', 16], ['RCBO', 32], ['RCBO', 32], ['RCBO', 16], ['RCBO', 32],
    ];
    devices.forEach(([device, rating], index) => {
      const way = index + 1;
      const y = 84 + index * 22;
      words.push(
        word(String(way), 12, y), word('L1-', 62, y - 5), word('L3', 62, y + 5),
        word(device, 125, y), word(String(rating), 225, y), word(`Kitchen equipment ${way}`, 302, y, 90),
      );
    });
    return words;
  })(),
  pageWidth: 430,
  pageHeight: 320,
  pageType: 'db-schedule',
  allowSingleWay: true,
});
assert.equal(wrappedPhaseSpan.rows.length, 10);
assert.deepEqual(wrappedPhaseSpan.rows.map((row) => [row.way, row.phase, row.poles, row.poleConfiguration, row.occupies_ways]),
  Array.from({ length: 10 }, (_, index) => [index + 1, '3PH', 3, 'TP', 3]),
  'ways 1-10 with wrapped L1- / L3 phase cells are one explicit three-phase device per visual row');
assert.ok(wrappedPhaseSpan.rows.every((row) => row.fieldSources.phase.originalText === 'L1- L3'));

const capturedPerryfieldsFixture = new URL('../../.codex-tmp/perryfields-page.json', import.meta.url);
if (fs.existsSync(capturedPerryfieldsFixture)) {
  const capturedPage = JSON.parse(fs.readFileSync(capturedPerryfieldsFixture, 'utf8'));
  const captured = Core.parseSpatialSchedulePage({
    lines: capturedPage.lines,
    words: capturedPage.lines.flatMap((line) => line.words || []),
    pageWidth: capturedPage.width,
    pageHeight: capturedPage.height,
    pageType: 'db-schedule',
    materializeMissingWays: false,
  });
  const capturedWays = captured.rows.filter((row) => Number(row.way) >= 1 && Number(row.way) <= 10);
  assert.equal(capturedWays.length, 10, 'the captured DB-G9 page must retain one row for each of ways 1-10');
  assert.ok(capturedWays.every((row) => row.phase === '3PH' && row.poles === 3
    && row.poleConfiguration === 'TP' && row.occupies_ways === 3),
  'the captured DB-G9 L1- / L3 rows must all remain three-phase');
}

for (const notation of ['L1-L3', 'L1 - L3', 'L1/L2/L3', 'L1,L2,L3', 'L1+L2+L3', 'L1L2L3', '3PH', '3 PHASE', 'THREE PHASE']) {
  const evidence = Core.explicitPhaseEvidence(notation);
  assert.equal(evidence?.phase, '3PH', `${notation} must resolve as explicit three-phase evidence`);
  assert.equal(evidence?.poles, 3);
}
for (const lookalike of ['L1', 'L2', 'L3', 'L1/L3', 'DB-L1-L3', 'L1 lighting L3 store', 'L1 SPARE L2 MCB L3 SPARE']) {
  assert.equal(Core.explicitPhaseEvidence(lookalike), null, `${lookalike} must not become a three-phase device`);
}
assert.equal(Core.explicitPhaseEvidence('Board TPN L2 MCB 10A', { strongOnly: true }), null,
  'broad OCR row text must not use a board TPN label as phase-span evidence');

const perryfieldsText = [
  'PROJECT NAME Perryfields Academy PROJECT NUMBER 11274 Board reference DB-G9 Location Kitchen',
  'COMPONENTS DUTY CABLES',
  'Way Phase Type AFDD? T-C characteristic (Note 4) In (A) Earth fault device (mA) Breaking Capacity (kA) Load description',
  '1 L1-L3 RCBO No C 32 30 10 Servery Counter (28) (#5)',
  '2 L1-L3 MCB No C 25 10 Dishwasher (39) (#5)',
  '3 L1-L3 RCBO No C 20 30 10 Bratt Pan (58) (#5)',
].join('\n');
assert.equal(Core.classifyPageText(perryfieldsText).type, 'db-schedule', 'a structured board table must outrank incidental specification text');
assert.equal(Core.classifyPageText('Legend\nSymbol Description\nProject Perryfields Academy\nTitle LV Schematic\nMCCB Panelboard').type, 'sld', 'an explicit schematic title must outrank its embedded legend');

const reconciledSinglePhase = Core.reconcilePoleEvidence({
  phase: 'L2', device: 'MCB', rating: 10, poles: 3, poleConfiguration: 'TP',
  phaseSlotIndependent: true, srcText: 'L2 MCB C 10 Calorifier trace heating', conf: 0.97,
});
assert.equal(reconciledSinglePhase.poles, 1);
assert.equal(reconciledSinglePhase.poleConfiguration, 'SP');
assert.equal(reconciledSinglePhase.occupies_ways, 1);
assert.equal(reconciledSinglePhase.requiresReview, true);
assert.match(reconciledSinglePhase.poleReconciliation.reason, /single-phase slot/i);

const explicitThreePole = Core.reconcilePoleEvidence({
  phase: 'L2', device: 'MCCB', rating: 40, poles: 3, poleConfiguration: 'TP',
  phaseSlotIndependent: true, poleEvidenceExplicit: true, srcText: 'TP MCCB 40A', conf: 0.95,
});
assert.equal(explicitThreePole.poles, 3, 'explicit source pole evidence must not be overwritten');
assert.equal(explicitThreePole.poleConfiguration, 'TP');

const explicitSinglePole = Core.reconcilePoleEvidence({
  phase: 'L2', device: 'MCB', rating: 10, poles: 3, poleConfiguration: 'TP',
  phaseSlotIndependent: true, srcText: 'L2 SP MCB 10A', conf: 0.95,
});
assert.equal(explicitSinglePole.poles, 1, 'an explicit SP token must override a contradictory inferred TP value');
assert.equal(explicitSinglePole.poleConfiguration, 'SP');
assert.equal(explicitSinglePole.sharedPhaseSpan, false);
assert.equal(explicitSinglePole.phaseSlotIndependent, true);

const boardReferenceToken = Core.reconcilePoleEvidence({
  phase: 'L2', device: 'MCB', rating: 10, poles: 3, poleConfiguration: 'TP',
  phaseSlotIndependent: true, srcText: 'DB-SP-01 L2 MCB 10A', conf: 0.95,
});
assert.equal(boardReferenceToken.poles, 1, 'SP inside a board reference must not become explicit pole evidence');
assert.equal(boardReferenceToken.poleConfiguration, 'SP');

const recoveredPhaseSpan = Core.reconcilePoleEvidence({
  phase: 'L3', device: 'MCB', rating: 25, poles: 1, poleConfiguration: 'SP',
  phaseSlotIndependent: true, sharedPhaseSpan: false,
  fieldSources: { phase: { originalText: 'L1- L3', text: 'L1- L3' } },
  srcText: '2 L1- L3 MCB No C 25 10 Dishwasher', conf: 0.99,
});
assert.deepEqual([
  recoveredPhaseSpan.phase, recoveredPhaseSpan.poles, recoveredPhaseSpan.poleConfiguration,
  recoveredPhaseSpan.occupies_ways, recoveredPhaseSpan.phaseSlotIndependent, recoveredPhaseSpan.sharedPhaseSpan,
], ['3PH', 3, 'TP', 3, false, true]);
assert.equal(recoveredPhaseSpan.poleEvidenceBasis, 'source_phase_range');
assert.match(recoveredPhaseSpan.poleReconciliation.reason, /phase span/i);

const aiPhaseSpan = Core.reconcilePoleEvidence({
  phase: 'L1L2L3', device: 'RCBO', rating: 32, poles: 1, poleConfiguration: 'SP',
  srcText: 'L1L2L3 RCBO C 32A', conf: 0.9,
});
assert.deepEqual([aiPhaseSpan.phase, aiPhaseSpan.poles, aiPhaseSpan.poleConfiguration, aiPhaseSpan.occupies_ways], ['3PH', 3, 'TP', 3]);

const correctedPhaseSpan = Core.reconcilePoleEvidence({
  phase: 'L2', device: 'MCB', rating: 25, poles: 1, poleConfiguration: 'SP',
  fieldSources: { phase: { originalText: 'L1- L3', text: 'L1- L3' } },
  corrections: [
    { field: 'Phase', original: '3PH', corrected: 'L2', reason: 'User correction' },
    { field: 'Pole Configuration', original: 'TP', corrected: 'SP', reason: 'User correction' },
  ],
});
assert.deepEqual([correctedPhaseSpan.phase, correctedPhaseSpan.poles, correctedPhaseSpan.poleConfiguration], ['L2', 1, 'SP'],
  'an explicit user correction must take precedence over source phase-span automation');

const inFlightCorrection = Core.reconcilePoleEvidence({
  phase: 'L2', device: 'MCB', rating: 25, poles: 1, poleConfiguration: 'SP',
  poleEvidenceBasis: 'user_correction', phaseEvidenceBasis: 'user_correction',
  fieldSources: { phase: { originalText: 'L1- L3', text: 'L1- L3' } },
});
assert.deepEqual([inFlightCorrection.phase, inFlightCorrection.poles, inFlightCorrection.poleConfiguration], ['L2', 1, 'SP'],
  'source evidence must not overwrite an in-flight correction before its audit entry is appended');

const perryfieldsWords = [
  word('Way', 68, 28, 8), word('Phase', 81, 28, 8),
  word('Circuit protective device', 88, 28, 7), word('Type', 97, 28, 7),
  word('AFDD?', 112, 28, 8), word('T-C characteristic (Note 4)', 128, 28, 8),
  word('In (A)', 145, 28, 8), word('Earth fault device (mA)', 162, 28, 8),
  word('Breaking Capacity (kA)', 179, 28, 8), word('Load description', 207, 28, 20),
];
[
  [1, 'RCBO', 32, 30, 'Servery Counter (28) (#5)'],
  [2, 'MCB', 25, null, 'Dishwasher (39) (#5)'],
  [3, 'RCBO', 20, 30, 'Bratt Pan (58) (#5)'],
].forEach(([way, device, rating, sensitivity, description], index) => {
  const y = 92 + index * 34;
  perryfieldsWords.push(
    word(String(way), 69, y, 5), word('L1- L3', 80, y, 9), word(device, 97, y, 9),
    word('No', 112, y, 7), word('C', 130, y, 5), word(String(rating), 146, y, 7),
  );
  if (sensitivity != null) perryfieldsWords.push(word(String(sensitivity), 163, y, 7));
  perryfieldsWords.push(word('10', 180, y, 7), word(description, 207, y, 100));
});
const perryfields = Core.parseSpatialSchedulePage({
  lines: perryfieldsText.split('\n').map((text) => ({ text })),
  words: perryfieldsWords,
  pageWidth: 360,
  pageHeight: 230,
  pageType: 'db-schedule',
});
assert.equal(perryfields.matched, true);
assert.deepEqual(perryfields.rows.map((row) => [row.way, row.device, row.rating, row.phase, row.poles, row.sens]), [
  [1, 'RCBO', 32, '3PH', 3, 30],
  [2, 'MCB', 25, '3PH', 3, null],
  [3, 'RCBO', 20, '3PH', 3, 30],
]);
assert.equal(perryfields.rows[0].ka, 10, 'the 30mA earth-fault value must not displace the 10kA breaking capacity');
assert.equal(perryfields.board.header.ways_total, 3, 'distinct printed ways provide a reconciled board count when the header omits it');

const mcbOnlyWords = perryfieldsWords.slice(0, 10);
[
  [1, 'BU Classroom: FCU/HRU'],
  [2, 'Intervention/Circulation'],
  [3, 'Kitchen: MVHR-001'],
].forEach(([way, description], index) => {
  const y = 92 + index * 34;
  mcbOnlyWords.push(
    word(String(way), 69, y, 5), word('L'+(index+1), 80, y, 9), word('MCB', 97, y, 9),
    word('No', 112, y, 7), word('C', 130, y, 5), word('20', 146, y, 7),
    word('10', 180, y, 7), word(description, 207, y, 100),
  );
});
const mcbOnly = Core.parseSpatialSchedulePage({
  lines: [
    { text: 'Board reference DB-G2-MHW' },
    { text: 'Way Phase Type AFDD? T-C characteristic In (A) Earth fault device (mA) Breaking Capacity (kA) Load description' },
  ],
  words: mcbOnlyWords,
  pageWidth: 360,
  pageHeight: 230,
  pageType: 'db-schedule',
});
assert.equal(mcbOnly.matched, true);
assert.deepEqual(mcbOnly.rows.map((row) => [row.device, row.rating, row.sens, row.ka]), [
  ['MCB', 20, null, 10],
  ['MCB', 20, null, 10],
  ['MCB', 20, null, 10],
], 'a blank earth-fault column must not borrow adjacent 10kA values and turn explicit MCBs into RCBOs');

const perryfieldsPrefixedWayWords = [
  word('Way', 20, 28), word('Phase', 52, 28), word('Type', 82, 28),
  word('AFDD?', 108, 28), word('Characteristic', 132, 28), word('In (A)', 160, 28),
  word('Earth fault device (mA)', 188, 28, 18), word('Load description', 242, 28, 28),
];
[
  ['L-1', 96, [
    ['L1', 'MCB', 'No', 'C', 10, 'Ltg: Atrium'],
    ['L2', 'MCB', 'No', 'C', 10, 'Ltg: Stair'],
    ['L3', 'MCB', 'No', 'C', 10, 'Ltg: Food Room'],
  ]],
  ['L-2', 144, [
    ['L1', 'MCB', 'No', 'C', 10, 'Ltg: Open Space'],
    ['L2', 'MCB', 'No', 'C', 10, 'Ltg: Staff Room'],
    ['L3', 'MCB', 'No', 'C', 10, 'Ltg: Circulation'],
  ]],
].forEach(([way, centreY, phaseRows]) => {
  perryfieldsPrefixedWayWords.push(word(way, 20, centreY, 10));
  phaseRows.forEach(([phase, device, afdd, curve, rating, description], phaseIndex) => {
    const y = centreY + (phaseIndex - 1) * 12;
    perryfieldsPrefixedWayWords.push(
      word(phase, 52, y, 8), word(device, 82, y, 10), word(afdd, 108, y, 8),
      word(curve, 132, y, 6), word(String(rating), 160, y, 8), word(description, 242, y, 72),
    );
  });
});
const perryfieldsPrefixedWays = Core.parseSpatialSchedulePage({
  lines: [
    { text: 'PROJECT NAME Perryfields Academy PROJECT NUMBER 11274 Board reference DB-G1-LP' },
    { text: 'COMPONENTS DUTY CABLES' },
    { text: 'Way Phase Type AFDD Characteristic In (A) Earth fault device (mA) Load description' },
  ],
  words: perryfieldsPrefixedWayWords,
  pageWidth: 360,
  pageHeight: 210,
  pageType: 'db-schedule',
});
assert.equal(perryfieldsPrefixedWays.matched, true, 'Perryfields L-1/L-2 merged way cells must resolve as schedule ways');
assert.deepEqual(perryfieldsPrefixedWays.rows.map((row) => [row.way, row.phase, row.device, row.rating]), [
  ['L-1', 'L1', 'MCB', 10],
  ['L-1', 'L2', 'MCB', 10],
  ['L-1', 'L3', 'MCB', 10],
  ['L-2', 'L1', 'MCB', 10],
  ['L-2', 'L2', 'MCB', 10],
  ['L-2', 'L3', 'MCB', 10],
]);
const openSpaceCircuit = perryfieldsPrefixedWays.rows.find((row) => row.desc === 'Ltg: Open Space');
assert.equal(openSpaceCircuit.space, false, 'the word Space inside a populated load description must not create an empty way');
assert.equal(openSpaceCircuit.spare, false);
assert.equal(Core.isCountableProtectionDevice(openSpaceCircuit), true);
assert.equal(Core.protectionDeviceQuantity(openSpaceCircuit), 1);

assert.equal(Core.occupancyLabel('SPACE'), 'space');
assert.equal(Core.occupancyLabel('Fitted blank way'), 'space');
assert.equal(Core.occupancyLabel('SPARE'), 'spare');
assert.equal(Core.occupancyLabel('SP; ARE'), 'spare');
assert.equal(Core.occupancyLabel('SPARE 0'), 'spare');
assert.equal(Core.scheduleOccupancyLabel('1/L1 - - - - - - - - SPARE'), 'spare',
  'placeholder-only cells before a final occupancy label must remain readable');
assert.equal(Core.scheduleOccupancyLabel('5 L2 - - FITTED BLANK'), 'space');
assert.equal(Core.parseProtectionTableLine(
  '1/L1 - - - - - - - - SPARE',
  { headerText: 'Way Phase Type Rating Protection Load description' },
).spare, true);
assert.equal(Core.parseKnownScheduleLine('1/L1 - - - - - - - - SPARE').spare, true);
for (const description of ['Open Space next to dining', 'Spare office lighting', 'Blank Canvas room', 'Future Skills classroom']) {
  assert.equal(Core.occupancyLabel(description), null, `${description} is a circuit description, not an occupancy label`);
}
assert.equal(Core.scheduleOccupancyLabel('5 L2 MCB C 10 Open Space next to dining'), null,
  'a populated row description containing Space must not be treated as an empty way');

const flattenedOpenSpace = Core.parseProtectionTableLine(
  '5 L2 MCB No C 10 15 Ltg: Open Space next to dining Radial 1.5 1 1 E',
  { headerText: 'Way Phase Type AFDD Characteristic Rating Protection Load description' },
);
assert.equal(flattenedOpenSpace.device, 'MCB');
assert.equal(flattenedOpenSpace.space, false);

const fittedSpare = Core.reconcileRowOccupancy({
  device: 'MCB', rating: 10, curve: 'C', spare: true, space: false, qty: 1, conf: 0.94,
});
assert.equal(fittedSpare.occupancy, 'fitted_spare');
assert.equal(Core.isCountableProtectionDevice(fittedSpare), true, 'a fitted spare protective device remains part of the take-off');

const unresolvedFittedSpare = Core.reconcileRowOccupancy({
  device: null, rating: 16, curve: 'C', spare: true, space: false, qty: 1, conf: 0.94,
});
assert.equal(unresolvedFittedSpare.occupancy, 'fitted_spare_unresolved');
assert.equal(unresolvedFittedSpare.qty, 0, 'an unresolved device must not enter procurement totals');
assert.equal(unresolvedFittedSpare.requiresReview, true);
assert.equal(Core.isPopulatedProtectionRow(unresolvedFittedSpare), true,
  'partial protection evidence on a spare row must remain in extraction-health checks');
assert.equal(Core.isCountableProtectionDevice(unresolvedFittedSpare), false);

const conflictingSpace = Core.reconcileRowOccupancy({
  device: 'MCB', rating: 10, curve: 'C', spare: false, space: true, qty: 0, conf: 0.94,
});
assert.equal(conflictingSpace.space, false);
assert.equal(conflictingSpace.qty, 1);
assert.equal(conflictingSpace.requiresReview, true);
assert.match(conflictingSpace.occupancyConflict.reason, /populated protective-device evidence/i);
assert.equal(Core.reconcileRowOccupancy({ device: 'MCB', space: true, conf: 0.2 }).conf, 0.2,
  'occupancy reconciliation must never raise low source confidence');
const unresolvedSpace = Core.reconcileRowOccupancy({ device: null, rating: 20, space: true, spare: false, conf: 0.9 });
assert.equal(unresolvedSpace.space, true, 'partial evidence alone must not invent a fitted device');
assert.equal(unresolvedSpace.requiresReview, true);
assert.equal(Core.isPopulatedProtectionRow(unresolvedSpace), true);
assert.equal(Core.isCountableProtectionDevice(unresolvedSpace), false);

const unprovenGrid = Core.parseSpatialSchedulePage({
  lines: [{ text: 'LV SCHEMATIC' }],
  words: [
    word('Way', 20, 20), word('Device', 90, 20), word('Rating (A)', 160, 20),
    word('1', 20, 70), word('MCCB', 90, 70), word('125', 160, 70),
    word('2', 20, 100), word('MCCB', 90, 100), word('250', 160, 100),
  ],
  pageWidth: 300,
  pageHeight: 160,
  pageType: 'sld',
});
assert.equal(unprovenGrid.matched, false, 'a protection list without a circuit/description column is not a proven schedule grid');
assert.ok(unprovenGrid.grid.reasons.includes('circuit_column_missing'));
assert.equal(Core.isTakeoffEvidenceRow({ kind: 'schematic', sourceRole: 'schematic_feeder' }), false);
assert.equal(Core.isTakeoffEvidenceRow({ kind: 'schedule' }), true);
assert.equal(Core.selectAiRecoveryReason({ pageType: 'sld', schematicFeedCount: 25, boardReferenceCount: 30 }), null);
assert.equal(Core.selectAiRecoveryReason({ pageType: 'sld', schematicFeedCount: 0, boardReferenceCount: 3 }), 'schematic-topology-missing');
assert.equal(Core.selectAiRecoveryReason({ pageType: 'schematic', schematicFeedCount: 0, boardReferenceCount: 0 }), 'schematic-topology-missing');
assert.equal(Core.selectAiRecoveryReason({ pageType: 'db-schedule', scheduleCandidate: { score: 0.9, signals: ['way-sequence', 'column-header'] },
  scheduleRows: perryfields.rows, expectedWays: 3 }), null);
assert.equal(Core.selectAiRecoveryReason({ pageType: 'legend', scheduleCandidate: { score: 0.9, signals: ['device-tokens', 'rating-tokens'] },
  scheduleRows: [], expectedWays: 0 }), null, 'legend and drawing vocabulary must not trigger expensive schedule AI');

const recoveryPlan = Core.planAiRecoveryJobs(Array.from({ length: 40 }, (_, index) => ({
  id: 'perryfields',
  pageNo: index + 1,
  reason: index === 19 ? 'schedule-rows-missing' : index < 10 ? 'schedule-protection-fields-missing' : 'schedule-coverage-gap',
  unresolvedRatio: index / 40,
  candidateScore: 0.9,
})), { maxPages: 3 });
assert.equal(recoveryPlan.eligible, 40);
assert.equal(recoveryPlan.selected.length, 3, 'a large document must never create an unbounded enhanced-extraction batch');
assert.equal(recoveryPlan.deferred.length, 37);
assert.equal(recoveryPlan.selected[0].pageNo, 20, 'a page with no deterministic rows has first recovery priority');
assert.deepEqual(recoveryPlan.selected.slice(1).map((job) => job.pageNo), [10, 9], 'remaining pages are ordered by unresolved protection evidence');

const derivedCoverage = Core.buildCoverage({
  boards: { DBG9: { norm: 'DBG9', orig: 'DB-G9', type: 'DB', header: perryfields.board.header, pages: [{ fileId: 'perry', page: 1, primary: true }] } },
  rows: perryfields.rows.map((row) => ({ ...row, boardNorm: 'DBG9', fileId: 'perry', page: 1, kind: 'schedule', status: 'pending' })),
  pages: [{ fileId: 'perry', page: 1, text: perryfieldsText, type: 'db-schedule' }],
});
assert.equal(derivedCoverage.perBoard[0].expectedWays, 3);
assert.equal(derivedCoverage.perBoard[0].capturedWays, 3);

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
  DBSCHEMATIC: { norm: 'DBSCHEMATIC', orig: 'DB-SCHEMATIC', type: 'DB', takeoffEligible: false, schematicEvidence: true },
}, [
  ...Array.from({ length: 4 }, (_, index) => ({ id: `f${index}`, boardNorm: 'DBFUSE', device: 'Fuse', qty: 1, status: 'confirmed' })),
  { id: 'ok', boardNorm: 'DBOK', device: 'MCB', qty: 1, status: 'confirmed' },
]);
assert.equal(scoped.boards.MSDB01.inScope, false);
assert.ok(scoped.boards.MSDB01.outOfScopeReasons.includes('MSDB_ASSEMBLY'));
assert.equal(scoped.boards.DBFUSE.inScope, false);
assert.ok(scoped.boards.DBFUSE.outOfScopeReasons.includes('FOUR_OR_MORE_FUSE_OUTGOINGS'));
assert.equal(scoped.boards.DBOK.inScope, true);
assert.equal(scoped.boards.DBSCHEMATIC.inScope, false);
assert.ok(scoped.boards.DBSCHEMATIC.outOfScopeReasons.includes('SCHEMATIC_ONLY'));
assert.equal(scoped.rows.filter((row) => row.outOfScope).length, 4);

console.log('PASS: note links, alphanumeric ways, phase spans, bounded occupancy labels, document scoping, and take-off exclusions');
