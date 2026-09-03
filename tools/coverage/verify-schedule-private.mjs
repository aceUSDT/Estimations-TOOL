import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

await import('../../extractor-core.js');
await import('../../spatial-schedule-core.js');

const require = createRequire(import.meta.url);
require('../../vendor/pdf.worker.min.js');
require('../../vendor/pdf.min.js');

const pdfjs = globalThis.pdfjsLib;
const Core = globalThis.EstimationExtractorCore;
const args = process.argv.slice(2);
const valueAfter = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const inputPath = args.find((arg) => !arg.startsWith('--') && !/^\d+$/.test(arg));
if (!inputPath) {
  throw new Error('Usage: node verify-schedule-private.mjs <schedule.pdf> [--page 6] [--expect-board DB-01] [--minimum-rows 1] [--minimum-devices 1] [--minimum-spares 0] [--row-limit 20] [--verbose] [--verbose-attempts]');
}

function linesFromTextContent(textContent, viewport) {
  const items = textContent.items.flatMap((item, index) => {
    const transform = pdfjs.Util.transform(viewport.transform, item.transform);
    const width = Math.max(1, Math.abs(item.width * viewport.scale));
    const height = Math.max(1, Math.hypot(transform[2], transform[3]) || 10);
    const angle = Math.atan2(transform[1], transform[0]);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const nx = -sin * height;
    const ny = cos * height;
    const source = String(item.str || '');
    return [...source.matchAll(/\S+/g)].map((match, tokenIndex) => {
      const start = source.length ? match.index / source.length : 0;
      const end = source.length ? (match.index + match[0].length) / source.length : 1;
      const x = transform[4] + cos * width * start;
      const y = transform[5] + sin * width * start;
      const tokenWidth = Math.max(1, width * (end - start));
      const ux = cos * tokenWidth;
      const uy = sin * tokenWidth;
      const corners = [[x, y], [x + ux, y + uy], [x - nx, y - ny], [x + ux - nx, y + uy - ny]];
      const xs = corners.map((point) => point[0]);
      const ys = corners.map((point) => point[1]);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      const x1 = Math.max(...xs);
      const y1 = Math.max(...ys);
      return {
        text: match[0], x, y, width: tokenWidth, height,
        word: {
          id: `pdf-word-${index}-${tokenIndex}`, text: match[0], bbox: [x0, y0, x1 - x0, y1 - y0],
          confidence: 1, rotation: Number((angle * 180 / Math.PI).toFixed(2)),
        },
      };
    });
  }).filter((item) => item.text.trim());
  items.sort((left, right) => Math.abs(left.y - right.y) > 5 ? left.y - right.y : left.x - right.x);
  const lines = [];
  items.forEach((item) => {
    const prior = lines[lines.length - 1];
    if (prior && Math.abs(prior.y - item.y) <= 5) {
      const gap = item.x - (prior.x + prior.width);
      prior.text += `${gap > 8 ? '  ' : ' '}${item.text}`;
      prior.width = item.x + item.width - prior.x;
      prior.words.push(item.word);
    } else {
      lines.push({ text: item.text, x: item.x, y: item.y, width: item.width, height: item.height, words: [item.word] });
    }
  });
  return lines.map((line) => ({
    text: line.text,
    bbox: [line.x, line.y - line.height, line.width, line.height * 1.4],
    confidence: 1,
    words: line.words,
  }));
}

const absolute = path.resolve(inputPath);
assert.equal(path.extname(absolute).toLowerCase(), '.pdf', 'private verifier accepts a PDF source');
const started = performance.now();
const bytes = new Uint8Array(fs.readFileSync(absolute));
const document = await pdfjs.getDocument({
  data: bytes,
  standardFontDataUrl: path.resolve('vendor/standard_fonts') + path.sep,
}).promise;
const requestedPage = Number(valueAfter('--page', 0));
const pageNumbers = requestedPage ? [requestedPage] : Array.from({ length: document.numPages }, (_, index) => index + 1);
const sourcePages = [];
for (const pageNumber of pageNumbers) {
  assert.ok(pageNumber >= 1 && pageNumber <= document.numPages, `page ${pageNumber} exists`);
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const lines = linesFromTextContent(await page.getTextContent(), viewport);
  sourcePages.push({
    lines,
    pageWidth: viewport.width,
    pageHeight: viewport.height,
    pageType: 'db-schedule',
    documentPage: pageNumber,
  });
}

const parsedPages = requestedPage
  ? sourcePages.map((input) => ({ input, result: Core.parseSpatialSchedulePage(input), schemaSourcePage: input.documentPage }))
  : Core.parseSpatialScheduleDocument(sourcePages, { maxSchemaCandidates: 6 }).pages;
const pages = parsedPages.map((entry) => ({
  page: entry.input.documentPage,
  result: entry.result,
  schemaSourcePage: entry.schemaSourcePage,
  attempts: entry.attempts,
}));

const results = pages.map(({ result }) => result);
const rows = results.flatMap((result) => result.rows || []);
const devices = rows.map((row) => Core.reconcileCombinedProtection(row))
  .filter((row) => Core.isCountableProtectionDevice(row));
const spares = rows.filter((row) => row.spare === true && !Core.isCountableProtectionDevice(row));
const boards = [...new Set(results.map((result) => result.board?.ref).filter(Boolean))];
const summary = {
  source: path.basename(absolute),
  documentPages: document.numPages,
  testedPages: pageNumbers,
  matchedPages: results.filter((result) => result.matched).length,
  boards,
  rows: rows.length,
  devices: devices.length,
  spares: spares.length,
  inferredRows: rows.filter((row) => row.inferredWay).length,
  blockingGridIssues: results.flatMap((result) => result.grid?.blockingReasons || []),
  elapsedMs: Math.round(performance.now() - started),
  pages: pages.map(({ page, result, schemaSourcePage, attempts }) => {
    const pageSummary = {
      page,
      schemaSourcePage,
      matched: Boolean(result.matched),
      board: result.board?.ref || null,
      rows: result.rows?.length || 0,
      devices: (result.rows || []).filter((row) => Core.isCountableProtectionDevice(Core.reconcileCombinedProtection(row))).length,
      spares: (result.rows || []).filter((row) => row.spare === true && !Core.isCountableProtectionDevice(row)).length,
      inferredRows: (result.rows || []).filter((row) => row.inferredWay).length,
      reviewRows: (result.rows || []).filter((row) => row.requiresReview).length,
      schema: result.schema?.columns?.map((column) => column.role) || [],
      warnings: result.warnings || [],
    };
    if (args.includes('--verbose-attempts')) pageSummary.attempts = attempts;
    return pageSummary;
  }),
};
const focusPage = Number(valueAfter('--focus-page', 0));
if (focusPage) summary.pages = summary.pages.filter((page) => page.page === focusPage);
if (args.includes('--summary-only')) {
  summary.pages = summary.pages.filter((page) => !page.matched || page.reviewRows || page.inferredRows
    || page.warnings.some((warning) => warning !== 'schedule_continuation_board_inherited'));
}

if (args.includes('--verbose')) {
  const rowLimit = Math.max(1, Number(valueAfter('--row-limit', 20)) || 20);
  const detailPages = focusPage ? pages.filter((entry) => entry.page === focusPage) : pages;
  const allDetailRows = detailPages.flatMap((entry) => entry.result.rows || []);
  const detailRows = args.includes('--review-only')
    ? allDetailRows.filter((row) => row.requiresReview)
    : allDetailRows;
  summary.schemaDetails = detailPages.map(({ page, result, schemaSourcePage }) => ({
    page,
    schemaSourcePage,
    confidence: result.schema?.confidence ?? null,
    deviceFamilyHint: result.schema?.deviceFamilyHint || null,
    columns: (result.schema?.columns || []).map((column) => ({
      role: column.role,
      x: Number(column.x?.toFixed?.(2) ?? column.x),
      left: Number(column.left?.toFixed?.(2) ?? column.left),
      right: Number(column.right?.toFixed?.(2) ?? column.right),
      evidence: column.evidence?.text || null,
      source: column.source || null,
    })),
  }));
  const compactRows = args.includes('--compact-rows');
  summary.rowDetails = detailRows.slice(0, rowLimit).map((row) => ({
    way: row.way, phase: row.phase, device: row.device, rating: row.rating,
    curve: row.curve, poles: row.poles, rcdProtected: row.rcdProtected,
    rcdMa: row.sens, rcdType: row.rcdType, afdd: row.afdd,
    spare: row.spare, space: row.space, requiresReview: row.requiresReview,
    physicalSlotCount: row.physicalSlotCount,
    physicalPhaseSlots: row.physicalPhaseSlots,
    phaseSlotIndependent: row.phaseSlotIndependent,
    sharedPhaseSpan: row.sharedPhaseSpan,
    explicitOccupancy: row.explicitOccupancy,
    description: row.desc,
    ...(compactRows ? {} : {
      reasons: row.resolutionReasons,
      fields: Object.fromEntries(Object.entries(row.fieldSources || {}).map(([role, cell]) => [role, cell?.text || null])),
    }),
  }));
  summary.boardDetails = detailPages.map((entry) => entry.result).filter((result) => result.board).map((result) => result.board);
  if (args.includes('--dump-input')) {
    summary.inputDetails = sourcePages
      .filter((input) => !focusPage || input.documentPage === focusPage)
      .map((input) => ({
        page: input.documentPage,
        width: input.pageWidth,
        height: input.pageHeight,
        lines: input.lines.map((line) => ({
          text: line.text,
          bbox: line.bbox,
          words: (line.words || []).map((word) => ({
            text: word.text,
            bbox: word.bbox,
            rotation: word.rotation,
          })),
        })),
      }));
  }
  if (args.includes('--dump-way-tokens')) {
    summary.wayTokenDetails = sourcePages
      .filter((input) => !focusPage || input.documentPage === focusPage)
      .map((input) => ({
        page: input.documentPage,
        tokens: Core.collectSpatialWords(input)
          .filter((word) => /^[A-Z]{1,3}\d{1,3}(?:[\/-]?L[123])$/i.test(String(word.text || '').trim()))
          .map((word) => ({
            text: word.text,
            cx: Number(word.cx.toFixed(2)),
            cy: Number(word.cy.toFixed(2)),
            rotation: word.rotation,
          })),
      }));
  }
}

const expectBoard = valueAfter('--expect-board');
if (expectBoard) {
  const expected = Core.canonicalBoardReference(expectBoard).normalised;
  assert.ok(boards.some((board) => Core.canonicalBoardReference(board).normalised === expected), `board ${expectBoard} was extracted`);
}
assert.ok(rows.length >= Number(valueAfter('--minimum-rows', 0)), 'minimum schedule-row count was met');
assert.ok(devices.length >= Number(valueAfter('--minimum-devices', 0)), 'minimum device count was met');
assert.ok(spares.length >= Number(valueAfter('--minimum-spares', 0)), 'minimum explicit-spare count was met');
console.log(JSON.stringify(summary, null, 2));
