/* Browser regression for a real schedule/schematic pair. The source documents
 * stay outside the repository and are supplied as command-line arguments.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const fixtures = process.argv.slice(2).map((fixture) => path.resolve(fixture));
assert.ok(fixtures.length, 'Pass at least one PDF to verify-real-viewer.mjs');
fixtures.forEach((fixture) => assert.ok(fs.existsSync(fixture), `Missing fixture: ${fixture}`));

const playwrightSpecifier = process.env.PLAYWRIGHT_CORE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_CORE_PATH).href
  : 'playwright-core';
const { chromium } = await import(playwrightSpecifier);
const appUrl = process.env.APP_URL || 'http://127.0.0.1:8765/?test=1';
const shotsDir = process.env.VIEWER_SHOTS_DIR || path.join(ROOT, '.codex-tmp', 'viewer-regression');
await mkdir(shotsDir, { recursive: true });

const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => candidate && fs.existsSync(candidate));
assert.ok(executablePath, 'No Chromium-compatible browser executable was found');

const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1600, height: 900 },
});
const page = await context.newPage();
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(String(error)));

const nodeModules = path.join(HERE, 'node_modules');
const vendor = path.join(HERE, 'vendor');
const mime = (file) => file.endsWith('.wasm') ? 'application/wasm'
  : file.endsWith('.gz') ? 'application/gzip'
    : 'application/javascript';
await page.route(/https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com)\/.*/, async (route) => {
  const base = route.request().url().split('?')[0].split('/').pop();
  let file = null;
  if (base === 'pdf.min.js' || base === 'pdf.worker.min.js') file = path.join(vendor, base);
  else if (base === 'tesseract.min.js') file = path.join(nodeModules, 'tesseract.js/dist/tesseract.min.js');
  else if (base === 'worker.min.js') file = path.join(nodeModules, 'tesseract.js/dist/worker.min.js');
  else if (base.startsWith('tesseract-core')) file = path.join(nodeModules, 'tesseract.js-core', base);
  else if (base.endsWith('.traineddata.gz')) file = path.join(vendor, 'eng.traineddata.gz');
  if (file && fs.existsSync(file)) {
    await route.fulfill({ status: 200, contentType: mime(base), body: fs.readFileSync(file) });
  } else {
    await route.abort();
  }
});

try {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined');
  if (await page.locator('#lockView.active').isVisible()) {
    await page.locator('#pwInput').fill('codex-production-smoke');
    await page.locator('#pwBtn').click();
    await page.locator('#appView.active').waitFor();
  }
  await page.locator('.proj-card.new').click();
  await page.locator('#mName').fill('Real Viewer regression');
  await page.locator('#mOk').click();
  await page.waitForFunction(() => state.cur?.name === 'Real Viewer regression');
  await page.setInputFiles('#fileInput', fixtures);
  await page.waitForFunction(
    (count) => state.cur?.files?.length === count && state.cur.files.every((file) => file.status === 'ready'),
    fixtures.length,
    { timeout: 120000 },
  );
  await page.waitForFunction(
    () => state.cur?.files?.every((file) => file.pages.every((sourcePage) => (sourcePage.lines || []).length)) && Boolean(state.cur?.analysis),
    null,
    { timeout: 300000 },
  );

  const extraction = await page.evaluate(() => {
    const scheduleRows = state.cur.analysis.rows.filter((row) => row.kind === 'schedule' && row.fileId);
    const first = orderedPendingReviewRows().find((row) => row.kind === 'schedule' && row.fileId);
    return {
      analysisVersion: state.cur.analysis.version,
      scheduleRows: scheduleRows.length,
      schematicPages: (state.cur.analysis.pageDiagnostics || []).filter((item) => item.type === 'sld' || item.type === 'schematic').length,
      schematicVectorSegments: (state.cur.analysis.pageDiagnostics || []).reduce((sum, item) => sum + Number(item.schematicVectorStats?.segments || 0), 0),
      schematicFeeds: state.cur.analysis.feeders.filter((feed) => String(feed.sourceRole || '').startsWith('schematic')).length,
      tracedSchematicFeeds: state.cur.analysis.feeders.filter((feed) => String(feed.sourceRole || '').startsWith('schematic')
        && feed.topologyMethod && Array.isArray(feed.path) && feed.path.length >= 2).length,
      unresolvedSchematicBoards: (state.cur.analysis.pageDiagnostics || []).reduce((sum, item) => sum + (item.schematicUnresolvedBoards || []).length, 0),
      linkedCrossReferences: (state.cur.analysis.discrepancies || []).filter((item) => item.kind === 'linked').length,
      firstId: first?.id || null,
      firstBoard: first?.boardNorm || null,
      firstPage: first?.page || null,
      health: state.cur.analysis.health,
    };
  });
  assert.equal(extraction.analysisVersion, 21, 'real project must use the current analysis model');
  assert.ok(extraction.scheduleRows > 0, 'schedule rows must be extracted before opening Viewer');
  assert.ok(extraction.firstId && extraction.firstBoard, 'guided review must have a first schedule row');
  assert.equal(extraction.firstPage, 1, 'guided review must begin on the earliest schedule page');
  if (extraction.schematicPages) {
    assert.ok(extraction.schematicVectorSegments > 100, 'schematic PDF vectors must be captured in the browser pipeline');
    assert.ok(extraction.schematicFeeds > 0, 'schematic feeder relationships must be extracted');
    assert.equal(extraction.tracedSchematicFeeds, extraction.schematicFeeds, 'every accepted schematic feed must carry path evidence');
    assert.equal(extraction.unresolvedSchematicBoards, 0, 'the supplied schematic must have no unresolved board endpoints');
    assert.ok(extraction.linkedCrossReferences > 0, 'at least one schematic board must link exactly to its supplied schedule');
  } else {
    assert.notEqual(extraction.health?.state, 'failed', 'schedule-only extraction health must not fail');
  }

  await page.evaluate(async (rowId) => {
    const row = state.cur.analysis.rows.find((candidate) => candidate.id === rowId);
    await jumpToEvidence(row);
  }, extraction.firstId);
  await page.locator('#vStage .v-pagewrap').waitFor({ timeout: 30000 });
  await page.locator('#vDetList .det[data-row-id]').first().waitFor();

  const viewer = await page.evaluate(() => {
    const wrap = document.querySelector('#vStage .v-pagewrap');
    const canvas = wrap?.querySelector('canvas');
    const wrapRect = wrap?.getBoundingClientRect();
    const overlays = [...document.querySelectorAll('#vStage .ovl[data-row-id]')].map((element) => {
      const rect = element.getBoundingClientRect();
      const row = state.cur.analysis.rows.find((candidate) => String(candidate.id) === element.dataset.rowId);
      return { id: element.dataset.rowId, way: row?.way ?? null, phase: row?.phase || null, device: row?.device || null,
        spare: Boolean(row?.spare), space: Boolean(row?.space),
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    }).sort((left, right) => left.top - right.top || left.left - right.left);
    const centresCoveredByPrior = overlays.slice(0, -1).filter((overlay, index) => {
      const next = overlays[index + 1];
      const nextCentre = next.top + next.height / 2;
      return nextCentre < overlay.bottom - 1;
    });
    return {
      board: document.querySelector('#vBoardHl')?.value || null,
      cards: document.querySelectorAll('#vDetList .det[data-row-id]').length,
      overlays: overlays.length,
      outsidePage: overlays.filter((overlay) => !wrapRect || overlay.left < wrapRect.left - 5 || overlay.top < wrapRect.top - 5 || overlay.right > wrapRect.right + 5 || overlay.bottom > wrapRect.bottom + 5).length,
      centresCoveredByPrior: centresCoveredByPrior.length,
      focused: document.querySelectorAll('#vStage .ovl.attention[data-row-id]').length,
      tallest: overlays.slice().sort((left, right) => right.height - left.height).slice(0, 4),
      canvasReady: Boolean(canvas && canvas.width > 0 && canvas.height > 0),
      meta: document.querySelector('#vMetaRow')?.textContent || '',
    };
  });
  assert.equal(viewer.board, extraction.firstBoard, 'Go to Board must match the displayed schedule board');
  assert.equal(viewer.cards, extraction.scheduleRows, 'every schedule row must appear in the Viewer evidence list');
  assert.equal(viewer.overlays, extraction.scheduleRows, 'every schedule row must have one precise document overlay');
  assert.equal(viewer.outsidePage, 0, 'row overlays must remain inside the rendered page');
  assert.equal(viewer.centresCoveredByPrior, 0, 'a row overlay must not cover the centre of the following row');
  assert.equal(viewer.focused, 1, 'only the selected row may use the red attention overlay');
  assert.ok(viewer.canvasReady, 'Viewer canvas must render nonblank dimensions');
  assert.doesNotMatch(viewer.meta, /Extraction incomplete/i, 'a parsed schedule must not be labelled incomplete');
  await page.screenshot({ path: path.join(shotsDir, 'real-viewer-desktop.png'), fullPage: false });

  await page.locator('#vReviewStart').click();
  await page.waitForFunction(() => state.reviewFlow.active && Boolean(state.reviewFlow.currentRowId));
  const guidedStart = await page.evaluate(() => ({
    currentId: state.reviewFlow.currentRowId,
    board: guidedReviewCurrentRow()?.boardNorm || null,
    selector: document.querySelector('#vBoardHl')?.value || null,
  }));
  assert.equal(guidedStart.currentId, extraction.firstId, 'guided review must start on the first pending row');
  assert.equal(guidedStart.board, extraction.firstBoard, 'guided review must start on the first schedule board');
  assert.equal(guidedStart.selector, guidedStart.board, 'Go to Board must follow guided review');

  await page.locator('#vDetList .det.current [data-action="approve"]').click();
  await page.waitForFunction((priorId) => state.reviewFlow.currentRowId !== priorId, guidedStart.currentId);
  const guidedNext = await page.evaluate(() => ({
    currentId: state.reviewFlow.currentRowId,
    board: guidedReviewCurrentRow()?.boardNorm || null,
    selector: document.querySelector('#vBoardHl')?.value || null,
  }));
  assert.notEqual(guidedNext.currentId, guidedStart.currentId, 'approval must advance to the next row automatically');
  assert.equal(guidedNext.board, guidedStart.board, 'review must finish the current board before moving to another board');
  assert.equal(guidedNext.selector, guidedNext.board, 'Go to Board must remain synchronised after auto-advance');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => renderViewer());
  await page.waitForTimeout(500);
  await page.locator('#vInfoToggle').click();
  await page.locator('#vInfoPanel:not(.is-closed)').waitFor();
  const mobile = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const toolbar = document.querySelector('.v-toolbar')?.getBoundingClientRect();
    const panel = document.querySelector('#vInfoPanel')?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - viewportWidth,
      toolbarInside: Boolean(toolbar && toolbar.left >= -1 && toolbar.right <= viewportWidth + 1),
      panelInside: Boolean(panel && panel.left >= -1 && panel.right <= viewportWidth + 1),
      currentVisible: Boolean(document.querySelector('#vDetList .det.current')),
      board: document.querySelector('#vBoardHl')?.value || null,
    };
  });
  assert.ok(mobile.overflow <= 1, `mobile Viewer has ${mobile.overflow}px horizontal overflow`);
  assert.ok(mobile.toolbarInside, 'mobile Viewer toolbar must stay inside the viewport');
  assert.ok(mobile.panelInside, 'mobile evidence panel must stay inside the viewport');
  assert.ok(mobile.currentVisible, 'current guided-review row must remain visible on mobile');
  assert.equal(mobile.board, guidedNext.board, 'mobile Go to Board must remain synchronised');
  await page.screenshot({ path: path.join(shotsDir, 'real-viewer-mobile.png'), fullPage: false });

  let schematicViewer = null;
  if (extraction.schematicPages) {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.evaluate(async () => {
      const diagnostic = state.cur.analysis.pageDiagnostics.find((item) => item.type === 'sld' || item.type === 'schematic');
      state.viewer.fileId = diagnostic.fileId;
      state.viewer.page = diagnostic.page;
      state.viewer.evidenceId = null;
      await renderViewer();
    });
    await page.locator('#vStage .schematic-path').first().waitFor({ timeout: 30000 });
    schematicViewer = await page.evaluate(() => {
      const paths = [...document.querySelectorAll('#vStage .schematic-path')];
      return {
        paths: paths.length,
        feederCards: document.querySelectorAll('#vDetList .det[data-kind="feeder"]').length,
        invalidPaths: paths.filter((element) => element.points.numberOfItems < 2).length,
        outsideCanvas: paths.filter((element) => {
          const box = element.getBBox();
          const view = element.ownerSVGElement?.viewBox?.baseVal;
          return !view || box.x < view.x - 1 || box.y < view.y - 1 || box.x + box.width > view.x + view.width + 1 || box.y + box.height > view.y + view.height + 1;
        }).length,
      };
    });
    assert.equal(schematicViewer.paths, extraction.schematicFeeds, 'each accepted schematic feed must render one selectable path');
    assert.equal(schematicViewer.feederCards, extraction.schematicFeeds, 'each schematic path must have a source-evidence card');
    assert.equal(schematicViewer.invalidPaths, 0, 'schematic path overlays must contain source and target points');
    assert.equal(schematicViewer.outsideCanvas, 0, 'schematic paths must remain inside the rendered page');
    await page.locator('#vStage .schematic-path').first().evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForFunction(() => Boolean(state.viewer.evidenceId));
    const selected = await page.locator('#vDetList .det[data-kind="feeder"].current').count();
    assert.equal(selected, 1, 'selecting a traced path must focus its evidence card');
    await page.screenshot({ path: path.join(shotsDir, 'real-schematic-paths.png'), fullPage: false });
  }

  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('; ')}`);
  console.log(JSON.stringify({ extraction, viewer, guidedStart, guidedNext, mobile, schematicViewer, shotsDir }, null, 2));
  console.log('PASS: real Viewer extraction, overlays, board sync, guided progression, and responsive layout.');
} finally {
  await browser.close();
}
