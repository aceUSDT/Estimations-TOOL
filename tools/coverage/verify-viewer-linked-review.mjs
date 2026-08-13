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

  const occupancyPeerIds = await page.evaluate(async () => {
    const A = state.cur.analysis;
    const file = viewerFile();
    const boardNorm = pageDetections(file, state.viewer.page).find((item) => item.kind === 'row' && item.r.boardNorm)?.r.boardNorm;
    const base = {
      boardNorm, fileId: file.id, page: state.viewer.page, line: null, kind: 'schedule', status: 'confirmed',
      device: 'MCB', rating: 10, curve: 'C', poleConfiguration: 'SP', poles: 1, ka: 15,
      rcdProtected: false, afdd: false, spare: false, space: false, qty: 1, conf: 0.98,
    };
    const peers = [
      { ...base, id: 'viewer-colour-peer-1', way: 'T-1', phase: 'L1', desc: 'Food Room', srcText: 'MCB C 10 Food Room' },
      { ...base, id: 'viewer-colour-open-space', way: 'T-2', phase: 'L2', desc: 'Open Space next to dining', srcText: 'MCB C 10 Open Space next to dining' },
      { ...base, id: 'viewer-colour-peer-3', way: 'T-3', phase: 'L3', desc: 'Food Prep', srcText: 'MCB C 10 Food Prep' },
    ];
    A.rows.push(...peers);
    await renderViewer();
    return peers.map((row) => row.id);
  });
  const occupancyPeerCards = occupancyPeerIds.map((id) => page.locator(`#vDetList .det[data-row-id="${id}"]`));
  const occupancyPeerColours = await Promise.all(occupancyPeerCards.map((card) => card.evaluate((element) => element.style.getPropertyValue('--spec-color'))));
  assert.equal(new Set(occupancyPeerColours).size, 1, 'identical MCB specifications must keep one colour even when a room name contains Space');
  assert.doesNotMatch(await occupancyPeerCards[1].locator('.det-count').textContent(), /not counted/i);
  assert.match(await occupancyPeerCards[1].locator('.det-count').textContent(), /counted device/i);
  if (shotsDir) {
    await occupancyPeerCards[1].scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shotsDir, 'viewer-occupancy-peer-colours.png'), fullPage: false });
  }
  await page.evaluate(async (ids) => {
    state.cur.analysis.rows = state.cur.analysis.rows.filter((row) => !ids.includes(row.id));
    await renderViewer();
  }, occupancyPeerIds);

  const documentRows = page.locator('#vStage [data-row-id]');
  assert.ok(await documentRows.count() > 1, 'document rows must be interactive');
  const linkedId = await documentRows.nth(1).getAttribute('data-row-id');
  await documentRows.nth(1).click();
  await page.waitForFunction((rowId) => document.querySelector('#vDetList .det.current')?.dataset.rowId === rowId, linkedId);

  const extractionGap = await page.evaluate(() => {
    const A = state.cur.analysis;
    const fileId = state.cur.files[0].id;
    A.boards.DBFIRSTGAP = {
      norm: 'DBFIRSTGAP', orig: 'DB-FIRST-GAP', type: 'DB', inScope: true,
      pages: [{ fileId, page: 1, primary: true }],
    };
    A.pageDiagnostics.push({
      fileId, page: 1, type: 'db-schedule', textLines: 20,
      scheduleScore: 0.95, rowsParsed: 0, testReviewGap: true,
    });
    A.rows.push({
      id: 'test-review-gap-row', boardNorm: 'DBFIRSTGAP', fileId, page: 2,
      kind: 'schedule', way: 'L-1', phase: 'L1', device: 'MCB', rating: 10,
      status: 'confirmed', testReviewGap: true,
    });
    renderGuidedReviewControls();
    return { fileId };
  });
  await page.locator('#vReviewStart').click();
  await page.waitForFunction(() => state.viewer.boardHl === 'DBFIRSTGAP');
  assert.equal(await page.evaluate(() => state.reviewFlow.active), false, 'guided review must not skip an earlier board with zero extracted rows');
  assert.match(await page.locator('#vReviewTitle').textContent(), /Extraction required for DB-FIRST-GAP/);
  assert.match(await page.locator('#vReviewProgress').textContent(), /Page 1 is the first unresolved board/);
  await page.evaluate(({ fileId }) => {
    delete state.cur.analysis.boards.DBFIRSTGAP;
    state.cur.analysis.pageDiagnostics = state.cur.analysis.pageDiagnostics.filter((item) => !item.testReviewGap);
    state.cur.analysis.rows = state.cur.analysis.rows.filter((item) => !item.testReviewGap);
    state.viewer.fileId = fileId;
    renderGuidedReviewControls();
  }, extractionGap);

  await page.locator('#vReviewStart').click();
  await page.waitForFunction(() => state.reviewFlow.active && Boolean(state.reviewFlow.currentRowId));
  const firstBoard = await page.evaluate(() => guidedReviewCurrentRow().boardNorm || '__none__');
  await page.waitForFunction(() => document.querySelector('#vDetList .det.current')?.dataset.rowId === state.reviewFlow.currentRowId);

  await page.locator('#vFullscreen').click();
  await page.waitForFunction(() => state.viewer.fullscreen === true);
  const correctionRowId = await page.evaluate(() => {
    const current = guidedReviewCurrentRow();
    const row = {
      ...current,
      id: 'viewer-explicit-mcb-correction',
      device: 'RCBO',
      rcdProtected: true,
      sens: 10,
      ka: null,
      status: 'pending',
      edited: false,
      corrections: [],
      srcText: 'L1 MCB No C 20 10 BU Classroom: FCU/HRU',
    };
    state.cur.analysis.rows.push(row);
    openRowEditor(row, false, 'Viewer');
    return row.id;
  });
  await page.locator('#modalBk.show .modal.is-flexible').waitFor();
  const modalState = await page.evaluate(() => {
    const backdrop = document.querySelector('#modalBk');
    const modal = backdrop.querySelector('.modal');
    const footer = modal.querySelector('.m-foot');
    const save = modal.querySelector('#mOk');
    const rect = modal.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    const saveRect = save.getBoundingClientRect();
    return {
      parent: backdrop.parentElement?.id,
      resize: getComputedStyle(modal).resize,
      visible: rect.width > 0 && rect.height > 0,
      withinViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      footerVisible: footerRect.top >= rect.top && footerRect.bottom <= rect.bottom,
      saveVisible: saveRect.top >= footerRect.top && saveRect.bottom <= footerRect.bottom && !save.disabled,
    };
  });
  assert.deepEqual(modalState, {
    parent: 'pt-viewer', resize: 'both', visible: true, withinViewport: true, footerVisible: true, saveVisible: true,
  });
  await page.locator('#eDev').selectOption({ label: 'MCB' });
  assert.equal(await page.locator('#eRcd').inputValue(), 'no', 'choosing MCB must clear incompatible integral RCD state');
  assert.equal(await page.locator('#eSens').inputValue(), '');
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'viewer-fullscreen-correction.png'), fullPage: false });
  await page.locator('#mOk').click();
  await page.locator('#modalBk').waitFor({ state: 'hidden' });
  const savedCorrection = await page.evaluate((rowId) => {
    const row = state.cur.analysis.rows.find((item) => item.id === rowId);
    return {
      device: row.device,
      rcdProtected: row.rcdProtected,
      sens: row.sens,
      edited: row.edited,
      status: row.status,
      fields: row.corrections.map((item) => item.field),
    };
  }, correctionRowId);
  assert.equal(savedCorrection.device, 'MCB');
  assert.equal(savedCorrection.rcdProtected, false);
  assert.equal(savedCorrection.sens, null);
  assert.equal(savedCorrection.edited, true);
  assert.equal(savedCorrection.status, 'confirmed');
  assert.ok(savedCorrection.fields.includes('Device Family'));
  assert.ok(savedCorrection.fields.includes('RCD Protection'));
  await page.evaluate(async (rowId) => {
    state.cur.analysis.rows = state.cur.analysis.rows.filter((row) => row.id !== rowId);
    await renderViewer();
  }, correctionRowId);

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
