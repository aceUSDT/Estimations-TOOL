import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  await page.locator('.proj-card', { hasText: 'Riverside Office Fit-Out' }).click();
  await page.locator('.ptab[data-pt="reports"]').click();
  await page.locator('#reportMatrixHost table').first().waitFor();

  const boardReport = page.locator('#reportMatrixHost');
  const boardHeadings = await boardReport.locator('thead th').allTextContents();
  for (const heading of ['Specification and circuit', 'Qty', 'Protection', 'Circuits / ways', 'Source pages', 'Status']) {
    assert.ok(boardHeadings.some((value) => value.trim().toLowerCase() === heading.toLowerCase()), `missing Board Take-Off heading: ${heading}`);
  }
  assert.ok(await boardReport.locator('.report-source-open').count() > 0, 'Board Take-Off rows need source-review windows');
  assert.doesNotMatch(await boardReport.textContent(), /Not specified|Unclear/i, 'deliverable report must keep unresolved prose out of cells');
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

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const mobile = await page.evaluate(() => ({
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    reportScrollable: document.querySelector('#reportMatrixHost').scrollWidth > document.querySelector('#reportMatrixHost').clientWidth,
  }));
  assert.ok(mobile.documentOverflow <= 1, `mobile report page has ${mobile.documentOverflow}px document overflow`);
  assert.equal(mobile.reportScrollable, true, 'wide Device Take-Off must scroll inside its report viewport');
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'report-device-mobile.png'), fullPage: true });

  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('; ')}`);
  console.log('PASS: Board Take-Off, transposed Device Take-Off, source review, correction launch, and responsive report viewport.');
} finally {
  await browser.close();
}
