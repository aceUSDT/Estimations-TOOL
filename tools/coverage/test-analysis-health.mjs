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
  ...over,
});
const row = (over = {}) => ({
  id: 'r', boardNorm: 'DB-01', fileId: 'f1', page: 1, device: 'MCB', qty: 1,
  status: 'pending', kind: 'schedule', way: 1, ...over,
});

test('healthy analysis ⇒ complete with no reasons', () => {
  const h = core.buildAnalysisHealth({
    coverage: { perBoard: [{ norm: 'DB-01', inScope: true, rowsCaptured: 12, capturedWays: 12, expectedWays: 12, unaccountedWays: 0 }], summary: { expectedWays: 12, capturedWays: 12 } },
    boards: { 'DB-01': {} },
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
  for (let i = 1; i <= 7; i++) boards[`DB-0${i}`] = {};
  const h = core.buildAnalysisHealth({
    coverage: { perBoard: Object.keys(boards).map((n) => ({ norm: n, inScope: true, rowsCaptured: 0, capturedWays: 0, expectedWays: null, unaccountedWays: null })), summary: { expectedWays: 0, capturedWays: 0 } },
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

test('schedule-looking pages with zero rows ⇒ incomplete even when other boards parsed', () => {
  const h = core.buildAnalysisHealth({
    coverage: { perBoard: [{ norm: 'DB-01', inScope: true, rowsCaptured: 12, capturedWays: 12, expectedWays: 12, unaccountedWays: 0 }], summary: { expectedWays: 12, capturedWays: 12 } },
    boards: { 'DB-01': {} },
    rows: Array.from({ length: 12 }, (_, i) => row({ way: i + 1 })),
    pages: [page(), page({ page: 2, rowsParsed: 0, scheduleScore: 0.6 })],
    files: [{ id: 'f1', status: 'ready' }],
  });
  assert.equal(h.state, 'incomplete');
  assert.ok(h.reasons.some((r) => r.code === 'SCHEDULE_PAGE_UNPARSED'));
});

test('header promising more ways than captured ⇒ incomplete (WAYS_UNACCOUNTED)', () => {
  const h = core.buildAnalysisHealth({
    coverage: { perBoard: [{ norm: 'DB-01', inScope: true, rowsCaptured: 10, capturedWays: 10, expectedWays: 18, unaccountedWays: 8 }], summary: { expectedWays: 18, capturedWays: 10 } },
    boards: { 'DB-01': {} },
    rows: Array.from({ length: 10 }, (_, i) => row({ way: i + 1 })),
    pages: [page({ rowsParsed: 10 })],
    files: [{ id: 'f1', status: 'ready' }],
  });
  assert.equal(h.state, 'incomplete');
  const reason = h.reasons.find((r) => r.code === 'WAYS_UNACCOUNTED');
  assert.ok(reason);
  assert.equal(reason.refs[0].expected, 18);
});

test('pages awaiting OCR ⇒ incomplete (OCR_PENDING)', () => {
  const h = core.buildAnalysisHealth({
    coverage: { perBoard: [{ norm: 'DB-01', inScope: true, rowsCaptured: 5, capturedWays: 5, expectedWays: null, unaccountedWays: null }], summary: { expectedWays: 0, capturedWays: 0 } },
    boards: { 'DB-01': {} },
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
    boards: { 'DB-01': {} },
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
    boards: { 'DB-KITCHEN-SECRET': {} },
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
});

test('every reason emitted by the model has a stable message in HEALTH_REASONS', () => {
  for (const code of ['ZERO_DEVICES_WITH_BOARDS', 'BOARD_ROWS_MISSING', 'WAYS_UNACCOUNTED', 'SCHEDULE_PAGE_UNPARSED', 'SCHEDULE_DOC_NO_BOARDS', 'PAGE_TEXT_UNRELIABLE', 'OCR_PENDING', 'DOCUMENT_UNREADABLE', 'NO_CONTENT']) {
    assert.ok(core.HEALTH_REASONS[code], `missing message for ${code}`);
  }
});

console.log(`\nanalysis-health tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
