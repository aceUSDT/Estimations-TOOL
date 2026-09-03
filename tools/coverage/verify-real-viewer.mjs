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
const expectedHealthReasons = new Set(String(process.env.EXPECTED_HEALTH_REASONS || '')
  .split(',').map((value) => value.trim()).filter(Boolean));
const expectedFirstPage = Math.max(1, Number(process.env.EXPECTED_FIRST_PAGE || 1));

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

const browser = await chromium.launch({ executablePath, headless: true });
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
    const sourcePage = state.cur.files[0]?.pages?.[0];
    const spatialProbe = window.EstimationExtractorCore?.parseSpatialSchedulePage?.({
      lines: sourcePage?.lines || [],
      tableRows: sourcePage?.tableRows || [],
      pageWidth: sourcePage?.w,
      pageHeight: sourcePage?.h,
      pageType: sourcePage?.type,
    });
    const issueCounts = {};
    scheduleRows.forEach((row) => {
      const issue = rowApprovalIssue(row) || 'none';
      issueCounts[issue] = (issueCounts[issue] || 0) + 1;
    });
    scheduleRows.filter((row) => !rowApprovalIssue(row)).forEach((row) => { row.status = 'pending'; });
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
      firstPageRows: first ? scheduleRows.filter((row) => row.fileId === first.fileId
        && Number(row.page) === Number(first.page)).length : 0,
      issueCounts,
      pageInput: {
        type: sourcePage?.type || null,
        lineCount: sourcePage?.lines?.length || 0,
        wordCount: (sourcePage?.lines || []).reduce((sum, line) => sum + (line.words?.length || 0), 0),
        tokenGeometry: (sourcePage?.lines || []).flatMap((line) => line.words || [])
          .filter((word) => /^(?:DB-?2|WAY|PHASE|MCB|50|125)$/i.test(String(word.text || '')))
          .slice(0, 20).map((word) => ({ text: word.text, bbox: word.bbox, rotation: word.rotation })),
      },
      spatialProbe: spatialProbe ? {
        matched: spatialProbe.matched,
        dialect: spatialProbe.dialect || spatialProbe.schema?.dialect || null,
        board: spatialProbe.board?.ref || null,
        rows: spatialProbe.rows?.length || 0,
        warnings: spatialProbe.warnings || [],
      } : null,
      pageDiagnostics: (state.cur.analysis.pageDiagnostics || []).map((diagnostic) => ({
        page: diagnostic.page,
        type: diagnostic.type,
        rowsParsed: diagnostic.rowsParsed,
        spatialMatched: diagnostic.spatialMatched,
        spatialDialect: diagnostic.spatialDialect,
        spatialBlockingReasons: diagnostic.spatialBlockingReasons,
        spatialWarnings: diagnostic.spatialWarnings,
        boardResolved: diagnostic.boardResolved,
      })),
      rowSample: scheduleRows.slice(0, 5).map((row) => ({
        boardNorm: row.boardNorm || null,
        device: row.device || null,
        rating: row.rating ?? null,
        status: row.status || null,
        outOfScope: Boolean(row.outOfScope),
        issue: rowApprovalIssue(row),
      })),
      health: state.cur.analysis.health,
    };
  });
  if (process.env.VERBOSE_PRIVATE === '1') {
    console.log(JSON.stringify(await page.evaluate(() => state.cur.files.map((file) => ({
      name: file.name,
      pages: file.pages.map((sourcePage, index) => ({ page: index + 1, type: sourcePage.type,
        lines: (sourcePage.lines || []).map((line) => line.text) })),
    }))), null, 2));
  }
  assert.equal(extraction.analysisVersion, 29, 'real project must use the current analysis model');
  assert.ok(extraction.scheduleRows > 0,
    `schedule rows must be extracted before opening Viewer: ${JSON.stringify({ pageInput: extraction.pageInput,
      spatialProbe: extraction.spatialProbe, pageDiagnostics: extraction.pageDiagnostics, health: extraction.health })}`);
  assert.ok(extraction.firstId && extraction.firstBoard,
    `guided review must have a first schedule row: ${JSON.stringify({ issueCounts: extraction.issueCounts, rowSample: extraction.rowSample,
      pageInput: extraction.pageInput, spatialProbe: extraction.spatialProbe })}`);
  assert.equal(extraction.firstPage, expectedFirstPage, 'guided review must begin on the earliest schedule page');
  if (extraction.schematicPages) {
    assert.ok(extraction.schematicVectorSegments > 100, 'schematic PDF vectors must be captured in the browser pipeline');
    assert.ok(extraction.schematicFeeds > 0, 'schematic feeder relationships must be extracted');
    assert.equal(extraction.tracedSchematicFeeds, extraction.schematicFeeds, 'every accepted schematic feed must carry path evidence');
    assert.equal(extraction.unresolvedSchematicBoards, 0, 'the supplied schematic must have no unresolved board endpoints');
    assert.ok(extraction.linkedCrossReferences > 0, 'at least one schematic board must link exactly to its supplied schedule');
  } else {
    const healthCodes = new Set((extraction.health?.reasons || []).map((reason) => reason.code));
    const unexpected = [...healthCodes].filter((code) => !expectedHealthReasons.has(code));
    if (extraction.health?.state === 'failed') {
      assert.ok(expectedHealthReasons.size > 0 && unexpected.length === 0,
        `schedule-only extraction health must not fail unexpectedly: ${JSON.stringify({ health: extraction.health, pageDiagnostics: extraction.pageDiagnostics })}`);
    }
    expectedHealthReasons.forEach((code) => assert.ok(healthCodes.has(code), `expected health reason ${code} was not emitted`));
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
  assert.equal(viewer.cards, extraction.firstPageRows, 'every row on the current page must appear in the Viewer evidence list');
  assert.equal(viewer.overlays, extraction.firstPageRows, 'every row on the current page must have one precise document overlay');
  assert.equal(viewer.outsidePage, 0, 'row overlays must remain inside the rendered page');
  assert.equal(viewer.centresCoveredByPrior, 0, 'a row overlay must not cover the centre of the following row');
  assert.equal(viewer.focused, 1, 'only the selected row may use the red attention overlay');
  assert.ok(viewer.canvasReady, 'Viewer canvas must render nonblank dimensions');
  assert.doesNotMatch(viewer.meta, /Extraction incomplete/i, 'a parsed schedule must not be labelled incomplete');
  if (extraction.spatialProbe?.dialect === 'trimble_cable_schedule') {
    assert.match(viewer.meta, /Cable Schedule/i, 'a structurally proven cable schedule must not remain labelled as a specification');
  }
  await page.screenshot({ path: path.join(shotsDir, 'real-viewer-desktop.png'), fullPage: false });

  if (await page.locator('#modalBk.show').isVisible()) {
    assert.match(await page.locator('#mHead').textContent(), /Analysis .*audit/i,
      'the post-analysis prompt must offer the Audit workflow');
    await page.locator('#mOk').click();
  } else {
    await page.locator('#vReviewStart').click();
  }
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
  await page.waitForFunction(() => {
    const currentId = state.reviewFlow.currentRowId;
    return viewerCommittedSequence === viewerRenderSequence
      && state.viewer.evidenceId === currentId
      && document.querySelector('#vDetList .det.current')?.dataset.rowId === currentId
      && document.querySelector('#vStage .attention[data-row-id]')?.dataset.rowId === currentId;
  });
  await page.waitForTimeout(750);
  const guidedNext = await page.evaluate(() => ({
    currentId: state.reviewFlow.currentRowId,
    board: guidedReviewCurrentRow()?.boardNorm || null,
    selector: document.querySelector('#vBoardHl')?.value || null,
    evidenceId: state.viewer.evidenceId,
    currentCardIds: [...document.querySelectorAll('#vDetList .det.current')].map((element) => element.dataset.rowId),
    attentionRowIds: [...document.querySelectorAll('#vStage .attention[data-row-id]')].map((element) => element.dataset.rowId),
  }));
  assert.notEqual(guidedNext.currentId, guidedStart.currentId, 'approval must advance to the next row automatically');
  assert.equal(guidedNext.board, guidedStart.board, 'review must finish the current board before moving to another board');
  assert.equal(guidedNext.selector, guidedNext.board, 'Go to Board must remain synchronised after auto-advance');
  assert.equal(guidedNext.evidenceId, guidedNext.currentId, 'Viewer evidence state must follow the guided row');
  assert.deepEqual(guidedNext.currentCardIds, [guidedNext.currentId], 'the right evidence list must move to exactly one current row');
  assert.deepEqual(guidedNext.attentionRowIds, [guidedNext.currentId], 'the red source highlight must move to exactly one current row');

  await page.evaluate(async () => { state.viewer.rot = 90; await renderViewer(); });
  await page.waitForFunction(() => viewerCommittedSequence === viewerRenderSequence
    && document.querySelector('#vStage .v-pagewrap canvas')?.height > 0
    && document.querySelector('#vStage .attention[data-row-id]'));
  const rotatedViewer = await page.evaluate(() => {
    const wrap = document.querySelector('#vStage .v-pagewrap');
    const attention = document.querySelector('#vStage .attention[data-row-id]');
    const pageBox = wrap?.getBoundingClientRect();
    const evidenceBox = attention?.getBoundingClientRect();
    return {
      rotation: state.viewer.rot,
      portrait: Boolean(pageBox && pageBox.height > pageBox.width),
      evidenceInside: Boolean(pageBox && evidenceBox && evidenceBox.left >= pageBox.left - 5
        && evidenceBox.top >= pageBox.top - 5 && evidenceBox.right <= pageBox.right + 5
        && evidenceBox.bottom <= pageBox.bottom + 5),
      currentId: attention?.dataset.rowId || null,
    };
  });
  assert.equal(rotatedViewer.rotation, 90, 'real Viewer must retain the requested page rotation');
  assert.ok(rotatedViewer.portrait, 'the landscape source page must render portrait after a 90 degree rotation');
  assert.ok(rotatedViewer.evidenceInside, 'the current evidence overlay must stay inside the rotated real PDF page');
  assert.equal(rotatedViewer.currentId, guidedNext.currentId, 'rotation must not change the current audit row');
  await page.screenshot({ path: path.join(shotsDir, 'real-viewer-rotated.png'), fullPage: false });
  await page.evaluate(async () => { state.viewer.rot = 0; await renderViewer(); });
  await page.waitForFunction(() => viewerCommittedSequence === viewerRenderSequence
    && document.querySelector('#vStage .attention[data-row-id]'));

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

  await page.setViewportSize({ width: 1600, height: 900 });
  const calibrationReanalysis = await page.evaluate(async () => {
    const project = state.cur;
    const beforeCount = project.analysis.rows.filter(isCountedDeviceRow).reduce((sum, row) => sum + countedRowQuantity(row), 0);
    const beforeConfirmed = project.analysis.rows.filter((row) => row.status === 'confirmed').length;
    const source = project.analysis.rows.find((row) => row.kind === 'schedule' && row.fieldSources?.rating?.bbox);
    if (!source) throw new Error('real fixture has no source-linked rating field for calibration');
    const file = project.files.find((item) => item.id === source.fileId);
    const pageRecord = file.pages[source.page - 1];
    const [x, y, width, height] = source.fieldSources.rating.bbox;
    const pageWidth = Number(pageRecord.w); const pageHeight = Number(pageRecord.h);
    const definition = allCalibrationDefinitions().find((item) => item.role === 'rating');
    const bbox = [Math.max(0, x - 3), Math.max(0, y - 3), width + 6, height + 6];
    project.calibrations = [{
      id: 'real-rating-calibration', fileId: file.id, sourcePage: source.page, scope: 'following',
      role: 'rating', kind: definition.kind,
      bboxNorm: [bbox[0] / pageWidth, bbox[1] / pageHeight, bbox[2] / pageWidth, bbox[3] / pageHeight],
      signature: window.EstimationExtractorCore.buildCalibrationSignature(
        { ...pageRecord, pageWidth, pageHeight }, { role: 'rating', bbox }),
      axis: 'column', sourcePageType: pageRecord.type,
      sourceWidth: pageWidth, sourceHeight: pageHeight,
      orientation: pageWidth >= pageHeight ? 'landscape' : 'portrait',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }];
    project.calibrationRevision = Number(project.calibrationRevision || 0) + 1;
    state.viewer.calibration.dirty = true;
    state.viewer.fileId = file.id; state.viewer.page = source.page;
    saveProject(project);
    await applyCalibrations();
    const afterCount = project.analysis.rows.filter(isCountedDeviceRow).reduce((sum, row) => sum + countedRowQuantity(row), 0);
    const afterConfirmed = project.analysis.rows.filter((row) => row.status === 'confirmed').length;
    const diagnostics = project.analysis.pageDiagnostics.filter((item) => item.fileId === file.id
      && Number(item.calibration?.applicable) > 0);
    return {
      beforeCount, afterCount, beforeConfirmed, afterConfirmed,
      dirty: state.viewer.calibration.dirty,
      revision: project.calibrationRevision,
      analysisRevision: project.analysis.calibrationRevision,
      applicablePages: diagnostics.length,
      appliedPages: diagnostics.filter((item) => Number(item.calibration?.applied) > 0).length,
      projections: diagnostics.flatMap((item) => item.calibration?.projections || []).map((item) => item.projection),
      savedRecords: project.calibrations.map((record) => ({ fileId: record.fileId, sourcePage: record.sourcePage,
        sourcePageType: record.sourcePageType, scope: record.scope, role: record.role })),
      pageCalibration: project.analysis.pageDiagnostics.filter((item) => item.fileId === file.id)
        .map((item) => ({ page: item.page, type: item.type, calibration: item.calibration })),
    };
  });
  assert.equal(calibrationReanalysis.dirty, false, 'successful calibration re-analysis must clear the pending state');
  assert.equal(calibrationReanalysis.analysisRevision, calibrationReanalysis.revision, 'analysis must commit the active calibration revision');
  assert.equal(calibrationReanalysis.afterCount, calibrationReanalysis.beforeCount, 'calibration re-analysis must preserve reconciled device counts');
  assert.ok(calibrationReanalysis.afterConfirmed >= calibrationReanalysis.beforeConfirmed, 'calibration re-analysis must preserve prior approvals');
  assert.ok(calibrationReanalysis.applicablePages > 0,
    `saved calibration must reach at least one document page: ${JSON.stringify(calibrationReanalysis)}`);
  assert.ok(calibrationReanalysis.appliedPages > 0, 'saved calibration must be consumed by the spatial parser');

  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('; ')}`);
  console.log(JSON.stringify({ extraction, viewer, guidedStart, guidedNext, rotatedViewer, mobile, schematicViewer, calibrationReanalysis, shotsDir }, null, 2));
  console.log('PASS: real Viewer extraction, overlays, board sync, guided progression, calibration re-analysis, and responsive layout.');
} finally {
  await browser.close();
}
