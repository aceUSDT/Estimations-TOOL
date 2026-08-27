import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const fixture = path.resolve(process.argv[2] || path.join(ROOT, 'examples', 'db-schedules', 'bes', 'Kings-Road_G1-GF-DB-LL.pdf'));
assert.ok(fs.existsSync(fixture), `Missing PDF fixture: ${fixture}`);

const playwrightSpecifier = process.env.PLAYWRIGHT_CORE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_CORE_PATH).href
  : 'playwright-core';
const { chromium } = await import(playwrightSpecifier);
const appUrl = process.env.APP_URL || 'http://127.0.0.1:8773/?test=1';
const shotsDir = process.env.VIEWER_SHOTS_DIR || path.join(ROOT, '.codex-tmp', 'viewer-render-race');
await mkdir(shotsDir, { recursive: true });

const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => candidate && fs.existsSync(candidate));
assert.ok(executablePath, 'No Chromium-compatible browser executable was found');

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
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
  if (file && fs.existsSync(file)) await route.fulfill({ status: 200, contentType: mime(base), body: fs.readFileSync(file) });
  else await route.abort();
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
  await page.locator('#mName').fill('Viewer render race regression');
  await page.locator('#mOk').click();
  await page.setInputFiles('#fileInput', fixture);
  await page.waitForFunction(
    () => state.cur?.files?.length === 1 && state.cur.files[0].status === 'ready' && state.cur.files[0].pages.length >= 2
      && state.cur.files[0].pages.slice(0, 2).every((sourcePage) => (sourcePage.lines || []).some((line) => Array.isArray(line.bbox))),
    null,
    { timeout: 180000 },
  );
  await page.waitForFunction(() => Boolean(state.cur?.analysis) && analysisBusy === false, null, { timeout: 240000 });
  await page.waitForTimeout(50);
  if (await page.locator('#modalBk.show').isVisible()) {
    assert.equal(await page.locator('#mCancel').textContent(), 'Stay here', 'completed analysis must offer the Audit handoff');
    await page.locator('#mCancel').click();
    await page.locator('#modalBk').waitFor({ state: 'hidden' });
  }

  const seeded = await page.evaluate(async () => {
    const file = state.cur.files[0];
    const rowForPage = (pageNumber, id, way, phase) => {
      const sourcePage = file.pages[pageNumber - 1];
      const line = sourcePage.lines.findIndex((candidate) => Array.isArray(candidate.bbox) && Number(candidate.bbox[2]) > 20);
      if (line < 0) throw new Error(`No positioned line on page ${pageNumber}`);
      const source = sourcePage.lines[line];
      return {
        id, boardNorm: 'RACEBOARD', fileId: file.id, page: pageNumber, line,
        highlightBbox: source.bbox.slice(), bbox: source.bbox.slice(), srcText: source.text || `Page ${pageNumber}`,
        kind: 'schedule', way, phase, device: 'MCB', rating: 20, curve: 'C',
        poleConfiguration: 'SP', poles: 1, ka: 10, rcdProtected: false, afdd: false,
        spare: false, space: false, qty: 1, conf: 0.99, status: 'pending', requiresReview: false,
      };
    };
    const rows = [rowForPage(1, 'race-row-page-1', 1, 'L1'), rowForPage(2, 'race-row-page-2', 2, 'L2')];
    file.pages.slice(0, 2).forEach((sourcePage) => {
      sourcePage.type = 'db-schedule';
      sourcePage.threeType = 'db_schedule';
      sourcePage.conf = 1;
    });
    state.cur.analysis = {
      version: 21, ranAt: new Date().toISOString(),
      boards: { RACEBOARD: { norm: 'RACEBOARD', orig: 'RACE-BOARD', type: 'DB', inScope: true,
        pages: [{ fileId: file.id, page: 1, primary: true }, { fileId: file.id, page: 2, primary: false }], header: {} } },
      rows, cables: [], feeders: [], legend: [], discrepancies: [], coverage: null,
      pageDiagnostics: [1, 2].map((pageNumber) => ({
        fileId: file.id, page: pageNumber, type: 'db-schedule', scheduleScore: 1,
        textLines: file.pages[pageNumber - 1].lines.length, rowsParsed: 1, spatialBlockingReasons: [],
      })),
    };
    state.viewer.fileId = file.id;
    state.viewer.page = 1;
    state.viewer.boardHl = 'RACEBOARD';
    state.viewer.evidenceId = rows[0].id;
    ensureViewerPanels().rightOpen = true;
    await setTab('viewer');
    while (vThumbBusy) await new Promise((resolve) => setTimeout(resolve, 20));
    return { fileId: file.id, firstId: rows[0].id, secondId: rows[1].id };
  });

  await page.locator('#vStage canvas').waitFor({ timeout: 30000 });
  await page.waitForFunction((rowId) => document.querySelector('#vStage .attention[data-row-id]')?.dataset.rowId === rowId, seeded.firstId);

  const race = await page.evaluate(async ({ firstId, secondId, fileId }) => {
    const doc = state.viewer.pdfDocs[fileId];
    const originalGetPage = doc.getPage.bind(doc);
    let delayed = false;
    doc.getPage = async (pageNumber) => {
      const pdfPage = await originalGetPage(pageNumber);
      if (pageNumber === 1 && !delayed) {
        delayed = true;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return pdfPage;
    };
    state.viewer.page = 1;
    state.viewer.evidenceId = firstId;
    const staleRender = renderViewer();
    await new Promise((resolve) => setTimeout(resolve, 30));
    state.viewer.page = 2;
    state.viewer.evidenceId = secondId;
    const currentRender = renderViewer();
    await Promise.all([staleRender, currentRender]);
    doc.getPage = originalGetPage;
    return {
      page: state.viewer.page,
      pageLabel: document.querySelector('#vPageNo')?.textContent,
      evidenceId: state.viewer.evidenceId,
      renderSequence: viewerRenderSequence,
      committedSequence: viewerCommittedSequence,
      currentCardIds: [...document.querySelectorAll('#vDetList .det.current')].map((element) => element.dataset.rowId),
      attentionRowIds: [...document.querySelectorAll('#vStage .attention[data-row-id]')].map((element) => element.dataset.rowId),
      canvasReady: Boolean(document.querySelector('#vStage canvas')?.width && document.querySelector('#vStage canvas')?.height),
    };
  }, seeded);
  assert.equal(race.page, 2, 'newer Viewer navigation must keep page 2 active');
  assert.equal(race.pageLabel, '2', 'the visible page counter must belong to the latest render');
  assert.equal(race.evidenceId, seeded.secondId, 'evidence state must belong to the latest render');
  assert.equal(race.committedSequence, race.renderSequence, 'only the latest render may commit Viewer DOM');
  assert.deepEqual(race.currentCardIds, [seeded.secondId], 'the right list must retain the latest current row');
  assert.deepEqual(race.attentionRowIds, [seeded.secondId], 'the red source box must retain the latest current row');
  assert.ok(race.canvasReady, 'the latest PDF canvas must remain rendered');

  const guidedStart = await page.evaluate(async () => {
    state.cur.analysis.rows.forEach((row) => { row.status = 'pending'; });
    stopGuidedReview(false);
    await startGuidedReview();
    const queue = orderedPendingReviewRows();
    const gap = firstBlockingReviewGap(queue);
    return {
      active: state.reviewFlow.active,
      currentId: state.reviewFlow.currentRowId,
      evidenceId: state.viewer.evidenceId,
      queueIds: queue.map((row) => row.id),
      gap: gap ? { boardNorm: gap.boardNorm, page: gap.page } : null,
      currentCardIds: [...document.querySelectorAll('#vDetList .det.current')].map((element) => element.dataset.rowId),
      attentionRowIds: [...document.querySelectorAll('#vStage .attention[data-row-id]')].map((element) => element.dataset.rowId),
    };
  });
  assert.equal(guidedStart.active, true, `guided review must start: ${JSON.stringify(guidedStart)}`);
  assert.equal(guidedStart.currentId, seeded.firstId, `guided review must begin with page 1: ${JSON.stringify(guidedStart)}`);
  assert.equal(guidedStart.evidenceId, seeded.firstId, 'guided review evidence must begin with page 1');
  assert.deepEqual(guidedStart.currentCardIds, [seeded.firstId], 'guided review must select the page 1 evidence card');
  assert.deepEqual(guidedStart.attentionRowIds, [seeded.firstId], 'guided review must highlight the page 1 source row');
  await page.locator('#vDetList .det.current [data-action="approve"]').click();
  await page.waitForFunction((rowId) => viewerCommittedSequence === viewerRenderSequence
    && state.reviewFlow.currentRowId === rowId
    && state.viewer.evidenceId === rowId
    && document.querySelector('#vDetList .det.current')?.dataset.rowId === rowId
    && document.querySelector('#vStage .attention[data-row-id]')?.dataset.rowId === rowId, seeded.secondId);
  await page.waitForTimeout(750);

  const progression = await page.evaluate(() => ({
    currentId: state.reviewFlow.currentRowId,
    evidenceId: state.viewer.evidenceId,
    page: state.viewer.page,
    currentCardIds: [...document.querySelectorAll('#vDetList .det.current')].map((element) => element.dataset.rowId),
    attentionRowIds: [...document.querySelectorAll('#vStage .attention[data-row-id]')].map((element) => element.dataset.rowId),
  }));
  assert.equal(progression.currentId, seeded.secondId, 'Approve must advance guided review to the next PDF row');
  assert.equal(progression.evidenceId, seeded.secondId, 'Approve must synchronize Viewer evidence');
  assert.equal(progression.page, 2, 'Approve must navigate to the next row source page');
  assert.deepEqual(progression.currentCardIds, [seeded.secondId], 'Approve must move the right-list current state');
  assert.deepEqual(progression.attentionRowIds, [seeded.secondId], 'Approve must move the red document highlight');
  await page.screenshot({ path: path.join(shotsDir, 'viewer-render-race-fixed.png'), fullPage: false });

  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('; ')}`);
  console.log('PASS: stale PDF renders are discarded and guided approval keeps the source highlight and evidence list synchronized.');
} finally {
  await browser.close();
}
