import assert from 'node:assert/strict';
import test from 'node:test';

await import('../../extractor-core.js');

const Core = globalThis.EstimationExtractorCore;

function page(overrides = {}) {
  return {
    fileId: 'f1',
    page: 1,
    type: 'db-schedule',
    text: 'DISTRIBUTION BOARD SCHEDULE',
    textLines: 40,
    needsOcr: false,
    source: 'native_text',
    textQualityUnreliable: false,
    scheduleScore: 0.8,
    scheduleSignals: ['way-sequence', 'device-tokens'],
    rowsParsed: 1,
    ...overrides,
  };
}

function board(norm, overrides = {}) {
  return {
    norm,
    orig: norm,
    parent: 'MAIN',
    pages: [{ fileId: 'f1', page: 1, primary: true }],
    ...overrides,
  };
}

function row(id, boardNorm, overrides = {}) {
  return {
    id,
    boardNorm,
    fileId: 'f1',
    page: 1,
    kind: 'schedule',
    way: 1,
    device: 'MCB',
    rating: 16,
    qty: 1,
    status: 'pending',
    ...overrides,
  };
}

function completeCoverage(boardNorms, ways = 1) {
  return {
    perBoard: boardNorms.map((norm) => ({
      norm,
      inScope: true,
      rowsCaptured: ways,
      protectionRows: ways,
      incompleteProtectionRows: 0,
      capturedWays: ways,
      expectedWays: ways,
      unaccountedWays: 0,
    })),
    zeroRowSchedulePages: [],
    summary: {
      boards: boardNorms.length,
      boardsWithRows: boardNorms.length,
      expectedWays: boardNorms.length * ways,
      capturedWays: boardNorms.length * ways,
    },
  };
}

function hasReason(health, code) {
  return health.reasons.some((reason) => reason.code === code);
}

test('T-33 rejects the observed 29-board / 18-device result', () => {
  const boardNorms = Array.from({ length: 29 }, (_, index) => `DB-${String(index + 1).padStart(2, '0')}`);
  const boards = Object.fromEntries(boardNorms.map((norm) => [norm, board(norm)]));
  const rows = Array.from({ length: 18 }, (_, index) => row(`r-${index + 1}`, boardNorms[index]));

  const health = Core.buildAnalysisHealth({
    coverage: completeCoverage(boardNorms),
    boards,
    rows,
    pages: [page({ rowsParsed: rows.length })],
    files: [{ id: 'f1', status: 'ready' }],
  });

  assert.equal(health.counters.boards, 29);
  assert.equal(health.counters.deviceCount, 18);
  assert.equal(health.state, 'failed', 'device count below board count must refuse the analysis result');
  assert.ok(hasReason(health, 'DEVICE_COUNT_BELOW_BOARD_COUNT'), 'missing stable device/board coherence reason');
});

test('T-33 rejects populated plus spare ways above the stated board total', () => {
  const norm = 'DB-OVER-CAPACITY';
  const boards = { [norm]: board(norm) };
  const rows = [
    ...Array.from({ length: 6 }, (_, index) => row(`active-${index + 1}`, norm, { way: index + 1 })),
    row('spare-7', norm, { way: 7, device: null, rating: null, spare: true }),
    row('spare-8', norm, { way: 8, device: null, rating: null, spare: true }),
  ];
  const pages = [page({
    text: 'DISTRIBUTION BOARD DB-OVER-CAPACITY\n6 WAY TP&N\nWay Device Rating',
    rowsParsed: rows.length,
  })];
  const coverage = Core.buildCoverage({ boards, rows, pages });

  assert.equal(coverage.perBoard[0].expectedWays, 6);
  assert.equal(coverage.perBoard[0].capturedWays, 8);

  const health = Core.buildAnalysisHealth({
    coverage,
    boards,
    rows,
    pages,
    files: [{ id: 'f1', status: 'ready' }],
  });

  assert.equal(health.state, 'failed', 'ways above the board capacity must refuse the analysis result');
  assert.ok(hasReason(health, 'WAYS_OVER_CAPACITY'), 'missing stable over-capacity coherence reason');
});

test('T-33 records an unresolved standalone feed without discarding valid schedule take-off', () => {
  const norm = 'DB-NO-FEED';
  const boards = { [norm]: board(norm, { parent: null, header: { fed_from_ref: 'RAW-TEXT-ONLY' } }) };
  const rows = [row('r-1', norm)];
  const coverage = completeCoverage([norm]);
  const input = {
    coverage,
    boards,
    rows,
    pages: [page()],
    files: [{ id: 'f1', status: 'ready' }],
  };

  const health = Core.buildAnalysisHealth(input);
  assert.equal(health.state, 'incomplete', 'raw supplied-from text must remain unresolved without invalidating valid schedule rows');
  assert.ok(hasReason(health, 'BOARD_FEED_MISSING'), 'missing stable feed-coherence reason');

  const explicitlyOrphaned = Core.buildAnalysisHealth({
    ...input,
    boards: { [norm]: board(norm, { parent: null, orphaned: true }) },
  });
  assert.equal(explicitlyOrphaned.state, 'complete', 'an explicit orphaned flag must satisfy the gate');
  assert.ok(!hasReason(explicitlyOrphaned, 'BOARD_FEED_MISSING'));
});
