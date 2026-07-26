/* End-to-end check for WS0.1: dropping a scanned PDF must auto-OCR and analyse
 * with no manual OCR click. Drives the real app in Chromium against a local
 * static server (?test=1 unlocks on localhost only).
 */
import path from 'node:path';
import { DEFAULT_FIXTURE } from './lib/paths.mjs';
import { launchAppPage, openNewProject } from './lib/browser.mjs';

const FIXTURE = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FIXTURE;

const { browser, page } = await launchAppPage({ logConsoleErrors: true });

try {
  await openNewProject(page, 'AutoOCR check');
  await page.setInputFiles('#fileInput', FIXTURE);
  console.log('file dropped; waiting for ingest + auto-OCR + analysis…');
  await page.waitForFunction(
    'state.cur.files.length === 1 && state.cur.files[0].status === "ready"',
    null, { timeout: 120000 },
  );
  const scanned = await page.evaluate('state.cur.files[0].pages.filter(p => !(p.lines||[]).length).length');
  console.log('pages without text after ingest (pre-OCR):', scanned);
  await page.waitForFunction(
    'state.cur.files[0].pages.every(p => (p.lines||[]).length) && state.cur.analysis',
    null, { timeout: 300000 },
  );
  const res = await page.evaluate(`({
    ocrReady: state.cur.files[0].ocrReady === true,
    pageLines: state.cur.files[0].pages.map(p => (p.lines||[]).length),
    pageTypes: state.cur.files[0].pages.map(p => p.type),
    rows: state.cur.analysis.rows.length,
    boards: Object.keys(state.cur.analysis.boards),
    status: state.cur.status,
    coverage: state.cur.analysis.coverage ? {
      boards: state.cur.analysis.coverage.summary.boards,
      zeroRowPages: state.cur.analysis.coverage.zeroRowSchedulePages.length,
    } : null,
    coveragePanelText: document.querySelector('#covSummary') ? document.querySelector('#covSummary').textContent : null,
    reviewItems: (() => { setTab('review'); return document.querySelectorAll('#reviewList .rev-item').length; })(),
  })`);
  console.log(JSON.stringify(res, null, 2));
  if (!res.ocrReady || !res.pageLines.every((n) => n > 0)) throw new Error('auto-OCR did not populate page lines');
  if (!res.coverage) throw new Error('analysis.coverage missing — reconciliation pass did not run');
  console.log('\nPASS: auto-OCR ran, analysis completed, and the reconciliation/coverage pass populated analysis.coverage.');
} finally {
  await browser.close();
}
