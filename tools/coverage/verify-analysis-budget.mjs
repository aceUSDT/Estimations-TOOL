/* Browser regression for the large-document analysis budget. A 40-page project
 * must save its deterministic result without cloud work, cap an explicit
 * enhanced pass at three pages, and stop without replacing the prior result.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const playwrightSpecifier = process.env.PLAYWRIGHT_CORE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_CORE_PATH).href
  : 'playwright-core';
const { chromium } = await import(playwrightSpecifier);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const URL = process.env.APP_URL || 'http://127.0.0.1:8765/?test=1';
const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/opt/pw-browsers/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => candidate && fs.existsSync(candidate));
if (!executablePath) throw new Error('No Chromium-compatible browser executable was found');

const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
let postCount = 0;

await page.route('**/api/extract', async (route) => {
  if (route.request().method() === 'GET') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true, executionMode: 'sync', model: 'budget-test' }),
    });
    return;
  }
  postCount += 1;
  await new Promise((resolve) => setTimeout(resolve, 25));
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ result: { boards: [], devices: [], feeds: [], flags: [] } }),
  });
});

page.on('pageerror', (error) => console.log('[pageerror]', String(error).slice(0, 300)));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('typeof state !== "undefined" && typeof runAnalysisWithRecovery === "function"');
  await page.waitForSelector('.proj-card.new', { timeout: 30000 });
  await page.click('.proj-card.new');
  await page.fill('#mName', 'Analysis budget check');
  await page.click('#mOk');
  await page.waitForFunction('state.cur && state.cur.name === "Analysis budget check"');

  await page.evaluate(() => {
    const lines = [
      { text: 'DISTRIBUTION BOARD SCHEDULE' },
      { text: 'DIST/BD Ref: DB/STRESS/01' },
      { text: 'Way Circuit Description Device Rating Phase' },
      { text: 'MCB MCCB RCBO AFDD' },
      { text: '10A 16A 20A 32A' },
    ];
    state.cur.files = [{
      id: 'stress-file',
      name: '40-page-electrical-schedule.txt',
      ext: 'txt',
      status: 'ready',
      native: true,
      pages: Array.from({ length: 40 }, (_, pageIndex) => ({
        lines: pageIndex === 12
          ? [{ text: 'DOCUMENT CONTENTS' }, { text: 'Circuit Charts' }]
          : lines.map((line) => ({ ...line })),
        w: 842,
        h: 595,
        type: pageIndex === 12 ? 'register' : 'db-schedule',
        sub_format: pageIndex === 12 ? 'register' : 'db-schedule',
        threeType: pageIndex === 12 ? 'other' : 'db_schedule',
        typeManual: true,
        source: 'native_text',
        needsOcr: false,
      })),
    }];
    appSettings.onlineExtraction = true;
    appSettings.onlineConsent = true;
    aiProbePromise = null;
    window.__aiStatus = 'checking';
    renderDocs();
    renderAnalysisControls();
    renderProjHeader();
  });

  const automaticStartedAt = Date.now();
  await page.evaluate(() => {
    const projectId = state.cur.id;
    state.cur.analysis = null;
    state.cur = null;
    openProject(projectId);
  });
  await page.waitForFunction('state.cur?.analysis && !analysisBusy', null, { timeout: 10000 });
  const automatic = await page.evaluate(() => state.cur.analysis);
  const automaticElapsedMs = Date.now() - automaticStartedAt;
  const automaticPosts = postCount;
  if (!automatic) throw new Error('automatic deterministic analysis returned no result');
  if (automaticPosts !== 0) throw new Error(`automatic analysis sent ${automaticPosts} cloud pages`);
  if (automaticElapsedMs > 5000) throw new Error(`automatic analysis took ${automaticElapsedMs}ms`);
  if (automatic.pageDiagnostics?.length !== 40) {
    throw new Error(`deterministic analysis inspected ${automatic.pageDiagnostics?.length || 0} of 40 pages`);
  }

  const manualStartedAt = Date.now();
  const manual = await page.evaluate(() => runAnalysisWithRecovery({ noRecovery: true }));
  const manualElapsedMs = Date.now() - manualStartedAt;
  const budget = await page.evaluate(() => ({
    recovery: state.cur.analysis.aiRecovery,
    selection: state.cur.analysis.aiSelectionLog,
    version: state.cur.analysis.version,
  }));
  if (!manual) throw new Error('explicit enhanced analysis returned no result');
  if (postCount !== 3) throw new Error(`enhanced analysis sent ${postCount} pages instead of 3`);
  if (budget.recovery?.eligible !== 39 || budget.recovery?.selected !== 3 || budget.recovery?.deferred !== 36) {
    throw new Error(`unexpected recovery budget: ${JSON.stringify(budget.recovery)}`);
  }
  if (manualElapsedMs > 10000) throw new Error(`bounded enhanced analysis took ${manualElapsedMs}ms`);

  await page.evaluate(() => {
    state.cur.analysis.testMarker = 'saved-before-cancel';
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      if (String(input).endsWith('/api/extract') && String(init.method || 'GET').toUpperCase() === 'POST') {
        return new Promise((resolve, reject) => {
          const signal = init.signal;
          if (signal?.aborted) reject(new DOMException('Analysis stopped', 'AbortError'));
          else signal?.addEventListener('abort', () => reject(new DOMException('Analysis stopped', 'AbortError')), { once: true });
        });
      }
      return nativeFetch(input, init);
    };
    aiProbePromise = Promise.resolve(true);
    window.__aiExecutionMode = 'sync';
    window.__cancelledRun = runAnalysisWithRecovery({ noRecovery: true });
  });
  await page.waitForFunction('analysisBusy && !document.querySelector("#processingCancelBtn").hidden');
  const cancelStartedAt = Date.now();
  await page.click('#processingCancelBtn');
  await page.evaluate(() => window.__cancelledRun);
  const cancelElapsedMs = Date.now() - cancelStartedAt;
  const cancelled = await page.evaluate(() => ({
    busy: analysisBusy,
    marker: state.cur.analysis.testMarker,
    cancelHidden: document.querySelector('#processingCancelBtn').hidden,
  }));
  if (cancelElapsedMs > 2000) throw new Error(`Stop took ${cancelElapsedMs}ms`);
  if (cancelled.busy || !cancelled.cancelHidden) throw new Error('analysis did not leave the running state after Stop');
  if (cancelled.marker !== 'saved-before-cancel') throw new Error('Stop replaced the last saved analysis');

  console.log(JSON.stringify({ automaticElapsedMs, manualElapsedMs, cancelElapsedMs, postCount, budget }, null, 2));
  console.log('PASS: 40-page deterministic analysis, enhanced-extraction budget, and Stop preservation are bounded.');
} finally {
  await browser.close();
}
