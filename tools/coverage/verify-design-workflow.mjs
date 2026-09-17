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

  const quotedName = 'Quoted " onpointerover="alert(1) <project> & estimate';
  const quotedId = await page.evaluate(name => { const project = newProject(name);state.projects.push(project);renderProjects();return project.id; }, quotedName);
  assert.equal(await page.locator('.proj-card [onpointerover]').count(), 0, 'project names must not escape into executable attributes');
  const quotedRename = page.getByRole('button', { name: `Rename ${quotedName}`, exact: true });
  await quotedRename.click();
  assert.equal(await page.locator('#mName').inputValue(), quotedName, 'quotes must survive the rename editor without becoming markup');
  await page.locator('#mCancel').click();
  await page.evaluate(id => { state.projects = state.projects.filter(project => project.id !== id);renderProjects(); }, quotedId);

  // Search and filtering change the library, never the saved project set.
  const initialProjects = await page.evaluate(() => state.projects.map(project => project.id));
  const search = page.getByRole('searchbox', { name: 'Find a project' });
  await search.fill('riverside');
  assert.equal(await page.locator('.proj-card:not(.new)').count(), 1);
  await search.fill('no matching project <script>');
  assert.equal(await page.locator('.proj-card:not(.new)').count(), 0);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  assert.equal(await search.inputValue(), '');
  await page.getByRole('button', { name: 'Not analysed', exact: true }).click();
  assert.equal(await page.locator('.proj-card:not(.new)').count(), 1);
  assert.match(await page.locator('.proj-card:not(.new)').innerText(), /DB-05 revision comparison/);
  await page.getByRole('button', { name: 'Needs attention', exact: true }).click();
  assert.equal(await page.locator('.proj-card:not(.new)').count(), 1);
  assert.match(await page.locator('.proj-card:not(.new)').innerText(), /Riverside/);
  await page.getByRole('button', { name: 'All projects', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => state.projects.map(project => project.id)), initialProjects);
  // Opening a card by keyboard must restore the project heading, not inherit
  // a scrolled library position below the next-action controls.
  await page.evaluate(() => window.scrollTo(0, 250));
  await page.getByRole('button', { name: 'Riverside Office Fit-Out (demo)', exact: true }).press('Enter');
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  assert.equal(await page.locator('#workspaceNextTitle').textContent(), 'Resolve extraction issues');
  assert.match(await page.locator('#workspaceNextDetail').textContent(), /evidenced board reference/);
  await page.locator('#workspaceNextBtn').click();
  assert.equal(await page.evaluate(() => document.body.dataset.projectTab), 'analysis');
  assert.equal(await page.evaluate(() => currentReportExportReadiness().allowed), false, 'guidance must not waive extraction blockers');
  await page.locator('.ptab[data-pt="docs"]').click();
  // Keyboard activation opens the chooser without uploading any file.
  const chooserOpened = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add source documents', exact: true }).press('Enter');
  const chooser = await chooserOpened;
  assert.equal(chooser.isMultiple(), true);
  await chooser.setFiles([]);
  const guidance = await page.evaluate(() => {
    const p = { files: [], analysis: null };
    const empty = projectNextStep(p).tab;
    p.files = [{ status: 'error', pages: [] }];
    const error = projectNextStep(p).tab;
    p.files = [{ status: 'ready', pages: [] }];
    p.analysis = { boards: {}, rows: [], health: { state: 'complete' } };
    const orphan = projectNextStep(p, { docs: 1, review: 0, unassignedRows: 1, unassignedPages: 1 });
    const reviewed = projectNextStep(p).title;
    p.files.push({ status: 'processing', pages: [] });
    const processing = projectNextStep(p);
    return { empty, error, orphanTab: orphan.tab, orphanTone: orphan.tone, reviewed, processing: { key: processing.key, tab: processing.tab } };
  });
  assert.deepEqual(guidance, { empty: 'docs', error: 'docs', orphanTab: 'analysis', orphanTone: 'red', reviewed: 'Check report readiness', processing: { key: 'processing', tab: 'docs' } });
  const lifecycle = await page.evaluate(async () => {
    const task = runAnalysis({ auto: true, noAi: true });
    const during = { title: document.querySelector('#workspaceNextTitle').textContent, devices: document.querySelector('#workspaceDevices').textContent };
    await task;
    return { during, after: { title: document.querySelector('#workspaceNextTitle').textContent, devices: document.querySelector('#workspaceDevices').textContent }, expectedDevices: String(projStats(state.cur).devices) };
  });
  assert.deepEqual(lifecycle.during, { title: 'Reading your source documents', devices: '—' });
  assert.notEqual(lifecycle.after.title, lifecycle.during.title, 'finished analysis must clear the processing guidance');
  assert.equal(lifecycle.after.devices, lifecycle.expectedDevices);
  const repeatedAudit = await page.evaluate(() => {
    const board = { norm: 'DB1', orig: 'DB-1', scheduleEvidence: true, pages: [] };
    const rows = [20, 32].map((rating, i) => ({ id: `audit-duplicate-${i}`, boardNorm: 'DB1', fileId: 'synthetic', page: 1, way: 1, phase: 'L1', rating, status: 'pending', conf: 0.9 }));
    const otherPage = { ...rows[0], id: 'other-page', page: 2 };
    const analysis = { boards: { DB1: board }, rows: [...rows, otherPage] };
    applyAiAudit(analysis, { verification: { status: 'done', mismatches: [{ kind: 'field_mismatch', board: 'DB-1', way: 1, phase: 'L1', field: 'rating_a', primary: 32, second: 25, detail: 'Agents disagree on rating_a: 32 vs 25' }] } }, 'synthetic', 1, { primaryBoard: board });
    return analysis.rows.map(row => ({ rating: row.rating, pending: row.status === 'pending', marked: Boolean(row.xcheck), requiresReview: Boolean(row.requiresReview) }));
  });
  assert.deepEqual(repeatedAudit, [
    { rating: 20, pending: true, marked: true, requiresReview: true },
    { rating: 32, pending: true, marked: true, requiresReview: true },
    { rating: 20, pending: true, marked: false, requiresReview: false },
  ], 'ambiguous provider occurrences must mark all same-page candidates without changing their electrical values');
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

  await page.setViewportSize({ width: 1024, height: 768 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'laptop workflow must fit the document width');
  const actionFits = await page.locator('#workspaceNextBtn').evaluate(button => { const r = button.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
  assert.equal(actionFits, true, 'laptop next action must remain in view');
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'design-documents-laptop.png'), fullPage: false });

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
  assert.equal(await page.locator('#workspaceSummary').isVisible(), false, 'source review keeps the canvas space instead of repeating the summary');
  assert.equal(viewer.thumbDisplay, 'none');
  assert.equal(viewer.infoDisplay, 'none');
  assert.ok(viewer.toolbarOverflow <= 1, `mobile Viewer toolbar has ${viewer.toolbarOverflow}px overflow`);
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'design-viewer-mobile.png'), fullPage: false });

  await page.getByRole('button', { name: 'Project library', exact: true }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'mobile project library must not overflow');
  assert.equal(await page.locator('#projectSearch').isVisible(), true);
  const touchFilters = await page.locator('[data-project-filter]').evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height >= 44));
  assert.equal(touchFilters, true, 'mobile project filters must be touch-sized');
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'design-projects-mobile.png'), fullPage: true });

  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('; ')}`);
  console.log('PASS: workspace search/filter, keyboard navigation, conservative next-action guidance, file chooser, and projects/documents/boards/review/reports/Viewer at desktop, laptop and mobile sizes');
} finally {
  await browser.close();
}
