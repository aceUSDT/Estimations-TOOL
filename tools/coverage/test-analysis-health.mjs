/* Tests for the analysis-health model (SmartScreen/device-recall addendum).
 * The regression that motivates all of this: a real project ("Hubert") showed
 * 7 boards / 0 devices under a green "Analysed" badge. That state must now be
 * impossible. Run: node tools/coverage/test-analysis-health.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// extractor-core is a browser global-style module; evaluate it onto a sandbox.
const sandbox = {};
new Function('globalThis', readFileSync(resolve(root, 'extractor-core.js'), 'utf8'))(sandbox);
const core = sandbox.EstimationExtractorCore;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err.message}`); }
}

const page = (over = {}) => ({
  fileId: 'f1', page: 1, type: 'db-schedule', textLines: 40,
  needsOcr: false, source: 'native_text', textQualityUnreliable: false,
  scheduleScore: 0.8, scheduleSignals: ['way-sequence', 'device-tokens'], rowsParsed: 12,
  takeoffEvidence: { activeRowsLikely: true, deviceRows: 12, occupancyRows: 0, rowLikeLines: 12 },
  ...over,
});
const row = (over = {}) => ({
  id: 'r', boardNorm: 'DB-01', fileId: 'f1', page: 1, device: 'MCB', qty: 1,
  status: 'pending', kind: 'schedule', way: 1, ...over,
});
const linkedBoard = (over = {}) => ({ parent: 'MAIN', ...over });

test('healthy analysis ⇒ complete with no reasons', () => {
  const h = core.buildAnalysisHealth({
    coverage: { perBoard: [{ norm: 'DB-01', inScope: true, rowsCaptured: 12, capturedWays: 12, expectedWays: 12, unaccountedWays: 0 }], summary: { expectedWays: 12, capturedWays: 12 } },
    boards: { 'DB-01': linkedBoard() },
    rows: Array.from({ length: 12 }, (_, i) => row({ way: i + 1 })),
    pages: [page()],
    files: [{ id: 'f1', status: 'ready' }],
  });
  assert.equal(h.state, 'complete');
  assert.equal(h.reasons.length, 0);
  assert.equal(h.counters.deviceCount, 12);
});

test('HUBERT REGRESSION: boards found + zero devices ⇒ failed, never complete', () => {
  const boards = {};
  for (let i = 1; i <= 7; i++) boards[`DB-0${i}`] = linkedBoard();
  const h = core.buildAnalysisHealth({
    coverage: {
      perBoard: Object.keys(boards).map((n) => ({ norm: n, inScope: true, rowsCaptured: 0, capturedWays: 0, expectedWays: null, unaccountedWays: null })),
      zeroRowSchedulePages: [{ fileId: 'f1', page: 1 }, { fileId: 'f1', page: 2 }],
      summary: { expectedWays: 0, capturedWays: 0 },
    },
    boards,
    rows: [],
    pages: [page({ rowsParsed: 0 }), page({ page: 2, rowsParsed: 0 })],
    files: [{ id: 'f1', status: 'ready' }],
  });
  assert.equal(h.state, 'failed');
  assert.ok(h.reasons.some((r) => r.code === 'ZERO_DEVICES_WITH_BOARDS'));
  assert.ok(h.reasons.some((r) => r.code === 'BOARD_ROWS_MISSING' && r.count === 7));
  assert.ok(h.reasons.some((r) => r.code === 'SCHEDULE_PAGE_UNPARSED' && r.count === 2));
});

test('header-only schedule pages are informational once board coverage reconciles', () => {
  const h = core.buildAnalysisHealth({
    coverage: { perBoard: [{ norm: 'DB-01', inScope: true, rowsCaptured: 12, capturedWays: 12, expectedWays: 12, unaccountedWays: 0 }], zeroRowSchedulePages: [], summary: { expectedWays: 12, capturedWays: 12 } },
    boards: { 'DB-01': linkedBoard() },
    rows: Array.from({ length: 12 }, (_, i) => row({ way: i + 1 })),
    pages: [page(), page({ page: 2, rowsParsed: 0, scheduleScore: 0.6,
      takeoffEvidence: { activeRowsLikely: false, deviceRows: 0, occupancyRows: 0, rowLikeLines: 0 } })],
    files: [{ id: 'f1', status: 'ready' }],
  });
  assert.equal(h.state, 'complete');
  assert.ok(!h.reasons.some((r) => r.code === 'SCHEDULE_PAGE_UNPARSED'));
});

test('a missing standalone schedule feed is advisory rather than a failed extraction', () => {
  const h = core.buildAnalysisHealth({
    coverage: { perBoard: [{ norm: 'DB-01', inScope: true, rowsCaptured: 12, capturedWays: 12,
      expectedWays: 12, unaccountedWays: 0 }], summary: { expectedWays: 12, capturedWays: 12 } },
    boards: { 'DB-01': {} },
    rows: Array.from({ length: 12 }, (_, i) => row({ way: i + 1 })),
    pages: [page()],
    files: [{ id: 'f1', status: 'ready' }],
  });
  assert.equal(h.state, 'incomplete');
  assert.ok(h.reasons.some((reason) => reason.code === 'BOARD_FEED_MISSING'));
});

test('an unresolved See LV Schematic feed remains advisory for schedule-only documents', () => {
  const h = core.buildAnalysisHealth({
    coverage: { perBoard: [{ norm: 'DB-01', inScope: true, rowsCaptured: 12, capturedWays: 12,
      expectedWays: 12, unaccountedWays: 0 }], summary: { expectedWays: 12, capturedWays: 12 } },
    boards: { 'DB-01': { header: { supplied_from_text: 'See LV Schematic' } } },
    rows: Array.from({ length: 12 }, (_, i) => row({ way: i + 1 })),
    pages: [page()],
    files: [{ id: 'f1', status: 'ready' }],
  });
  assert.equal(h.state, 'incomplete');
  assert.ok(h.reasons.some((reason) => reason.code === 'BOARD_FEED_MISSING'));
});

test('active outgoing rows with zero parser output remain a hard extraction gap', () => {
  const h = core.buildAnalysisHealth({
    coverage: {
      perBoard: [{ norm: 'DB-01', inScope: true, rowsCaptured: 12, capturedWays: 12, expectedWays: 18, unaccountedWays: 6 }],
      zeroRowSchedulePages: [{ fileId: 'f1', page: 2 }],
      summary: { expectedWays: 18, capturedWays: 12 },
    },
    boards: { 'DB-01': linkedBoard() },
    rows: Array.from({ length: 12 }, (_, i) => row({ way: i + 1 })),
    pages: [page(), page({ page: 2, rowsParsed: 0, scheduleScore: 0.6 })],
    files: [{ id: 'f1', status: 'ready' }],
  });
  assert.equal(h.state, 'incomplete');
  assert.ok(h.reasons.some((r) => r.code === 'SCHEDULE_PAGE_UNPARSED'));
  assert.ok(h.reasons.some((r) => r.code === 'WAYS_UNACCOUNTED'));
});

test('header promising more ways than captured ⇒ incomplete (WAYS_UNACCOUNTED)', () => {
  const h = core.buildAnalysisHealth({
    coverage: { perBoard: [{ norm: 'DB-01', inScope: true, rowsCaptured: 10, capturedWays: 10, expectedWays: 18, unaccountedWays: 8 }], summary: { expectedWays: 18, capturedWays: 10 } },
    boards: { 'DB-01': linkedBoard() },
    rows: Array.from({ length: 10 }, (_, i) => row({ way: i + 1 })),
    pages: [page({ rowsParsed: 10 })],
    files: [{ id: 'f1', status: 'ready' }],
  });
  assert.equal(h.state, 'incomplete');
  const reason = h.reasons.find((r) => r.code === 'WAYS_UNACCOUNTED');
  assert.ok(reason);
  assert.equal(reason.refs[0].expected, 18);
});

test('active rows missing protection details block export until confirmed', () => {
  const gapCoverage = {
    perBoard: [{ norm: 'DB-01', inScope: true, rowsCaptured: 2, capturedWays: 2, expectedWays: 2, unaccountedWays: 0, incompleteProtectionRows: 1 }],
    summary: { expectedWays: 2, capturedWays: 2 },
  };
  const h = core.buildAnalysisHealth({
    coverage: gapCoverage,
    boards: { 'DB-01': linkedBoard() },
    rows: [row(), row({ id: 'gap', way: 2, device: null, rating: null })],
    pages: [page({ rowsParsed: 2 })],
    files: [{ id: 'f1', status: 'ready' }],
  });
  assert.equal(h.state, 'incomplete');
  assert.ok(h.reasons.some((reason) => reason.code === 'PROTECTION_DETAILS_MISSING'));
});

test('pages awaiting OCR ⇒ incomplete (OCR_PENDING)', () => {
  const h = core.buildAnalysisHealth({
    coverage: { perBoard: [{ norm: 'DB-01', inScope: true, rowsCaptured: 5, capturedWays: 5, expectedWays: null, unaccountedWays: null }], summary: { expectedWays: 0, capturedWays: 0 } },
    boards: { 'DB-01': linkedBoard() },
    rows: [row()],
    pages: [page({ rowsParsed: 5 }), page({ page: 2, source: 'ocr_pending', needsOcr: true, rowsParsed: 0, scheduleScore: 0, scheduleSignals: [], type: 'unknown', textLines: 0 })],
    files: [{ id: 'f1', status: 'ready' }],
  });
  assert.equal(h.state, 'incomplete');
  assert.ok(h.reasons.some((r) => r.code === 'OCR_PENDING'));
});

test('unreadable document ⇒ incomplete (DOCUMENT_UNREADABLE)', () => {
  const h = core.buildAnalysisHealth({
    coverage: { perBoard: [{ norm: 'DB-01', inScope: true, rowsCaptured: 5, capturedWays: 5, expectedWays: null, unaccountedWays: null }], summary: { expectedWays: 0, capturedWays: 0 } },
    boards: { 'DB-01': linkedBoard() },
    rows: [row()],
    pages: [page({ rowsParsed: 5 })],
    files: [{ id: 'f1', status: 'ready' }, { id: 'f2', status: 'error' }],
  });
  assert.equal(h.state, 'incomplete');
  assert.ok(h.reasons.some((r) => r.code === 'DOCUMENT_UNREADABLE'));
});

test('no pages at all ⇒ failed (NO_CONTENT)', () => {
  const h = core.buildAnalysisHealth({ coverage: null, boards: {}, rows: [], pages: [], files: [] });
  assert.equal(h.state, 'failed');
  assert.ok(h.reasons.some((r) => r.code === 'NO_CONTENT'));
});

test('boardless rows, unproven grids, class conflicts, and invalid units fail closed', () => {
  const h = core.buildAnalysisHealth({
    coverage: { perBoard: [{ norm: 'DB-01', inScope: true, rowsCaptured: 1, capturedWays: 1, expectedWays: 1, unaccountedWays: 0 }], summary: { expectedWays: 1, capturedWays: 1 } },
    boards: { 'DB-01': linkedBoard() },
    rows: [row({ boardNorm: null, classConflict: { explicit: 'MCB', standardDevice: 'RCBO' }, poleConflict: { printedPhase: 'L1', descriptor: '3-4P' }, validation: { invalidSensitivity: true } })],
    pages: [page({ rowsParsed: 1, spatialGridAccepted: false, spatialBlockingReasons: ['primary_board_not_resolved'] })],
    files: [{ id: 'f1', status: 'ready' }],
  });
  assert.equal(h.state, 'failed');
  for (const code of ['UNASSIGNED_SCHEDULE_ROWS', 'SCHEDULE_GRID_UNPROVEN', 'PROTECTION_CLASS_CONFLICT', 'PHASE_POLE_CONFLICT', 'INVALID_PROTECTION_DOMAIN']) {
    assert.ok(h.reasons.some((reason) => reason.code === code), `missing ${code}`);
  }
});

test('schematic pages use feeder health and never masquerade as empty schedules', () => {
  const boards = {
    LVS1: { norm: 'LVS1', orig: 'LVS1', pages: [{ fileId: 's1', page: 1 }] },
    DBG9: { norm: 'DBG9', orig: 'DB-G9', pages: [{ fileId: 's1', page: 1 }], parent: 'LVS1' },
  };
  const rows = [];
  const coverage = core.buildCoverage({ boards, rows, pages: [{ fileId: 's1', page: 1, type: 'sld', text: 'LV SCHEMATIC DB-G9 250A MCCB' }] });
  assert.equal(coverage.summary.boards, 0);
  assert.equal(coverage.zeroRowSchedulePages.length, 0);
  const schematicPage = page({ fileId: 's1', type: 'sld', scheduleScore: 0.9, rowsParsed: 0,
    schematicTopologyMethod: 'pdf_vector_trace', schematicVectorStats: { segments: 2 },
    schematicUnresolvedBoards: [], schematicAmbiguousBoards: [], schematicGraphStats: { inferredBridges: 0 } });
  const healthy = core.buildAnalysisHealth({ coverage, boards, rows,
    pages: [schematicPage],
    files: [{ id: 's1', status: 'ready' }], feeders: [{ from: 'LVS1', to: 'DBG9', rating: 250 }] });
  assert.equal(healthy.state, 'complete');
  assert.ok(!healthy.reasons.some((reason) => reason.code === 'SCHEDULE_PAGE_UNPARSED'));
  const missingFeeds = core.buildAnalysisHealth({ coverage, boards, rows,
    pages: [schematicPage],
    files: [{ id: 's1', status: 'ready' }], feeders: [] });
  assert.equal(missingFeeds.state, 'failed');
  assert.ok(missingFeeds.reasons.some((reason) => reason.code === 'SCHEMATIC_FEEDS_MISSING'));
});

test('schematic topology uncertainty and cross-document conflicts fail closed', () => {
  const boards = {
    LVS1: { norm: 'LVS1', pages: [{ fileId: 's1', page: 1 }] },
    DBA: { norm: 'DBA', pages: [{ fileId: 's1', page: 1 }], parent: 'LVS1' },
  };
  const health = core.buildAnalysisHealth({
    coverage: core.buildCoverage({ boards, rows: [], pages: [{ fileId: 's1', page: 1, type: 'sld', text: 'LV SCHEMATIC' }] }),
    boards,
    rows: [],
    pages: [page({ fileId: 's1', type: 'sld', schematicTopologyMethod: 'none', schematicVectorStats: null,
      schematicUnresolvedBoards: ['DBA'], schematicAmbiguousBoards: ['DBA'] })],
    files: [{ id: 's1', status: 'ready' }],
    feeders: [{ from: 'LVS1', to: 'DBA' }],
    discrepancies: [{ kind: 'cable_mismatch', severity: 'high', status: 'open', scheduleNorm: 'DBA' }],
  });
  assert.equal(health.state, 'failed');
  for (const code of ['SCHEMATIC_VECTOR_GEOMETRY_MISSING', 'SCHEMATIC_TOPOLOGY_UNRESOLVED',
    'SCHEMATIC_TOPOLOGY_AMBIGUOUS', 'SCHEMATIC_SCHEDULE_CABLE_MISMATCH']) {
    assert.ok(health.reasons.some((reason) => reason.code === code), `missing ${code}`);
  }
});

test('schedule scoring: BAM-style schedule page scores as candidate', () => {
  const lines = [
    'DB REFERENCE: DB-01   18 WAY TP&N',
    'Way  Description        Device  Rating  Curve  Phase',
    '1    Lighting zone A    RCBO    32A     Type B  L1',
    '2    Lighting zone B    RCBO    32A     Type B  L2',
    '3    Small power        MCB     20A     Type B  L3',
    '4    Small power B      MCB     16A     Type B  L1',
    '5    AC unit            MCB     16A     Type C  L2',
  ];
  const s = core.scoreScheduleCandidate(lines);
  assert.ok(s.score >= 0.45, `score ${s.score}`);
  assert.ok(s.signals.length >= 2, `signals ${s.signals.join()}`);
});

test('schedule scoring: prose specification page does NOT qualify', () => {
  const lines = [
    'SECTION 5 — GENERAL REQUIREMENTS',
    'The contractor shall install all equipment in accordance with BS 7671.',
    'All cables shall be supported at intervals not exceeding those given in the code.',
    'Testing shall be witnessed and certificates provided on completion of the works.',
  ];
  const s = core.scoreScheduleCandidate(lines);
  assert.ok(!(s.score >= 0.45 && s.signals.length >= 2), `false positive: ${s.score} ${s.signals.join()}`);
});

test('diagnostic export contains NO document text, board names, or file names', () => {
  const health = core.buildAnalysisHealth({
    coverage: { perBoard: [{ norm: 'DB-KITCHEN-SECRET', inScope: true, rowsCaptured: 0, capturedWays: 0, expectedWays: 8, unaccountedWays: 8 }], summary: { expectedWays: 8, capturedWays: 0 } },
    boards: { 'DB-KITCHEN-SECRET': linkedBoard() },
    rows: [],
    pages: [page({ rowsParsed: 0 })],
    files: [{ id: 'f1', status: 'ready' }],
  });
  const diag = core.buildDiagnosticExport({
    health,
    coverage: { summary: { expectedWays: 8, capturedWays: 0 } },
    files: [{ id: 'f1', name: 'Hubert House - Kitchen DB schedule FINAL.pdf', ext: 'pdf', status: 'ready', pages: [{}] }],
    pages: [page({ rowsParsed: 0 })],
    appVersion: 'test',
  });
  const text = JSON.stringify(diag);
  assert.ok(!text.includes('Hubert'), 'file name leaked');
  assert.ok(!text.includes('KITCHEN'), 'board name leaked');
  assert.ok(text.includes('doc-1'), 'files must be anonymised, not dropped');
  assert.ok(text.includes('ZERO_DEVICES_WITH_BOARDS') || text.includes('BOARD_ROWS_MISSING'), 'reason codes must survive');
  assert.equal(diag.diagnosticVersion, 3);
  assert.equal(diag.privacy.shareableWithSupport, true);
  assert.ok(diag.pages[0].verdict.reasonCodes.includes('SCHEDULE_ROWS_ZERO'));
  assert.equal(diag.failureSummary.pagesWithTextButNoRows, 1);
  assert.ok(diag.reasonGuidance.SCHEDULE_ROWS_ZERO);
});

test('diagnostic v3 records attempts and page micro-metrics without leaking arbitrary fields', () => {
  const diag = core.buildDiagnosticExport({
    health: null,
    coverage: null,
    files: [{ id: 'secret-file', name: 'Secret Project.pdf', ext: 'pdf', status: 'ready', pages: [{}] }],
    pages: [page({
      fileId: 'secret-file', rowsParsed: 0, spatialColumns: ['way', 'rating'], spatialGridAccepted: false,
      spatialBlockingReasons: ['circuit_column_missing'], spatialWarnings: ['primary_board_not_resolved'],
      inputStats: { width: 841.89, height: 595.28, positionedLines: 38, spatialWords: 214, tableRows: 26, tableCells: 312 },
      boardResolved: false, boardOwnershipMethod: 'filename_reference_review',
      boardDetection: { referencesDetected: 3, primaryReferences: 0, circuitReferences: 3 },
      transposedSchedule: { matched: true, confidence: 0.88, roles: ['way', 'rating', 'phase'], wayCount: 24, fixedDeviceClass: 'MCB' },
      extractionAttempts: [{ strategy: 'geometry-strict', matched: false, rows: 0, confidence: 0.61, debugText: 'SECRET CUSTOMER CONTENT' }],
      rowOutcome: { unassignedRows: 7, reviewRows: 7 },
    })],
    appVersion: 'test-v2',
  });
  const exported = diag.pages[0];
  assert.equal(exported.input.spatialWords, 214);
  assert.equal(exported.input.tableCells, 312);
  assert.deepEqual(exported.spatial.missingRoles, ['circuit_reference_or_description']);
  assert.equal(exported.boardDetection.ownershipMethod, 'filename_reference_review');
  assert.deepEqual(exported.spatial.transposedProfile, {
    matched: true, confidence: 0.88, roles: ['way', 'rating', 'phase'], wayCount: 24, fixedDeviceClass: 'MCB',
  });
  assert.equal(exported.extractionAttempts[0].strategy, 'geometry-strict');
  assert.equal(exported.extractionAttempts[0].confidence, 0.61);
  assert.ok(exported.verdict.reasonCodes.includes('BOARD_REFERENCE_UNRESOLVED'));
  assert.ok(exported.verdict.reasonCodes.includes('OUTPUT_ROWS_UNASSIGNED'));
  assert.ok(!JSON.stringify(diag).includes('SECRET CUSTOMER CONTENT'));
  assert.ok(!JSON.stringify(diag).includes('Secret Project'));
});

test('take-off evidence detector separates table headers from outgoing rows and spare ways', () => {
  const header = core.detectScheduleTakeoffEvidence([
    'Board Data Board Rating (A): 125',
    'Spare: 30',
    'Overcurrent Protective Device Earth Fault Protective Device',
    'Rating (A) Trip Rating (A)',
  ]);
  assert.equal(header.activeRowsLikely, false);
  const active = core.detectScheduleTakeoffEvidence([
    '1 L1 Cbl_FC-5-FCL-5 Schneider Acti9 MCB iC60H Type C 10A',
    '2 L2 SPARE',
    '3 L3 60898 C 16 Lighting circuit',
  ]);
  assert.equal(active.activeRowsLikely, true);
  assert.equal(active.deviceRows, 2);
  assert.equal(active.occupancyRows, 1);
});

test('audited reconciled reports export past advisory page and topology diagnostics', () => {
  const readiness = core.buildReportExportReadiness({
    health: { state: 'failed', reasons: [
      { code: 'SCHEDULE_PAGE_UNPARSED', message: 'Page looks like a schedule but produced no rows', count: 1 },
      { code: 'BOARD_FEED_MISSING', message: 'Board feed is unresolved', count: 1 },
    ] },
    rows: [row({ status: 'confirmed' })],
    model: { reviewCount: 2, coverageIssueCount: 1, unassignedQty: 0, reconciliation: { valid: true } },
  });
  assert.equal(readiness.allowed, true);
  assert.equal(readiness.blockers.length, 0);
  assert.ok(readiness.warnings.some((item) => item.code === 'SCHEDULE_PAGE_UNPARSED'));
  assert.ok(readiness.warnings.some((item) => item.code === 'REPORT_ACCEPTED_QUALIFICATIONS'));
});

test('report readiness still blocks pending audit, key coverage gaps and invalid reconciliation', () => {
  const readiness = core.buildReportExportReadiness({
    health: { state: 'incomplete', reasons: [
      { code: 'WAYS_UNACCOUNTED', message: 'Ways are unaccounted', count: 2 },
    ] },
    rows: [row({ status: 'pending' })],
    model: { reviewCount: 1, unassignedQty: 1, reconciliation: { valid: false } },
    extractionGaps: 1,
  });
  assert.equal(readiness.allowed, false);
  for (const code of ['AUDIT_INCOMPLETE', 'EXTRACTION_GAPS_UNRESOLVED', 'WAYS_UNACCOUNTED', 'REPORT_UNASSIGNED_DEVICES', 'REPORT_RECONCILIATION_FAILED']) {
    assert.ok(readiness.blockers.some((item) => item.code === code), `missing ${code}`);
  }
});

test('every reason emitted by the model has a stable message in HEALTH_REASONS', () => {
  for (const code of ['ZERO_DEVICES_WITH_BOARDS', 'DEVICE_COUNT_BELOW_BOARD_COUNT', 'BOARD_ROWS_MISSING', 'WAYS_UNACCOUNTED', 'WAYS_OVER_CAPACITY', 'BOARD_FEED_MISSING', 'PROTECTION_DETAILS_MISSING', 'SCHEDULE_PAGE_UNPARSED', 'SCHEDULE_DOC_NO_BOARDS', 'UNASSIGNED_SCHEDULE_ROWS', 'SCHEDULE_GRID_UNPROVEN', 'PROTECTION_CLASS_CONFLICT', 'PHASE_POLE_CONFLICT', 'INVALID_PROTECTION_DOMAIN', 'SCHEMATIC_FEEDS_MISSING', 'PAGE_TEXT_UNRELIABLE', 'OCR_PENDING', 'DOCUMENT_UNREADABLE', 'NO_CONTENT']) {
    assert.ok(core.HEALTH_REASONS[code], `missing message for ${code}`);
  }
});

console.log(`\nanalysis-health tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
