import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareReportFixture } from './browser-report-fixture.mjs';

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
  await prepareReportFixture(page);
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

  const calibratedApprovalRows = await page.evaluate(async () => {
    const A = state.cur.analysis;
    const source = pageDetections(viewerFile(), state.viewer.page)
      .find((item) => item.kind === 'row' && item.r.boardNorm && item.r.device && item.r.rating != null)?.r;
    const diagnostic = A.pageDiagnostics.find((item) => item.fileId === source.fileId && Number(item.page) === Number(source.page));
    window.__calibratedApprovalRestore = {
      spatialBlockingReasons: [...(diagnostic.spatialBlockingReasons || [])],
      spatialGridAccepted: diagnostic.spatialGridAccepted,
      calibration: diagnostic.calibration ? structuredClone(diagnostic.calibration) : null,
    };
    diagnostic.spatialBlockingReasons = ['column_schema_low_confidence'];
    diagnostic.spatialGridAccepted = false;
    diagnostic.calibration = { applicable: 1, applied: 1, roles: ['outgoing_table'] };
    const row = {
      ...source,
      id: 'viewer-calibrated-approval',
      status: 'pending',
      edited: false,
      manual: false,
      classConflict: false,
      poleConflict: false,
      validation: { invalidSensitivity: false, invalidBreakingCapacity: false },
      highlightBbox: source.highlightBbox || source.bbox || [40, 120, 600, 24],
      bbox: source.bbox || source.highlightBbox || [40, 120, 600, 24],
    };
    A.rows.push(row);
    if (rowApprovalIssue(row) !== null) throw new Error('a calibrated, source-linked row must remain approvable despite a page-level geometry warning');
    const unsafe = { ...row, id: 'viewer-calibrated-unassigned', boardNorm: null };
    if (!/No board identity/.test(rowApprovalIssue(unsafe) || '')) throw new Error('calibration must not bypass a missing board identity');
    A.rows.push(unsafe);
    await renderViewer();
    return { calibrated: row.id, unsafe: unsafe.id };
  });
  const unsafeApprovalCard = page.locator(`#vDetList .det[data-row-id="${calibratedApprovalRows.unsafe}"]`);
  await unsafeApprovalCard.waitFor();
  const unsafeApprove = unsafeApprovalCard.locator('[data-action="approve"]');
  assert.equal(await unsafeApprove.isEnabled(), true, 'a blocked approval must lead to correction instead of becoming a dead button');
  await unsafeApprove.click();
  await page.locator('#modalBk.show #eBoard').waitFor();
  assert.match(await page.locator('#modalBk.show #mHead').textContent(), /Correct this row/);
  await page.locator('#mCancel').click();
  const calibratedApprovalCard = page.locator(`#vDetList .det[data-row-id="${calibratedApprovalRows.calibrated}"]`);
  await calibratedApprovalCard.waitFor();
  const calibratedApprove = calibratedApprovalCard.locator('[data-action="approve"]');
  assert.equal(await calibratedApprove.isEnabled(), true, 'Approve must be enabled after calibration when the row has complete reviewable evidence');
  await calibratedApprove.click();
  assert.equal(await page.evaluate((rowId) => state.cur.analysis.rows.find((row) => row.id === rowId)?.status, calibratedApprovalRows.calibrated), 'confirmed');
  await page.evaluate(async (rowIds) => {
    const A = state.cur.analysis;
    const row = A.rows.find((item) => item.id === rowIds.calibrated);
    const diagnostic = A.pageDiagnostics.find((item) => item.fileId === row.fileId && Number(item.page) === Number(row.page));
    const restore = window.__calibratedApprovalRestore;
    diagnostic.spatialBlockingReasons = restore.spatialBlockingReasons;
    diagnostic.spatialGridAccepted = restore.spatialGridAccepted;
    if (restore.calibration) diagnostic.calibration = restore.calibration;
    else delete diagnostic.calibration;
    A.rows = A.rows.filter((item) => item.id !== rowIds.calibrated && item.id !== rowIds.unsafe);
    delete window.__calibratedApprovalRestore;
    await renderViewer();
  }, calibratedApprovalRows);

  const largeDeviceRows = await page.evaluate(async () => {
    const A = state.cur.analysis;
    const source = pageDetections(viewerFile(), state.viewer.page).find((item) => item.kind === 'row' && item.r.boardNorm)?.r;
    const base = {
      ...source,
      boardNorm: source.boardNorm,
      fileId: source.fileId,
      page: source.page,
      line: null,
      kind: 'schedule',
      device: 'MCCB',
      rating: 160,
      curve: null,
      poles: 3,
      poleConfiguration: 'TP',
      ka: 25,
      productRange: 'H3+ P160',
      rcdProtected: false,
      afdd: false,
      spare: false,
      space: false,
      incomer: false,
      qty: 1,
      conf: 0.99,
      status: 'confirmed',
      requiresReview: false,
      edited: false,
    };
    const rows = [
      { ...base, id: 'viewer-trip-lsi', way: 'MCCB-1', phase: '3PH', tripUnit: 'LSI', desc: 'Submain LSI', srcText: 'Hager h3+ MCCB P160 160A 3P 25kA LSI' },
      { ...base, id: 'viewer-trip-lsig', way: 'MCCB-2', phase: '3PH', tripUnit: 'LSIG', desc: 'Submain LSIG', srcText: 'Hager h3+ MCCB P160 160A 3P 25kA LSIG' },
    ];
    A.rows.push(...rows);
    await renderViewer();
    return rows.map((row) => row.id);
  });
  const lsiCard = page.locator(`#vDetList .det[data-row-id="${largeDeviceRows[0]}"]`);
  await lsiCard.waitFor();
  const lsiCardText = await lsiCard.textContent();
  assert.match(lsiCardText, /Trip LSI/, 'large-device evidence must display the canonical trip unit');
  assert.match(lsiCardText, /H3\+\s*\/\s*P160/, 'large-device evidence must display product range and frame');
  assert.match(lsiCardText, /\bTP\b/, 'large-device evidence must display pole configuration');
  assert.match(lsiCardText, /25kA/, 'large-device evidence must display breaking capacity');
  assert.doesNotMatch(lsiCardText, /\b[BCDKZ] curve\b/, 'MCCB evidence must not be grouped by an MCB-style tripping curve');
  const largeSummaryRows = page.locator('.audit-takeoff-summary .audit-takeoff-row').filter({ hasText: /160A/ });
  assert.equal(await largeSummaryRows.filter({ hasText: /LSI trip/ }).count(), 1, 'LSI must have its own approved take-off group');
  assert.equal(await largeSummaryRows.filter({ hasText: /LSIG trip/ }).count(), 1, 'LSIG must have its own approved take-off group');
  assert.match(await largeSummaryRows.filter({ hasText: /LSI trip/ }).textContent(), /x1/, 'approved take-off must display the detailed device sum');

  await page.evaluate((rowId) => {
    const row = state.cur.analysis.rows.find((item) => item.id === rowId);
    openRowEditor(row, false, 'Viewer');
  }, largeDeviceRows[0]);
  await page.locator('#modalBk.show #eTrip').waitFor();
  assert.deepEqual(
    await page.locator('#eTrip option').evaluateAll((options) => options.map((option) => option.value)),
    ['', 'LSI', 'LSIG', 'LSNI', 'TM', 'ATFM', 'ATAM', 'LI'],
    'trip-unit correction must expose only the approved canonical options',
  );
  assert.equal(await page.locator('#eTrip').inputValue(), 'LSI');
  assert.equal(await page.locator('#eProductRange').inputValue(), 'H3+ P160');
  await page.locator('#mCancel').click();
  await page.evaluate(async (rowIds) => {
    state.cur.analysis.rows = state.cur.analysis.rows.filter((row) => !rowIds.includes(row.id));
    await renderViewer();
  }, largeDeviceRows);

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

  const poleGuardId = await page.evaluate(async () => {
    const source = pageDetections(viewerFile(), state.viewer.page).find((item) => item.kind === 'row' && item.r.boardNorm)?.r;
    const guarded = window.EstimationExtractorCore.reconcileCombinedProtection({
      ...source,
      id: 'viewer-single-phase-pole-guard', way: 'T-4', phase: 'L2',
      device: 'MCB', rating: 10, poles: 3, poleConfiguration: 'TP',
      phaseSlotIndependent: true, sharedPhaseSpan: false, poleEvidenceExplicit: false,
      status: 'confirmed', desc: 'Calorifier trace heating',
      srcText: 'L2 MCB C 10 Calorifier trace heating',
    });
    state.cur.analysis.rows.push(guarded);
    await renderViewer();
    return guarded.id;
  });
  const poleGuardCard = page.locator(`#vDetList .det[data-row-id="${poleGuardId}"]`);
  assert.match(await poleGuardCard.textContent(), /\bSP\b/, 'bounded L2 row must render as single-pole');
  assert.doesNotMatch(await poleGuardCard.textContent(), /\bTP\b/, 'unproven TP label must not reach the Viewer');
  await page.evaluate(async (rowId) => {
    state.cur.analysis.rows = state.cur.analysis.rows.filter((row) => row.id !== rowId);
    await renderViewer();
  }, poleGuardId);

  const phaseSpanId = await page.evaluate(async () => {
    const source = pageDetections(viewerFile(), state.viewer.page).find((item) => item.kind === 'row' && item.r.boardNorm)?.r;
    const guarded = window.EstimationExtractorCore.reconcileCombinedProtection({
      ...source,
      id: 'viewer-wrapped-phase-span', way: 'T-5', phase: 'L3',
      device: 'MCB', rating: 25, poles: 1, poleConfiguration: 'SP', occupies_ways: 1,
      phaseSlotIndependent: true, sharedPhaseSpan: false, poleEvidenceExplicit: false,
      fieldSources: { ...source?.fieldSources, phase: { originalText: 'L1- L3', text: 'L1- L3' } },
      status: 'confirmed', desc: 'Dishwasher', srcText: 'T-5 L1- L3 MCB C 25 Dishwasher',
    });
    state.cur.analysis.rows.push(guarded);
    await renderViewer();
    return guarded.id;
  });
  const phaseSpanCard = page.locator(`#vDetList .det[data-row-id="${phaseSpanId}"]`);
  assert.match(await phaseSpanCard.textContent(), /\bTP\b/, 'wrapped L1-L3 evidence must render as TP');
  assert.doesNotMatch(await phaseSpanCard.textContent(), /\bSP\b/, 'wrapped L1-L3 evidence must not render as SP');
  await page.evaluate(async (rowId) => {
    state.cur.analysis.rows = state.cur.analysis.rows.filter((row) => row.id !== rowId);
    await renderViewer();
  }, phaseSpanId);

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
  await page.evaluate(() => openMissingWaysEditor(unresolvedReviewExtractionGaps()[0]));
  await page.locator('#gapWayStart').fill('L-7');
  await page.locator('#gapWayEnd').fill('L-10');
  await page.locator('#gapRole').selectOption('spare');
  await page.locator('#gapPhaseModel').selectOption('tp');
  await page.locator('#gapRecoveryReason').fill('Visible merged spare bands restored during audit');
  await page.locator('#mOk').click();
  await page.locator('#modalBk').waitFor({ state: 'hidden' });
  const recoveredGap = await page.evaluate(() => {
    const rows=state.cur.analysis.rows.filter((row) => row.resolutionSource === 'user_guided_recovery');
    const diagnostic=state.cur.analysis.pageDiagnostics.find((item) => item.testReviewGap);
    return {
      ways: rows.map((row) => row.way),
      phases: rows.map((row) => row.phase),
      quantities: rows.map((row) => row.qty),
      statuses: rows.map((row) => row.status),
      rowsParsed: diagnostic.rowsParsed,
      recoveryRows: diagnostic.humanGuidedRecovery?.rowsAdded,
      unresolved: unresolvedReviewExtractionGaps().length,
      logged: state.cur.approvalLog.filter((item) => /Visible merged spare bands/.test(item.note || '')).length,
    };
  });
  assert.deepEqual(recoveredGap, {
    ways: ['L-7', 'L-8', 'L-9', 'L-10'], phases: ['3PH', '3PH', '3PH', '3PH'],
    quantities: [0, 0, 0, 0], statuses: ['confirmed', 'confirmed', 'confirmed', 'confirmed'],
    rowsParsed: 4, recoveryRows: 4, unresolved: 0, logged: 4,
  }, 'human-guided recovery must create page-linked, approved spare ways and close the extraction gap');
  await page.evaluate(({ fileId }) => {
    delete state.cur.analysis.boards.DBFIRSTGAP;
    state.cur.analysis.pageDiagnostics = state.cur.analysis.pageDiagnostics.filter((item) => !item.testReviewGap);
    state.cur.analysis.rows = state.cur.analysis.rows.filter((item) => !item.testReviewGap && item.resolutionSource !== 'user_guided_recovery');
    state.viewer.fileId = fileId;
    renderGuidedReviewControls();
  }, extractionGap);

  const expectedFirstAuditRow = await page.evaluate(() => {
    pauseGuidedReview();
    const first = orderedPendingReviewRows()[0];
    queueAnalysisAuditPrompt(state.cur.analysis, {}, state.cur);
    return first?.id || null;
  });
  assert.ok(expectedFirstAuditRow, 'fixture must retain at least one unresolved audit row');
  await page.locator('#modalBk.show').waitFor();
  assert.match(await page.locator('#mHead').textContent(), /Analysis .*audit/i);
  assert.equal(await page.locator('#mOk').textContent(), 'Open audit');
  assert.equal(await page.locator('#mCancel').textContent(), 'Stay here');
  assert.match(await page.locator('#mBody').textContent(), /first unresolved board/i);
  await page.locator('#mOk').click();
  await page.waitForFunction((rowId) => state.reviewFlow.active && state.reviewFlow.currentRowId === rowId, expectedFirstAuditRow);
  assert.equal(await page.evaluate(() => document.body.dataset.projectTab), 'viewer', 'Open audit must enter the Viewer audit workspace');
  const firstBoard = await page.evaluate(() => guidedReviewCurrentRow().boardNorm || '__none__');
  await page.waitForFunction(() => document.querySelector('#vDetList .det.current')?.dataset.rowId === state.reviewFlow.currentRowId);

  const restoredReview = await page.evaluate(async () => {
    const projectId = state.cur.id;
    const currentRowId = state.reviewFlow.currentRowId;
    openProject(projectId);
    await setTab('viewer');
    await focusGuidedReview();
    return {
      currentRowId,
      restoredRowId: state.reviewFlow.currentRowId,
      storedRowId: state.cur.reviewSession?.currentRowId,
      active: state.reviewFlow.active,
    };
  });
  assert.deepEqual(restoredReview, {
    currentRowId: restoredReview.currentRowId,
    restoredRowId: restoredReview.currentRowId,
    storedRowId: restoredReview.currentRowId,
    active: true,
  }, 'reopening a project must restore the same unresolved review row');
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
  assert.equal(await page.locator('#eRcd').inputValue(), 'yes', 'choosing MCB must preserve evidenced RCD protection');
  assert.equal(await page.locator('#eRcdArrangement').inputValue(), 'separate', 'an MCB with RCD protection must default to a separate arrangement');
  assert.equal(await page.locator('#eSens').inputValue(), '10');
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'viewer-fullscreen-correction.png'), fullPage: false });
  await page.locator('#mOk').click();
  await page.locator('#modalBk').waitFor({ state: 'hidden' });
  const savedCorrection = await page.evaluate((rowId) => {
    const row = state.cur.analysis.rows.find((item) => item.id === rowId);
    return {
      device: row.device,
      rcdProtected: row.rcdProtected,
      rcdArrangement: row.rcdArrangement,
      sens: row.sens,
      edited: row.edited,
      status: row.status,
      fields: row.corrections.map((item) => item.field),
    };
  }, correctionRowId);
  assert.equal(savedCorrection.device, 'MCB');
  assert.equal(savedCorrection.rcdProtected, true);
  assert.equal(savedCorrection.rcdArrangement, 'separate');
  assert.equal(savedCorrection.sens, 10);
  assert.equal(savedCorrection.edited, true);
  assert.equal(savedCorrection.status, 'confirmed');
  assert.ok(savedCorrection.fields.includes('Device Family'));
  assert.ok(savedCorrection.fields.includes('RCD Arrangement'));
  await page.evaluate(async (rowId) => {
    state.cur.analysis.rows = state.cur.analysis.rows.filter((row) => row.id !== rowId);
    await renderViewer();
  }, correctionRowId);

  let nextBoard = firstBoard;
  for (let decision = 0; decision < 80 && nextBoard === firstBoard; decision += 1) {
    const priorRow = await page.evaluate(() => state.reviewFlow.currentRowId);
    const issue = await page.evaluate(() => {
      const row = state.cur.analysis.rows.find((item) => item.id === state.reviewFlow.currentRowId);
      return rowApprovalIssue(row);
    });
    if (issue) await page.locator('#vDetList .det.current [data-action="reject"]').click();
    else await page.locator('#vDetList .det.current [data-action="approve"]').click();
    await page.waitForFunction((rowId) => !state.reviewFlow.active || state.reviewFlow.currentRowId !== rowId, priorRow);
    if (!await page.evaluate(() => state.reviewFlow.active)) break;
    await page.waitForFunction(() => {
      const currentId = state.reviewFlow.currentRowId;
      return viewerCommittedSequence === viewerRenderSequence
        && state.viewer.evidenceId === currentId
        && document.querySelector('#vDetList .det.current')?.dataset.rowId === currentId
        && document.querySelector('#vStage .attention[data-row-id]')?.dataset.rowId === currentId;
    });
    const visibleSync = await page.evaluate(() => {
      const currentId = state.reviewFlow.currentRowId;
      const list = document.querySelector('#vDetList');
      const card = list?.querySelector('.det.current');
      const stage = document.querySelector('#vStage');
      const source = stage?.querySelector('.attention[data-row-id]');
      const within = (container, target) => {
        const outer = container?.getBoundingClientRect(), inner = target?.getBoundingClientRect();
        return Boolean(outer && inner && inner.bottom >= outer.top && inner.top <= outer.bottom && inner.right >= outer.left && inner.left <= outer.right);
      };
      return {
        currentId,
        currentCards: list?.querySelectorAll('.det.current').length || 0,
        attentionRows: stage?.querySelectorAll('.attention[data-row-id]').length || 0,
        cardVisible: within(list, card),
        sourceVisible: within(stage, source),
      };
    });
    assert.equal(visibleSync.currentCards, 1, 'exactly one evidence card must be current after approval');
    assert.equal(visibleSync.attentionRows, 1, 'exactly one source row must be highlighted after approval');
    assert.ok(visibleSync.cardVisible, `current evidence card ${visibleSync.currentId} must be visible in the right list`);
    assert.ok(visibleSync.sourceVisible, `current source row ${visibleSync.currentId} must be visible in the document stage`);
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
      ready: rows.filter((row) => reviewDecisionPending(row) && !rowApprovalIssue(row)).length,
      blocked: rows.filter((row) => reviewDecisionPending(row) && Boolean(rowApprovalIssue(row))).length,
      history: ensureProjectState(state.cur).approvalLog.filter((item) => (item.boardNorm || '__none__') === boardNorm).length,
    };
  }, nextBoard);
  assert.ok(boardApprovalBefore.pending > 0, 'next board must have rows available for board-level approval');
  assert.ok(boardApprovalBefore.ready > 0, 'next board must have ready rows available for board-level approval');
  await page.locator('#bdApproveRemaining').click();
  await page.locator('#modalBk.show #mOk').click();
  await page.waitForFunction(({ boardNorm, blocked }) => {
    const rows = activeRows().filter((row) => (row.boardNorm || '__none__') === boardNorm);
    return rows.filter(reviewDecisionPending).length === blocked;
  }, { boardNorm: nextBoard, blocked: boardApprovalBefore.blocked });
  const boardApprovalAfter = await page.evaluate((boardNorm) => ({
    pending: activeRows().filter((row) => (row.boardNorm || '__none__') === boardNorm && reviewDecisionPending(row)).length,
    history: ensureProjectState(state.cur).approvalLog.filter((item) => (item.boardNorm || '__none__') === boardNorm).length,
  }), nextBoard);
  assert.equal(boardApprovalAfter.pending, boardApprovalBefore.blocked, 'board-level approval must leave structurally blocked rows pending');
  assert.equal(
    boardApprovalAfter.history - boardApprovalBefore.history,
    boardApprovalBefore.ready,
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
  console.log('PASS: linked Viewer rows, specification colours and counts, durable review restoration, fullscreen correction, guided board progression, board approval audit, and responsive layout.');
} finally {
  await browser.close();
}
