import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const appUrl = process.env.APP_URL || 'http://127.0.0.1:8773/?test=1&fixture=report';
const shotsDir = process.env.VIEWER_SHOTS_DIR || '';
const playwright = process.env.PLAYWRIGHT_CORE_PATH
  ? await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE_PATH, 'index.mjs')).href)
  : await import('playwright-core');
const { chromium } = playwright;

if (shotsDir) await mkdir(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(String(error)));

try {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.projects.length >= 2);
  await page.locator('.proj-card', { hasText: 'Riverside Office Fit-Out' }).click();
  await page.locator('.ptab[data-pt="viewer"]').click();
  await page.waitForFunction(() => typeof state !== 'undefined' && state.cur?.analysis?.rows?.length > 10);

  await page.evaluate(async () => {
    const first = orderedPendingReviewRows().find((row) => row.fileId && row.kind === 'schedule');
    await jumpToEvidence(first);
  });
  await page.locator('#vDetList .det[data-row-id]').first().waitFor();

  const cards = page.locator('#vDetList .det[data-row-id]');
  assert.ok(await cards.count() > 2, 'fixture page must expose multiple linked device rows');
  const firstCard = cards.first();
  assert.ok((await firstCard.locator('.det-primary').textContent()).trim().length > 0, 'device type must be the first specification detail');
  assert.match(await firstCard.getAttribute('title'), /counted device|on DB-/i, 'row hover title must include board-wide counts');
  assert.equal(await page.locator('#vDetList .det .chip').filter({ hasText: /^row$/i }).count(), 0, 'ROW badges must not return');

  const pendingColours = await cards.evaluateAll((elements) => [...new Set(elements.map((element) => element.style.getPropertyValue('--spec-color')).filter(Boolean))]);
  assert.deepEqual(pendingColours, ['#c87d0e'], 'pending rows must use the amber review state colour');
  const stateRows = await page.evaluate(async () => {
    const detections = pageDetections(viewerFile(), state.viewer.page).filter((item) => item.kind === 'row');
    const approved = [];
    for (const detection of detections) {
      if (approved.some((item) => item.specKey === detection.specKey)) continue;
      detection.r.status = 'confirmed'; approved.push({ id: detection.r.id, specKey: detection.specKey });
      if (approved.length === 2) break;
    }
    const corrected = detections.find((item) => !approved.some((approvedItem) => approvedItem.id === item.r.id));
    corrected.r.status = 'confirmed'; corrected.r.edited = true;
    const rejected = detections.find((item) => item.r.id !== corrected.r.id && !approved.some((approvedItem) => approvedItem.id === item.r.id));
    rejected.r.status = 'rejected';
    await renderViewer();
    return { approved: approved.map((item) => item.id), corrected: corrected.r.id, rejected: rejected.r.id };
  });
  const approvedColours = await Promise.all(stateRows.approved.map((id) => page.locator(`#vDetList .det[data-row-id="${id}"]`).getAttribute('style')));
  assert.equal(new Set(approvedColours).size, 2, 'approved device specifications must receive distinct colours');
  assert.match(await page.locator(`#vDetList .det[data-row-id="${stateRows.corrected}"]`).getAttribute('style'), /#1668e3/, 'corrected rows must be blue');
  assert.match(await page.locator(`#vDetList .det[data-row-id="${stateRows.rejected}"]`).getAttribute('style'), /#d33c43/, 'rejected rows must be red');

  const documentRows = page.locator('#vStage [data-row-id]');
  assert.ok(await documentRows.count() > 1, 'document rows must be interactive');
  const linkedId = await documentRows.nth(1).getAttribute('data-row-id');
  await documentRows.nth(1).click();
  await page.waitForFunction((rowId) => document.querySelector('#vDetList .det.current')?.dataset.rowId === rowId, linkedId);

  await page.locator('#vReviewStart').click();
  await page.waitForFunction(() => state.reviewFlow.active && Boolean(state.reviewFlow.currentRowId));
  const firstBoard = await page.evaluate(() => guidedReviewCurrentRow().boardNorm || '__none__');
  await page.waitForFunction(() => document.querySelector('#vDetList .det.current')?.dataset.rowId === state.reviewFlow.currentRowId);

  await page.locator('#vFullscreen').click();
  await page.waitForFunction(() => state.viewer.fullscreen === true);
  await page.locator('#vDetList .det.current [data-action="edit"]').click();
  await page.locator('#modalBk.show .modal.is-flexible').waitFor();
  const modalState = await page.evaluate(() => {
    const backdrop = document.querySelector('#modalBk');
    const modal = backdrop.querySelector('.modal');
    const rect = modal.getBoundingClientRect();
    return {
      parent: backdrop.parentElement?.id,
      resize: getComputedStyle(modal).resize,
      visible: rect.width > 0 && rect.height > 0,
      withinViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
    };
  });
  assert.deepEqual(modalState, { parent: 'pt-viewer', resize: 'both', visible: true, withinViewport: true });
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'viewer-fullscreen-correction.png'), fullPage: false });
  await page.locator('#mCancel').click();

  let nextBoard = firstBoard;
  for (let decision = 0; decision < 80 && nextBoard === firstBoard; decision += 1) {
    const priorRow = await page.evaluate(() => state.reviewFlow.currentRowId);
    await page.locator('#vDetList .det.current [data-action="approve"]').click();
    await page.waitForFunction((rowId) => !state.reviewFlow.active || state.reviewFlow.currentRowId !== rowId, priorRow);
    if (!await page.evaluate(() => state.reviewFlow.active)) break;
    await page.waitForFunction(() => document.querySelector('#vDetList .det.current')?.dataset.rowId === state.reviewFlow.currentRowId);
    nextBoard = await page.evaluate(() => guidedReviewCurrentRow().boardNorm || '__none__');
  }
  assert.notEqual(nextBoard, firstBoard, 'guided review must move from the completed first board to the next board');
  assert.equal(await page.locator('#vBoardHl').inputValue(), nextBoard, 'Go to Board must reflect the board currently under review');
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'viewer-guided-review-desktop.png'), fullPage: false });

  await page.locator('#vFullscreen').click();
  await page.waitForFunction(() => state.viewer.fullscreen === false);
  const boardApprovalBefore = await page.evaluate((boardNorm) => {
    state.selectedBoard = boardNorm;
    setTab('analysis');
    const rows = activeRows().filter((row) => (row.boardNorm || '__none__') === boardNorm);
    return {
      pending: rows.filter(reviewDecisionPending).length,
      history: ensureProjectState(state.cur).approvalLog.filter((item) => (item.boardNorm || '__none__') === boardNorm).length,
    };
  }, nextBoard);
  assert.ok(boardApprovalBefore.pending > 0, 'next board must have rows available for board-level approval');
  await page.locator('#bdApproveRemaining').click();
  await page.locator('#modalBk.show #mOk').click();
  await page.waitForFunction((boardNorm) => {
    const rows = activeRows().filter((row) => (row.boardNorm || '__none__') === boardNorm);
    return rows.filter(reviewDecisionPending).length === 0;
  }, nextBoard);
  const boardApprovalAfter = await page.evaluate((boardNorm) => ({
    pending: activeRows().filter((row) => (row.boardNorm || '__none__') === boardNorm && reviewDecisionPending(row)).length,
    history: ensureProjectState(state.cur).approvalLog.filter((item) => (item.boardNorm || '__none__') === boardNorm).length,
  }), nextBoard);
  assert.equal(boardApprovalAfter.pending, 0, 'board-level approval must resolve every remaining row on the selected board');
  assert.equal(
    boardApprovalAfter.history - boardApprovalBefore.history,
    boardApprovalBefore.pending,
    'board-level approval must add one audit entry per approved row',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => setTab('viewer'));
  await page.locator('#vInfoToggle').click();
  await page.locator('#vInfoPanel:not(.is-closed)').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `mobile page has ${overflow}px horizontal overflow`);
  await page.waitForTimeout(2800);
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'viewer-guided-review-mobile.png'), fullPage: false });

  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('; ')}`);
  console.log('PASS: linked Viewer rows, specification colours and counts, fullscreen correction, guided board progression, board approval audit, and responsive layout.');
} finally {
  await browser.close();
}
