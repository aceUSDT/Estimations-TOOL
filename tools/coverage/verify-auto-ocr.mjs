/* End-to-end check for WS0.1: dropping a scanned PDF must auto-OCR and analyse
 * with no manual OCR click. Drives the real app in Chromium against a local
 * static server (?test=1 unlocks on localhost only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const playwrightSpecifier = process.env.PLAYWRIGHT_CORE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_CORE_PATH).href
  : 'playwright-core';
const { chromium } = await import(playwrightSpecifier);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FIXTURES = process.argv.length > 2
  ? process.argv.slice(2).map((fixture) => path.resolve(fixture))
  : [path.join(ROOT, 'examples/db-schedules/simple/BC250847-E13_Distribution.pdf')];
const URL = process.env.APP_URL || 'http://127.0.0.1:8765/?test=1';

const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/opt/pw-browsers/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => candidate && fs.existsSync(candidate));
if (!executablePath) throw new Error('No Chromium-compatible browser executable was found');
const browser = await chromium.launch({ executablePath });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();

/* Serve every CDN asset from local disk so the check is hermetic (the sandbox
 * proxy MITMs TLS, which Chromium rejects). Same files, same versions. */
const NM = path.join(HERE, 'node_modules');
const VENDOR = path.join(HERE, 'vendor');
const mime = (p) => p.endsWith('.wasm') ? 'application/wasm' : p.endsWith('.gz') ? 'application/gzip' : 'application/javascript';
await page.route(/https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com)\/.*/, async (route) => {
  const url = route.request().url();
  const base = url.split('?')[0].split('/').pop();
  let file = null;
  if (base === 'pdf.min.js' || base === 'pdf.worker.min.js') file = path.join(VENDOR, base);
  else if (base === 'tesseract.min.js') file = path.join(NM, 'tesseract.js/dist/tesseract.min.js');
  else if (base === 'worker.min.js') file = path.join(NM, 'tesseract.js/dist/worker.min.js');
  else if (base.startsWith('tesseract-core')) file = path.join(NM, 'tesseract.js-core', base);
  else if (base.endsWith('.traineddata.gz')) file = path.join(VENDOR, 'eng.traineddata.gz');
  if (file && fs.existsSync(file)) {
    await route.fulfill({ status: 200, contentType: mime(base), body: fs.readFileSync(file) });
  } else {
    console.log('[route] no local file for', url);
    await route.abort();
  }
});
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('typeof state !== "undefined"');
  // boot() seeds demo projects on first run; wait for cards then create a fresh project
  await page.waitForSelector('.proj-card.new', { timeout: 30000 });
  await page.click('.proj-card.new');
  await page.fill('#mName', 'AutoOCR check');
  await page.click('#mOk');
  await page.waitForFunction('state.cur && state.cur.name === "AutoOCR check"');
  const analysisStartedAt = Date.now();
  await page.setInputFiles('#fileInput', FIXTURES);
  console.log('file dropped; waiting for ingest + auto-OCR + analysis…');
  await page.waitForFunction(
    `state.cur.files.length === ${FIXTURES.length} && state.cur.files.every(file => file.status === "ready")`,
    null, { timeout: 120000 },
  );
  const scanned = await page.evaluate('state.cur.files.reduce((sum, file) => sum + file.pages.filter(p => !(p.lines||[]).length).length, 0)');
  console.log('pages without text after ingest (pre-OCR):', scanned);
  await page.waitForFunction(
    'state.cur.files.every(file => file.pages.every(p => (p.lines||[]).length)) && state.cur.analysis',
    null, { timeout: 300000 },
  );
  if (process.env.DUMP_PAGE_JSON) {
    const pageDump = await page.evaluate(`(() => {
      const file = state.cur.files[${Number(process.env.DUMP_FILE_INDEX) || 0}];
      const page = file?.pages?.[${Math.max(0, (Number(process.env.DUMP_PAGE_NUMBER) || 1) - 1)}];
      return page ? {
        name: file.name, page: ${Number(process.env.DUMP_PAGE_NUMBER) || 1},
        width: page.w, height: page.h, type: page.type,
        lines: page.lines, tableRows: page.tableRows,
      } : null;
    })()`);
    fs.writeFileSync(path.resolve(process.env.DUMP_PAGE_JSON), JSON.stringify(pageDump, null, 2));
  }
  const res = await page.evaluate(`({
    ocrReady: state.cur.files.every(file => file.ocrReady === true || file.pages.every(page => page.source !== 'ocr')),
    pageLines: state.cur.files.flatMap(file => file.pages.map(p => (p.lines||[]).length)),
    pageTypes: state.cur.files.flatMap(file => file.pages.map(p => p.type)),
    classificationAudit: state.cur.files.flatMap(file => file.pages.map(page => window.EstimationExtractorCore.classifyPageText((page.lines || []).map(line => line.text).join('\\n')))),
    rows: state.cur.analysis.rows.length,
    feeders: state.cur.analysis.feeders.length,
    schematicDevices: (state.cur.analysis.schematicDevices || []).length,
    boards: Object.keys(state.cur.analysis.boards),
    takeoffBoards: Object.values(state.cur.analysis.boards).filter(board => board.inScope !== false).length,
    status: state.cur.status,
    coverage: state.cur.analysis.coverage ? {
      boards: state.cur.analysis.coverage.summary.boards,
      zeroRowPages: state.cur.analysis.coverage.zeroRowSchedulePages.length,
    } : null,
    health: state.cur.analysis.health,
    pageDiagnostics: state.cur.analysis.pageDiagnostics?.filter(item => {
      const auditPage = ${Number(process.env.AUDIT_PAGE_NUMBER) || 0};
      return !auditPage || Number(item.page) === auditPage;
    }),
    boardDetails: Object.fromEntries(Object.entries(state.cur.analysis.boards).filter(([key]) => {
      const auditBoard = ${JSON.stringify(process.env.AUDIT_BOARD || '')};
      return !auditBoard || key === auditBoard;
    }).map(([key, board]) => [key, {
      ref: board.orig,
      type: board.type,
      family: board.family,
      header: board.header,
      inScope: board.inScope,
    }])),
    rowDetails: ${process.env.AUDIT_ROWS === '1' ? `state.cur.analysis.rows.filter(row => {
      const auditBoard = ${JSON.stringify(process.env.AUDIT_BOARD || '')};
      const auditPage = ${Number(process.env.AUDIT_PAGE_NUMBER) || 0};
      const boardMatches = !auditBoard || row.boardNorm === auditBoard
        || String(row.circuitReference || '').replace(/[^A-Z0-9]/gi, '').toUpperCase() === auditBoard;
      return boardMatches && (!auditPage || Number(row.page) === auditPage);
    }).map(row => ({
      id: row.id, page: row.page, boardNorm: row.boardNorm, way: row.way, phase: row.phase,
      device: row.device, rating: row.rating, poles: row.poles,
      rcdProtected: row.rcdProtected, sens: row.sens, afdd: row.afdd,
      spare: row.spare, space: row.space, desc: row.desc,
      requiresReview: row.requiresReview, status: row.status,
      sourceKey: row.sourceKey, highlightBbox: row.highlightBbox,
      resolutionSource: row.resolutionSource, resolutionReasons: row.resolutionReasons,
    }))` : 'undefined'},
    rowCountByPage: Object.values(state.cur.analysis.rows.reduce((pages, row) => {
      const key = String(row.page || 0);
      const current = pages[key] || (pages[key] = { page: row.page || null, rows: 0, devices: 0, spares: 0, blanks: 0, review: 0 });
      current.rows += 1;
      if (window.EstimationExtractorCore.isCountableProtectionDevice(window.EstimationExtractorCore.reconcileCombinedProtection(row))) current.devices += 1;
      if (row.spare) current.spares += 1;
      if (row.space) current.blanks += 1;
      if (row.requiresReview) current.review += 1;
      return pages;
    }, {})).sort((left, right) => left.page - right.page),
    rowCountByBoard: Object.entries(state.cur.analysis.rows.reduce((boards, row) => {
      const key = row.boardNorm || 'UNASSIGNED';
      const current = boards[key] || (boards[key] = { board: key, rows: 0, devices: 0, spares: 0, blanks: 0, review: 0 });
      current.rows += 1;
      if (window.EstimationExtractorCore.isCountableProtectionDevice(window.EstimationExtractorCore.reconcileCombinedProtection(row))) current.devices += 1;
      if (row.spare) current.spares += 1;
      if (row.space) current.blanks += 1;
      if (row.requiresReview) current.review += 1;
      return boards;
    }, {})).map(([, value]) => value).sort((left, right) => left.board.localeCompare(right.board)),
    feederDetails: ${(process.env.AUDIT_ROWS === '1' || process.env.AUDIT_FEEDERS === '1') ? `state.cur.analysis.feeders.filter(feeder => {
      const auditBoard = ${JSON.stringify(process.env.AUDIT_BOARD || '')};
      return !auditBoard || feeder.from === auditBoard || feeder.to === auditBoard;
    }).map(feeder => ({
      from: feeder.from, to: feeder.to, device: feeder.device, rating: feeder.rating,
      poles: feeder.poles, poleConfiguration: feeder.poleConfiguration,
      cable: feeder.cable, confidence: feeder.conf, sourceRole: feeder.sourceRole,
    }))` : 'undefined'},
    spatialAudit: ${(process.env.AUDIT_ROWS === '1' || process.env.AUDIT_SCHEMA === '1') ? `(() => {
      const auditPage = Math.max(1, ${Number(process.env.AUDIT_PAGE_NUMBER) || 1});
      const pg = state.cur.files[0]?.pages?.[auditPage - 1];
      if (!pg || !window.EstimationExtractorCore?.parseSpatialSchedulePage) return null;
      const parsed = window.EstimationExtractorCore.parseSpatialSchedulePage({
        lines: pg.lines || [], tableRows: pg.tableRows || [],
        pageWidth: pg.w, pageHeight: pg.h, pageType: pg.type,
      });
      return {
        page: auditPage,
        matched: parsed.matched,
        rowCount: parsed.rows?.length || 0,
        reviewRows: parsed.rows?.filter(row => row.requiresReview).length || 0,
        grid: parsed.grid || null,
        schema: parsed.schema?.columns?.map(column => ({
          role: column.role, x: column.x, left: column.left, right: column.right,
          source: column.source, evidence: column.evidence?.text || null,
        })),
        header: parsed.board?.header || null,
        rows: parsed.rows?.slice(0, ${Math.max(4, Number(process.env.AUDIT_ROW_LIMIT) || 80)}).map(row => ({
          way: row.way, phase: row.phase, device: row.device, rating: row.rating,
          rcdProtected: row.rcdProtected, sens: row.sens, poles: row.poles,
          spare: row.spare, space: row.space, desc: row.desc,
          requiresReview: row.requiresReview, highlightBbox: row.highlightBbox,
          ${process.env.AUDIT_COMPACT === '1' ? '' : "cells: Object.fromEntries(Object.entries(row.fieldSources || {}).map(([key, cell]) => [key, cell?.text || null])),"}
        })),
      };
    })()` : 'undefined'},
    textAudit: ${process.env.AUDIT_TEXT === '1' ? `(() => {
      const pg = state.cur.files[0]?.pages?.[0];
      const focusX = ${Number(process.env.AUDIT_FOCUS_X) || 'null'};
      if (Number.isFinite(focusX)) {
        return (pg?.lines || []).flatMap((line, lineIndex) => (line.words || []).map(word => ({
          lineIndex, text: word.text, bbox: word.bbox, rotation: word.rotation,
        }))).filter(word => {
          const x = Number(word.bbox?.[0]);
          return Number.isFinite(x) && x >= focusX - 70 && x <= focusX + 100;
        }).sort((left, right) => Number(left.bbox?.[1]) - Number(right.bbox?.[1]));
      }
      return (pg?.lines || []).map((line, lineIndex) => ({
        lineIndex, text: line.text, bbox: line.bbox,
        words: (line.words || []).map(word => ({ text: word.text, bbox: word.bbox, rotation: word.rotation })),
      })).filter(line => /DB-G9|250A|120mm|MCCB|LVS1|LV Schematic/i.test(line.text));
    })()` : 'undefined'},
    coveragePanelText: document.querySelector('#covSummary') ? document.querySelector('#covSummary').textContent : null,
    reviewItems: (() => { setTab('review'); return document.querySelectorAll('#reviewList .rev-item').length; })(),
  })`);
  res.elapsedMs = Date.now() - analysisStartedAt;
  const printable = process.env.AUDIT_ROWS_ONLY === '1' ? {
    pageDiagnostics: res.pageDiagnostics,
    rowDetails: res.rowDetails,
    spatialAudit: res.spatialAudit,
    elapsedMs: res.elapsedMs,
  } : process.env.AUDIT_FOCUSED === '1' ? {
    rows: res.rows,
    status: res.status,
    health: res.health,
    pageDiagnostics: res.pageDiagnostics,
    boardDetails: res.boardDetails,
    rowDetails: res.rowDetails,
    rowCountByPage: res.rowCountByPage,
    spatialAudit: res.spatialAudit,
    elapsedMs: res.elapsedMs,
  } : process.env.SUMMARY_ONLY === '1' ? {
    ocrReady: res.ocrReady,
    pages: res.pageLines.length,
    pageTypes: res.pageTypes,
    rows: res.rows,
    feeders: res.feeders,
    schematicDevices: res.schematicDevices,
    boards: res.boards,
    takeoffBoards: res.takeoffBoards,
    status: res.status,
    coverage: res.coverage,
    health: res.health,
    boardDetails: res.boardDetails,
    rowDetails: res.rowDetails,
    rowCountByPage: res.rowCountByPage,
    rowCountByBoard: res.rowCountByBoard,
    spatialAudit: res.spatialAudit,
    reviewItems: res.reviewItems,
    elapsedMs: res.elapsedMs,
  } : res;
  console.log(JSON.stringify(printable, null, 2));
  if (!res.pageLines.every((n) => n > 0)) throw new Error('document ingestion did not populate page lines');
  if (scanned > 0 && !res.ocrReady) throw new Error('auto-OCR did not populate scanned pages');
  if (!res.coverage) throw new Error('analysis.coverage missing — reconciliation pass did not run');
  const exactExpectation = (name, actual) => {
    if (process.env[name] == null) return;
    if (actual !== Number(process.env[name])) throw new Error(`${name} expected ${process.env[name]}, received ${actual}`);
  };
  const maximumExpectation = (name, actual) => {
    if (process.env[name] == null) return;
    if (actual > Number(process.env[name])) throw new Error(`${name} expected at most ${process.env[name]}, received ${actual}`);
  };
  const minimumExpectation = (name, actual) => {
    if (process.env[name] == null) return;
    if (actual < Number(process.env[name])) throw new Error(`${name} expected at least ${process.env[name]}, received ${actual}`);
  };
  exactExpectation('EXPECT_ROWS', res.rows);
  exactExpectation('EXPECT_DEVICES', res.health?.counters?.deviceCount);
  exactExpectation('EXPECT_REVIEW_ITEMS', res.reviewItems);
  exactExpectation('EXPECT_TAKEOFF_BOARDS', res.takeoffBoards);
  maximumExpectation('EXPECT_MAX_ELAPSED_MS', res.elapsedMs);
  minimumExpectation('EXPECT_MIN_FEEDERS', res.feeders);
  console.log('\nPASS: auto-OCR ran, analysis completed, and the reconciliation/coverage pass populated analysis.coverage.');
} finally {
  await browser.close();
}
