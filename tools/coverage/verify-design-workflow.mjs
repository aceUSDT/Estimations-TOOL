import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareReportFixture } from './browser-report-fixture.mjs';

const appUrl = process.env.APP_URL || 'http://127.0.0.1:8773/?test=1&fixture=report';
const shotsDir = process.env.DESIGN_SHOTS_DIR || '';
const playwright = process.env.PLAYWRIGHT_CORE_PATH
  ? await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE_PATH, 'index.mjs')).href)
  : await import('playwright-core');
const { chromium } = playwright;

if (shotsDir) await mkdir(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(String(error)));

try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await prepareReportFixture(page);
  await page.evaluate(() => document.fonts.ready);

  const home = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    font: getComputedStyle(document.body).fontFamily,
    wordmark: document.querySelector('.appbar .brand')?.textContent.trim(),
    brandLogo: getComputedStyle(document.querySelector('.appbar .brand-logo')).display,
    bodySize: parseFloat(getComputedStyle(document.body).fontSize),
    primary: getComputedStyle(document.querySelector('#newProjectBtn')).backgroundColor,
    cardRadius: parseFloat(getComputedStyle(document.querySelector('.proj-card')).borderRadius),
  }));
  assert.ok(home.overflow <= 1, `desktop project page has ${home.overflow}px overflow`);
  assert.match(home.font, /IBM Plex Sans/);
  assert.equal(home.wordmark, 'EstimationTools');
  assert.equal(home.brandLogo, 'block');
  assert.ok(home.bodySize >= 14, `body text is only ${home.bodySize}px`);
  assert.equal(home.primary, 'rgb(0, 121, 168)');
  assert.ok(home.cardRadius <= 8, `project card radius is ${home.cardRadius}px`);
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'design-projects-desktop.png'), fullPage: true });

  await page.locator('.proj-card', { hasText: 'Riverside Office Fit-Out' }).click();
  const tabOrder = await page.locator('.ptab').evaluateAll((tabs) => tabs.map((tab) => tab.dataset.pt));
  assert.deepEqual(tabOrder, ['docs', 'viewer', 'analysis', 'review', 'reports', 'compare']);
  assert.equal(await page.locator('#docBody tr').count(), 5, 'fixture document queue did not render');

  for (const tab of ['docs', 'analysis', 'review', 'reports', 'viewer']) {
    await page.locator(`.ptab[data-pt="${tab}"]`).click();
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `desktop ${tab} page has ${overflow}px document overflow`);
    if (shotsDir) await page.screenshot({ path: join(shotsDir, `design-${tab}-desktop.png`), fullPage: tab !== 'viewer' });
  }
  await page.locator('.ptab[data-pt="docs"]').click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mobileDocs = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    tabOverflow: document.querySelector('.ptabs').scrollWidth - document.querySelector('.ptabs').clientWidth,
    queueOverflow: document.querySelector('.doc-queue-scroll').scrollWidth - document.querySelector('.doc-queue-scroll').clientWidth,
    tabs: [...document.querySelectorAll('.ptab')].map((tab) => {
      const rect = tab.getBoundingClientRect();
      return { visible: rect.left >= 0 && rect.right <= innerWidth, height: rect.height };
    }),
    queueLayout: getComputedStyle(document.querySelector('#docBody tr')).display,
  }));
  assert.ok(mobileDocs.overflow <= 1, `mobile documents page has ${mobileDocs.overflow}px overflow`);
  assert.ok(mobileDocs.tabOverflow <= 1, `mobile navigation has ${mobileDocs.tabOverflow}px overflow`);
  assert.ok(mobileDocs.queueOverflow <= 1, `mobile document queue has ${mobileDocs.queueOverflow}px overflow`);
  assert.ok(mobileDocs.tabs.every((tab) => tab.visible && tab.height >= 44), 'every mobile workflow tab must be visible and touch-sized');
  assert.equal(mobileDocs.queueLayout, 'grid', 'mobile document rows must use the stacked layout');
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'design-documents-mobile.png'), fullPage: false });

  for (const tab of ['analysis', 'review', 'reports', 'viewer']) {
    await page.locator(`.ptab[data-pt="${tab}"]`).click();
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `mobile ${tab} page has ${overflow}px document overflow`);
  }

  const viewer = await page.evaluate(() => ({
    thumbDisplay: getComputedStyle(document.querySelector('#vThumbPanel')).display,
    infoDisplay: getComputedStyle(document.querySelector('#vInfoPanel')).display,
    toolbarOverflow: document.querySelector('.v-toolbar').scrollWidth - document.querySelector('.v-toolbar').clientWidth,
    tab: document.body.dataset.projectTab,
  }));
  assert.equal(viewer.tab, 'viewer');
  assert.equal(viewer.thumbDisplay, 'none');
  assert.equal(viewer.infoDisplay, 'none');
  assert.ok(viewer.toolbarOverflow <= 1, `mobile Viewer toolbar has ${viewer.toolbarOverflow}px overflow`);
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'design-viewer-mobile.png'), fullPage: false });

  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('; ')}`);
  console.log('PASS: supplied design renders across projects, documents, boards, review, reports, and Viewer at desktop and mobile sizes');
} finally {
  await browser.close();
}
