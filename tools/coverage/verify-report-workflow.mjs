import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import { prepareReportFixture } from './browser-report-fixture.mjs';

const appUrl = process.env.APP_URL || 'http://127.0.0.1:8773/?test=1&fixture=report';
const shotsDir = process.env.REPORT_SHOTS_DIR || '';
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
  await page.locator('.proj-card', { hasText: 'Riverside Office Fit-Out (demo)' }).first().click();
  await page.locator('.ptab[data-pt="reports"]').click();
  await page.locator('#reportMatrixHost table').first().waitFor();

  const boardReport = page.locator('#reportMatrixHost');
  const boardHeadings = await boardReport.locator('thead th').allTextContents();
  for (const heading of ['Specification and circuit', 'Qty', 'Protection', 'Circuits / ways', 'Source pages', 'Status']) {
    assert.ok(boardHeadings.some((value) => value.trim().toLowerCase() === heading.toLowerCase()), `missing Board Take-Off heading: ${heading}`);
  }
  assert.ok(await boardReport.locator('.report-source-open').count() > 0, 'Board Take-Off rows need source-review windows');
  assert.doesNotMatch(await boardReport.textContent(), /Not specified|Unclear/i, 'deliverable report must keep unresolved prose out of cells');
  const firstBoardParity = await page.evaluate(() => {
    const presentation = window.EstimationReport.buildBoardTakeOffPresentation(currentReportModel());
    const expected = presentation.sections[0].boards[0].families[0].rows[0];
    const cells = [...document.querySelector('.report-spec-row').cells];
    const normalise = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    return {
      expected: {
        technicalLabels: expected.technicalLabels,
        description: expected.description,
        quantity: String(expected.quantity),
        protection: expected.protectionLabels,
        circuits: expected.circuits,
        sources: expected.sources,
        status: expected.reviewStatus,
      },
      actual: {
        specification: normalise(cells[0].innerText),
        quantity: normalise(cells[1].innerText),
        protection: normalise(cells[2].innerText),
        circuits: normalise(cells[3].innerText),
        sources: normalise(cells[4].childNodes[0]?.textContent),
        status: normalise(cells[5].innerText),
      },
    };
  });
  for (const label of firstBoardParity.expected.technicalLabels) {
    assert.match(firstBoardParity.actual.specification, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `browser Board Take-Off omitted technical label: ${label}`);
  }
  assert.match(firstBoardParity.actual.specification, new RegExp(firstBoardParity.expected.description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(firstBoardParity.actual.quantity, firstBoardParity.expected.quantity);
  for (const label of firstBoardParity.expected.protection) assert.match(firstBoardParity.actual.protection, new RegExp(label));
  assert.equal(firstBoardParity.actual.circuits, firstBoardParity.expected.circuits);
  assert.equal(firstBoardParity.actual.sources, firstBoardParity.expected.sources);
  assert.equal(firstBoardParity.actual.status, firstBoardParity.expected.status);
  const boardSpecificationColours = await boardReport.locator('.report-spec-row').evaluateAll((elements) => elements.map((element) => ({
    key: decodeURIComponent(element.dataset.specKey || ''),
    colour: element.style.getPropertyValue('--spec-color'),
  })));
  assert.ok(boardSpecificationColours.every((item) => item.key && item.colour), 'every Board Take-Off specification row needs a colour identity');
  const repeatedBoardSpecification = Object.values(Object.groupBy(boardSpecificationColours, (item) => item.key))
    .find((items) => items.length > 1);
  assert.ok(repeatedBoardSpecification, 'report fixture must exercise one specification across multiple boards');
  assert.equal(new Set(repeatedBoardSpecification.map((item) => item.colour)).size, 1, 'one specification must keep the same colour across boards');
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'report-board-desktop.png'), fullPage: true });

  const reportBoardControl = boardReport.locator('[data-report-board-source]').first();
  const reportBoardNorm = await reportBoardControl.getAttribute('data-report-board-source');
  const boardCorrectionBefore = await page.evaluate((boardNorm) => ({
    correctionCount: state.cur.analysis.boards[boardNorm].corrections?.length || 0,
    logCount: ensureProjectState(state.cur).correctionLog.length,
  }), reportBoardNorm);
  await reportBoardControl.click();
  await page.locator('#modalBk.show #reportCorrectBoard').waitFor();
  assert.ok(await page.locator('#modalBk [data-report-board-action="view"]').count() > 0, 'board evidence window must link to its source page');
  await page.locator('#reportCorrectBoard').click();
  await page.waitForFunction(() => document.querySelector('#mHead')?.textContent === 'Correct board details');
  await page.locator('#bDescription').fill('Corrected from report evidence');
  await page.locator('#bCorrectionReason').fill('Browser regression for report board correction');
  await page.locator('#mOk').click();
  await page.locator('#modalBk').waitFor({ state: 'hidden' });
  const boardCorrectionAfter = await page.evaluate((boardNorm) => {
    const board = state.cur.analysis.boards[boardNorm];
    return {
      description: board.header.description,
      correctionCount: board.corrections?.length || 0,
      logCount: ensureProjectState(state.cur).correctionLog.length,
      reportEvent: ensureProjectState(state.cur).correctionLog.some((event) => event.boardNorm === boardNorm
        && event.surface === 'Report' && event.field === 'header.description'),
    };
  }, reportBoardNorm);
  assert.equal(boardCorrectionAfter.description, 'Corrected from report evidence');
  assert.equal(boardCorrectionAfter.correctionCount, boardCorrectionBefore.correctionCount + 1, 'board correction must append one board-level history item');
  assert.equal(boardCorrectionAfter.logCount, boardCorrectionBefore.logCount + 1, 'board correction must append one project-level audit event');
  assert.equal(boardCorrectionAfter.reportEvent, true, 'board correction must record the Report surface and corrected field');

  await boardReport.locator('.report-source-open').first().click();
  await page.locator('#modalBk.show .report-source-item').first().waitFor();
  assert.ok(await page.locator('#modalBk [data-report-source-action="view"]').count() > 0, 'source window must link to document evidence');
  const correctButton = page.locator('#modalBk [data-report-source-action="edit"]:not([disabled])').first();
  assert.ok(await correctButton.count(), 'source window must permit correction');
  await correctButton.click();
  await page.waitForFunction(() => document.querySelector('#mHead')?.textContent === 'Correct this row');
  assert.ok(await page.locator('#modalBk .row-editor-grid').isVisible(), 'correction editor must open from report evidence');
  await page.locator('#mCancel').click();

  await page.locator('[data-report-mode="matrix"]').click();
  await page.locator('#reportMatrixHost .report-transposed').waitFor();
  const matrix = page.locator('#reportMatrixHost .report-transposed');
  assert.ok(await matrix.locator('thead .report-spec-column').count() >= 2, 'Device Take-Off must place full device specifications across columns');
  assert.ok(await matrix.locator('tbody tr .report-board-name').count() >= 2, 'Device Take-Off must place boards down rows');
  assert.doesNotMatch(await matrix.textContent(), /Not specified|Unclear/i, 'matrix must keep unresolved prose out of deliverable cells');
  const reportColours = await matrix.locator('thead .report-spec-column').evaluateAll((elements) => elements.map((element) => ({
    key: decodeURIComponent(element.dataset.specKey || ''),
    colour: element.style.getPropertyValue('--spec-color'),
    tint: getComputedStyle(element).backgroundColor,
    marker: getComputedStyle(element).boxShadow,
  })));
  assert.ok(reportColours.every((item) => item.key && item.colour), 'every Device Take-Off specification needs an explicit colour identity');
  assert.equal(new Set(reportColours.map((item) => item.colour)).size, reportColours.length, 'different report specifications need distinct colours');
  assert.ok(reportColours.every((item) => item.tint !== 'rgb(247, 224, 209)' && item.marker !== 'none'), 'report headers need visible specification tint and marker');
  const viewerColourAgreement = await page.evaluate((colours) => {
    const reportMap = new Map(colours.map((item) => [item.key, item.colour]));
    const sourceRows = state.cur.analysis.rows.filter(isTakeoffEvidenceRow);
    const viewerMap = buildSpecificationColorMap(sourceRows);
    return [...reportMap].every(([key, colour]) => viewerMap.get(key) === colour);
  }, reportColours);
  assert.equal(viewerColourAgreement, true, 'Viewer and final report must use the same colour for each specification');
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'report-device-desktop.png'), fullPage: true });

  const advisoryReadiness = await page.evaluate(() => {
    const fallbackBoard = Object.keys(state.cur.analysis.boards)[0];
    state.cur.analysis.rows.filter(isTakeoffEvidenceRow).forEach((row) => {
      if (!row.boardNorm) {
        row.boardNorm = fallbackBoard;
        row.boardRef = state.cur.analysis.boards[fallbackBoard]?.orig || fallbackBoard;
      }
      if (row.status !== 'rejected') row.status = 'confirmed';
    });
    state.cur.analysis.health = { state: 'incomplete', reasons: [
      { code: 'SCHEDULE_PAGE_UNPARSED', message: 'One schedule-classified page has no parsed rows', count: 1, refs: [] },
      { code: 'BOARD_FEED_MISSING', message: 'One board feed remains unresolved', count: 1, refs: [] },
    ], counters: {} };
    renderReport();
    return currentReportExportReadiness(currentReportModel());
  });
  assert.equal(advisoryReadiness.allowed, true,
    `completed audit must permit issue past unrelated page/topology diagnostics: ${JSON.stringify(advisoryReadiness.blockers)}`);
  assert.equal(advisoryReadiness.blockers.length, 0);
  assert.match(await page.locator('#reportStatus').textContent(), /Audit complete.*export permitted/i);
  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#reportCsvBtn').click(),
  ]);
  assert.match(csvDownload.suggestedFilename(), /DB Devices Take Off.*\.csv$/i);
  assert.ok(await csvDownload.path(), 'audited advisory CSV download must be created');
  const [xlsxDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#reportXlsxBtn').click(),
  ]);
  assert.match(xlsxDownload.suggestedFilename(), /DB Devices Take Off.*\.xlsx$/i);
  const xlsxPath = await xlsxDownload.path();
  assert.ok(xlsxPath, 'audited advisory Excel download must be created');
  const downloadedWorkbook = new ExcelJS.Workbook();
  await downloadedWorkbook.xlsx.readFile(xlsxPath);
  const downloadedBoardSheet = downloadedWorkbook.getWorksheet('Board Take-Off');
  assert.deepEqual(downloadedBoardSheet.getRow(3).values.slice(1), [
    'Specification and circuit', 'Qty', 'Protection', 'Circuits / ways', 'Source pages', 'Status',
  ], 'downloaded Board Take-Off headings must match the browser report');
  let firstDownloadedRow = null;
  downloadedBoardSheet.eachRow((row, rowNumber) => {
    if (!firstDownloadedRow && rowNumber > 3 && Number.isFinite(Number(row.getCell(2).value)) && row.getCell(6).value) {
      firstDownloadedRow = row;
    }
  });
  assert.ok(firstDownloadedRow, 'downloaded Board Take-Off has no specification row');
  const downloadedSpecification = firstDownloadedRow.getCell(1).text.replace(/\s+/g, ' ').trim();
  for (const label of firstBoardParity.expected.technicalLabels) assert.match(downloadedSpecification, new RegExp(label));
  assert.match(downloadedSpecification, new RegExp(firstBoardParity.expected.description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(String(firstDownloadedRow.getCell(2).value), firstBoardParity.expected.quantity);
  assert.equal(firstDownloadedRow.getCell(3).text.replace(/\s+/g, ' ').trim(), firstBoardParity.expected.protection.join(' '));
  assert.equal(firstDownloadedRow.getCell(4).text, firstBoardParity.expected.circuits);
  assert.equal(firstDownloadedRow.getCell(5).text, firstBoardParity.expected.sources);
  assert.equal(firstDownloadedRow.getCell(6).text, firstBoardParity.expected.status);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const mobile = await page.evaluate(() => ({
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    reportScrollable: document.querySelector('#reportMatrixHost').scrollWidth > document.querySelector('#reportMatrixHost').clientWidth,
  }));
  assert.ok(mobile.documentOverflow <= 1, `mobile report page has ${mobile.documentOverflow}px document overflow`);
  assert.equal(mobile.reportScrollable, true, 'wide Device Take-Off must scroll inside its report viewport');
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'report-device-mobile.png'), fullPage: true });

  await page.locator('[data-report-mode="board"]').click();
  await page.locator('#reportMatrixHost .report-board-section').first().waitFor();
  const mobileBoard = await page.evaluate(() => {
    const host = document.querySelector('#reportMatrixHost');
    const row = host.querySelector('.report-spec-row');
    return {
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      hostOverflow: host.scrollWidth - host.clientWidth,
      rowLayout: getComputedStyle(row).display,
      rowColumns: getComputedStyle(row).gridTemplateColumns,
    };
  });
  assert.ok(mobileBoard.documentOverflow <= 1, `mobile Board Take-Off page has ${mobileBoard.documentOverflow}px document overflow`);
  assert.ok(mobileBoard.hostOverflow <= 1, `mobile Board Take-Off has ${mobileBoard.hostOverflow}px internal horizontal overflow`);
  assert.equal(mobileBoard.rowLayout, 'grid', 'mobile Board Take-Off specifications must use the stacked grid');
  assert.match(mobileBoard.rowColumns, /px.*px/, 'mobile Board Take-Off needs two stable detail columns');
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'report-board-mobile.png'), fullPage: true });

  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('; ')}`);
  console.log('PASS: Board Take-Off, correction audit, source review, advisory CSV/XLSX issue, and responsive report viewport.');
} finally {
  await browser.close();
}
