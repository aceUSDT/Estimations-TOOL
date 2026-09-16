import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { prepareReportFixture } from './browser-report-fixture.mjs';
import { createOrphanedTakeoff } from './fixtures/board-ownership-synthetic.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE_PATH
  ? pathToFileURL(join(process.env.PLAYWRIGHT_CORE_PATH, 'index.mjs')).href : 'playwright-core');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [], networkWrites = [], diagnostics = [];
page.on('pageerror', error => errors.push(String(error)));
await page.route('**/*', route => {
  if (!['GET', 'HEAD'].includes(route.request().method())) {
    networkWrites.push(route.request().method());
    return route.abort();
  }
  return route.continue();
});
const snapshot = () => page.evaluate(() => ({ stats: projStats(state.cur), health: state.cur.analysis.health.state,
  status: state.cur.status, readiness: currentReportExportReadiness().allowed,
  reportBoards: currentReportModel().boards.length,
  unassignedQty: currentReportModel().unassignedQty,
  issues: window.EstimationExtractorCore.buildBoardOwnership(state.cur.analysis).issues,
  blocked: state.cur.analysis.rows.filter(row => rowApprovalIssue(row)).length,
  queue: orderedPendingReviewRows().length }));
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:8774/?test=1&fixture=report', { waitUntil: 'domcontentloaded' });
  await prepareReportFixture(page);
  const id = await page.evaluate(async fixture => {
    const p = newProject('Synthetic orphaned take-off');
    p.files = [{ ...fixture.files[0], ext: 'txt', native: true, pages: fixture.pages.map(pg => ({
      w: 600, h: 800, type: 'unknown', source: 'native_text', needsOcr: false,
      lines: fixture.rows.filter(row => row.page === pg.page).map(row => ({ text: row.srcText, bbox: row.bbox }))
    })) }];
    p.analysis = { version: ANALYSIS_VERSION, calibrationRevision: 0, ranAt: 'synthetic',
      boards: fixture.boards, rows: fixture.rows, feeders: [], cables: [], discrepancies: [],
      pageDiagnostics: fixture.pages, health: { state: 'complete', reasons: [] } };
    p.status = 'Analysed'; state.projects.push(p); openProject(p.id);
    await putProjectRecord(p);
    return p.id;
  }, createOrphanedTakeoff());
  const first = await snapshot();
  assert.equal(first.stats.boards, 0);
  assert.equal(first.stats.devices, 238);
  assert.equal(first.stats.review, 254);
  assert.equal(first.stats.unassignedRows, 254);
  assert.equal(first.stats.unassignedPages, 2);
  assert.equal(first.health, 'failed');
  assert.equal(first.status, 'Analysis failed');
  assert.equal(first.readiness, false);
  assert.equal(first.reportBoards, 0);
  assert.equal(first.unassignedQty, 238);
  assert.equal(first.blocked, 254);
  assert.equal(first.queue, 254);
  diagnostics.push({ fixture: 'reported-counts-synthetic', beforeReload: first });
  assert.match(await page.locator('#projMeta').textContent(), /0 resolved boards.*254 unassigned rows on 2 pages/);
  await page.evaluate(() => setTab('analysis'));
  await page.locator('#healthOwnershipBtn').click();
  await page.locator('#eBoardNew').waitFor();
  assert.equal(await page.evaluate(() => state.viewer.page), 1);
  assert.equal(await page.locator('#eWay').inputValue(), '1');
  await page.locator('#mCancel').click();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(projectId => typeof state !== 'undefined' && state.projects.some(p => p.id === projectId), id);
  if (await page.locator('#lockView.active').isVisible()) {
    await page.locator('#pwInput').fill('codex-production-smoke');
    await page.locator('#pwBtn').click();
  }
  await page.evaluate(projectId => openProject(projectId), id);
  assert.deepEqual(await snapshot(), first, 'real IndexedDB save/reload must preserve ownership blockers and counts');
  await page.evaluate(() => setTab('analysis'));
  await page.locator('#healthOwnershipBtn').click();
  await page.locator('#eBoardNew').fill('DB-RECOVERED');
  await page.locator('#mOk').click();
  await page.waitForFunction(() => state.cur.analysis.rows[0].boardNorm === 'DBRECOVERED');
  const corrected = await snapshot();
  assert.equal(corrected.stats.boards, 1);
  assert.equal(corrected.stats.unassignedRows, 253, 'a correction must not silently bind unrelated rows');
  assert.equal(corrected.readiness, false, 'remaining unresolved rows still block issue');
  assert.equal(await page.evaluate(() => rowApprovalIssue(state.cur.analysis.rows[0])), null);
  diagnostics.push({ fixture: 'explicit-source-correction', result: corrected });

  const variants = [
    { name: 'header', file: 'synthetic.txt', headers: ['Board Reference: DB-HEADER'], expected: 'DBHEADER' },
    { name: 'downstream', file: 'synthetic.txt', headers: ['Board Reference: DB-PRIMARY'], expected: 'DBPRIMARY', downstream: true },
    { name: 'filename-only', file: 'DB-FILENAME.txt', headers: [], expected: null },
    { name: 'no-identity', file: 'synthetic.txt', headers: [], expected: null },
    { name: 'index-only', file: 'synthetic.txt', headers: ['Distribution Board Index: DB-INDEX'], expected: null },
    { name: 'continuation', file: 'synthetic.txt', headers: ['Board Reference: DB-CONT'], expected: 'DBCONT', continuation: true },
    { name: 'multiple-and-duplicate-ways', file: 'synthetic.txt', headers: ['Board Reference: DB-FIRST'], expected: 'DBFIRST', second: 'DB-SECOND' },
  ];
  for (const variant of variants) {
    const result = await page.evaluate(async variant => {
      const p = newProject(`Synthetic ownership ${variant.name}`); p.testFixture = true;
      const makePage = headers => ({ w: 600, h: 800, type: 'db-schedule', typeManual: true,
        source: 'native_text', needsOcr: false, lines: [
          'DISTRIBUTION BOARD SCHEDULE', ...headers, 'Way Phase Device Rating Circuit Description',
          `1 L1 20A SP MCB ${variant.downstream ? 'Connected To DB-CHILD' : 'Lighting'}`,
          '2 L2 32A SP MCB Sockets',
        ].map(text => ({ text })) });
      const pages = [makePage(variant.headers)];
      if (variant.continuation) pages.push(makePage([]));
      if (variant.second) pages.push(makePage([`Board Reference: ${variant.second}`]));
      p.files = [{ id: `synthetic-${variant.name}`, name: variant.file, ext: 'txt', status: 'ready', native: true, pages }];
      state.projects.push(p); state.cur = p;
      const A = await runAnalysis({ auto: true, noAi: true });
      return { rows: A.rows.filter(row => row.kind === 'schedule'), boards: A.boards,
        ownership: window.EstimationExtractorCore.buildBoardOwnership(A),
        pages: A.pageDiagnostics, health: A.health.state, allowed: currentReportExportReadiness().allowed };
    }, variant);
    diagnostics.push({ fixture: variant.name, ...result });
    assert.ok(result.rows.length >= 2, `${variant.name}: source rows must actually be parsed`);
    if (variant.expected) {
      assert.equal(result.rows[0].boardNorm, variant.expected);
      assert.equal(result.ownership.unassignedRowCount, 0, `${variant.name}: evidenced owners must remain usable`);
    } else {
      assert.equal(result.ownership.resolvedBoardCount, 0);
      assert.equal(result.ownership.unassignedRowCount, result.rows.length);
      assert.equal(result.health, 'failed');
      assert.equal(result.allowed, false);
    }
    if (variant.downstream) assert.equal(result.ownership.resolvedBoardCount, 1, 'connected-to reference cannot become an owning board');
    if (variant.continuation) {
      assert.equal(result.pages[1].boardOwnershipMethod, 'previous_schedule_page');
      assert.equal(result.pages[1].boardOwnershipSourcePage, 1);
      assert.ok(result.rows.every(row => row.boardNorm === 'DBCONT'));
    }
    if (variant.second) assert.equal(result.ownership.resolvedBoardCount, 2);
  }
  assert.deepEqual(networkWrites, [], 'synthetic acceptance must never submit extraction/customer data');
  assert.deepEqual(errors, []);
  console.log('PASS: zero-board/238-device invariant, source correction path, IndexedDB reload, header/continuation/multiple/duplicate/downstream/filename/unassigned ownership.');
} finally {
  if (process.env.OWNERSHIP_EVIDENCE_PATH) await writeFile(process.env.OWNERSHIP_EVIDENCE_PATH,
    JSON.stringify({ syntheticOnly: true, diagnostics, errors, networkWrites }, null, 2) + '\n', { flag: 'wx' });
  await browser.close();
}
