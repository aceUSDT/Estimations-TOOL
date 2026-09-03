import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

await import('../../extractor-core.js');
await import('../../spatial-schedule-core.js');
await import('../../schematic-topology-core.js');

const require = createRequire(import.meta.url);
require('../../vendor/pdf.worker.min.js');
require('../../vendor/pdf.min.js');
const pdfjs = globalThis.pdfjsLib;
const Core = globalThis.EstimationExtractorCore;

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const valuesAfter = (flag) => args.flatMap((arg, index) => arg === flag && args[index + 1] ? [args[index + 1]] : []);
const inputPath = args.find((arg) => !arg.startsWith('--') && !/^\d+$/.test(arg));
if (!inputPath) throw new Error('Usage: node verify-schematic-private.mjs <schematic.pdf> [--page 1] [--minimum-boards 5] [--minimum-feeds 1] [--expect-edge LVS1>LVS2] [--maximum-ms 10000]');
const pageNumber = Number(valueAfter('--page', '1'));
const minimumBoards = Number(valueAfter('--minimum-boards', '5'));
const minimumFeeds = Number(valueAfter('--minimum-feeds', '1'));
const minimumScheduleRows = Number(valueAfter('--minimum-schedule-rows', '0'));
const maximumMs = Number(valueAfter('--maximum-ms', '10000'));
const expectedEdges = valuesAfter('--expect-edge');
const expectedBoards = valuesAfter('--expect-board');
const absolute = path.resolve(inputPath);
assert.equal(path.extname(absolute).toLowerCase(), '.pdf', 'private verifier accepts a PDF source');

function linesFromTextContent(textContent, viewport) {
  const items = textContent.items.map((item, index) => {
    const transform = pdfjs.Util.transform(viewport.transform, item.transform);
    const width = Math.max(1, Math.abs(item.width * viewport.scale));
    const height = Math.max(1, Math.hypot(transform[2], transform[3]) || 10);
    const angle = Math.atan2(transform[1], transform[0]);
    const ux = Math.cos(angle) * width;
    const uy = Math.sin(angle) * width;
    const nx = -Math.sin(angle) * height;
    const ny = Math.cos(angle) * height;
    const corners = [[transform[4], transform[5]], [transform[4] + ux, transform[5] + uy],
      [transform[4] - nx, transform[5] - ny], [transform[4] + ux - nx, transform[5] + uy - ny]];
    const xs = corners.map((point) => point[0]);
    const ys = corners.map((point) => point[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const x1 = Math.max(...xs);
    const y1 = Math.max(...ys);
    return {
      text: item.str,
      x: transform[4], y: transform[5], width, height,
      word: { id: `pdf-word-${index}`, text: item.str, bbox: [x0, y0, x1 - x0, y1 - y0],
        confidence: 1, rotation: Number((angle * 180 / Math.PI).toFixed(2)) },
    };
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
    } else lines.push({ text: item.text, x: item.x, y: item.y, width: item.width, height: item.height, words: [item.word] });
  });
  return lines.map((line) => ({ text: line.text, bbox: [line.x, line.y - line.height, line.width, line.height * 1.4], confidence: 1, words: line.words }));
}

const started = performance.now();
const bytes = new Uint8Array(fs.readFileSync(absolute));
const document = await pdfjs.getDocument({ data: bytes, standardFontDataUrl: path.resolve('vendor/standard_fonts') + path.sep }).promise;
assert.ok(pageNumber >= 1 && pageNumber <= document.numPages, 'requested page exists');
const page = await document.getPage(pageNumber);
const viewport = page.getViewport({ scale: 1 });
const textContent = await page.getTextContent();
const lines = linesFromTextContent(textContent, viewport);
const operatorList = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode?.DISABLE ?? 0 });
const geometry = Core.extractPdfVectorGeometry({ operatorList, OPS: pdfjs.OPS, viewportTransform: viewport.transform,
  pageWidth: viewport.width, pageHeight: viewport.height, ignoreAnnotations: true });
const parsed = Core.parseSchematicTopologyPage({ lines, pageWidth: viewport.width, pageHeight: viewport.height,
  pageType: 'sld', vectorGeometry: geometry });
const schedule = Core.parseSpatialSchedulePage({ lines, pageWidth: viewport.width, pageHeight: viewport.height,
  pageType: 'schematic' });
const transposedSchedule = Core.isTransposedSchedulePage({ lines, pageWidth: viewport.width, pageHeight: viewport.height });
const elapsedMs = Math.round(performance.now() - started);

if (args.includes('--verbose')) {
  console.log(JSON.stringify(parsed.boards.map((board) => ({ ref: board.ref, norm: board.norm,
    sourceScore: board.sourceScore, anchor: board.anchor ? [board.anchor.x, board.anchor.y, board.anchor.component] : null,
    anchorDistance: board.anchorDistance, sourceBox: board.sourceCell?.bbox || null,
    anchorCandidates: parsed.diagnostics?.sourceAnchorCandidates?.[board.norm] || [], ambiguous: board.anchorAmbiguous })), null, 2));
  console.log(JSON.stringify(parsed.feeds.map((feed) => ({ from: feed.fromRef, to: feed.toRef, rating: feed.rating,
    device: feed.device, cable: feed.cable?.size || null, confidence: feed.confidence, pathEvidence: feed.pathEvidence,
    warnings: feed.warnings })), null, 2));
  console.log(JSON.stringify(parsed.diagnostics, null, 2));
  console.log(JSON.stringify({
    schedule: {
      matched: Boolean(schedule.matched), dialect: schedule.dialect || null, board: schedule.board?.ref || null,
      transposedProfile: transposedSchedule,
      warnings: schedule.warnings || [], schema: schedule.schema?.columns?.map((column) => column.role) || [],
      rows: (schedule.rows || []).map((row) => ({ way: row.way, phase: row.phase, device: row.device,
        rating: row.rating, curve: row.curve, tripUnit: row.tripUnit, description: row.desc,
        spare: row.spare, requiresReview: row.requiresReview })),
    },
  }, null, 2));
}
assert.ok(geometry.segments.length >= 100, 'vector geometry was captured');
assert.ok(parsed.boards.length >= minimumBoards, `at least ${minimumBoards} schematic board nodes were found`);
for (const expected of expectedBoards) {
  const norm = Core.canonicalBoardReference(expected)?.normalised;
  assert.ok(norm && parsed.boards.some((board) => Core.canonicalBoardReference(board.ref)?.normalised === norm),
    `expected schematic board exists: ${expected}`);
}
assert.ok(parsed.feeds.length >= minimumFeeds, `at least ${minimumFeeds} conductor-traced feeds were found`);
assert.ok((schedule.rows || []).length >= minimumScheduleRows,
  `at least ${minimumScheduleRows} schedule-matrix rows were found`);
assert.ok(parsed.feeds.every((feed) => feed.topologyMethod === 'pdf_vector_trace' && feed.path?.length >= 2), 'every feed carries vector path evidence');
assert.ok(!parsed.feeds.some((feed) => feed.pathEvidence?.crossingPolicy !== 'shared_endpoint_or_filled_junction_only'), 'crossing policy is explicit');
for (const expected of expectedEdges) {
  const [from, to] = expected.split('>').map((value) => Core.canonicalBoardReference(value)?.normalised).filter(Boolean);
  assert.ok(from && to, `expected edge has FROM>TO form: ${expected}`);
  assert.ok(parsed.feeds.some((feed) => Core.canonicalBoardReference(feed.fromRef)?.normalised === from
    && Core.canonicalBoardReference(feed.toRef)?.normalised === to), `expected traced edge exists: ${expected}`);
}
assert.ok(elapsedMs <= maximumMs, `schematic extraction completed within ${maximumMs}ms (actual ${elapsedMs}ms)`);

console.log(JSON.stringify({
  pages: document.numPages,
  testedPage: pageNumber,
  textLines: lines.length,
  vectorSegments: geometry.segments.length,
  junctionCandidates: geometry.junctions.length,
  graph: parsed.graphStats,
  boards: parsed.boards.length,
  feeds: parsed.feeds.length,
  scheduleMatrix: {
    matched: Boolean(schedule.matched),
    dialect: schedule.dialect || null,
    board: schedule.board?.ref || null,
    rows: schedule.rows?.length || 0,
    transposedProfile: transposedSchedule,
  },
  unresolvedBoards: parsed.diagnostics?.unresolvedBoards?.length || 0,
  ambiguousBoards: parsed.diagnostics?.ambiguousBoards?.length || 0,
  warnings: parsed.warnings,
  elapsedMs,
}, null, 2));
