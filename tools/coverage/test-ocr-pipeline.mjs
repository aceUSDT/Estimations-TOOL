import assert from "node:assert/strict";

await import("../../extractor-core.js");
const Core = globalThis.EstimationExtractorCore;

const digitalLines = [
  { text: "DISTRIBUTION BOARD SCHEDULE DB-01", bbox: [20, 20, 300, 14] },
  { text: "Way Phase Description Rating Device Curve kA", bbox: [20, 50, 500, 14] },
  { text: "1 L1 Lighting office 16A MCB C 10kA", bbox: [20, 80, 480, 14] },
  { text: "2 L2 Socket circuit 32A RCBO B 10kA", bbox: [20, 100, 490, 14] },
  { text: "3 L3 AHU supply 20A MCB C 6kA", bbox: [20, 120, 450, 14] },
];

// 1-3: digital, scanned, and mixed files route page by page.
assert.equal(Core.assessPageText(digitalLines, { expectedType: "db-schedule" }).route, "embedded_text");
assert.equal(Core.assessPageText([], { expectedType: "db-schedule" }).route, "ocr");
assert.deepEqual(
  [digitalLines, []].map((lines) => Core.assessPageText(lines, { expectedType: "db-schedule" }).route),
  ["embedded_text", "ocr"],
);

// Corrupt, incomplete, or incorrectly ordered text layers are not trusted.
assert.equal(Core.assessPageText([{ text: "���� ||| �" }], { expectedType: "db-schedule" }).route, "ocr");
assert.equal(Core.assessPageText([{ text: "Distribution board schedule" }], { expectedType: "db-schedule" }).route, "ocr");
assert.equal(Core.assessPageText([
  { text: "1 L1 16A MCB", bbox: [20, 100, 120, 12] },
  { text: "2 L2 20A MCB", bbox: [20, 60, 120, 12] },
  { text: "3 L3 32A RCBO", bbox: [20, 20, 120, 12] },
], { expectedType: "db-schedule" }).route, "ocr");

// 4-7: orientation, skew, low-resolution, faint/noisy candidates.
assert.ok(Core.buildOcrCandidatePlan({ orientation: 90 }).some((candidate) => candidate.rotation === 90));
assert.ok(Core.buildOcrCandidatePlan({ skewAngle: 2.4 }).some((candidate) => candidate.deskew === -2.4));
assert.ok(Core.buildOcrCandidatePlan({ width: 700, height: 500, estimatedTextHeight: 7 }).some((candidate) => candidate.scale >= 3));
const noisyPlan = Core.buildOcrCandidatePlan({ contrast: 0.12, noise: 0.35, unevenBackground: true });
assert.ok(noisyPlan.some((candidate) => candidate.threshold === "adaptive"));
assert.ok(noisyPlan.some((candidate) => candidate.denoise));

// Candidate comparison is measurable and deterministic.
const poor = { confidence: 42, text: "���� 1 | |", lines: [] };
const good = { confidence: 88, text: digitalLines.map((line) => line.text).join("\n"), lines: digitalLines };
assert.ok(Core.scoreOcrCandidate(good).score > Core.scoreOcrCandidate(poor).score);
assert.equal(Core.selectBestOcrCandidate([poor, good]).candidate, good);

// 11-13: electrical OCR corrections and tripping-curve extraction.
const corrected = Core.correctElectricalOcrText("Way l: l6A MC8 C curve 1OkA");
assert.equal(corrected.text, "Way 1: 16A MCB C curve 10kA");
assert.ok(corrected.corrections.length >= 3);
assert.ok(corrected.corrections.every((item) => item.original && item.corrected && item.reason));

for (const [source, expected] of [
  ["MCB B16", "B"],
  ["MCB C16", "C"],
  ["MCB D16", "D"],
  ["16A Type B MCB", "B"],
  ["16A Curve C RCBO", "C"],
  ["Type D 16A MCB", "D"],
  ["B-curve 16A MCB", "B"],
  ["Characteristic C 16A MCB", "C"],
]) {
  assert.equal(Core.extractTrippingCurve(source, { deviceContext: true })?.value, expected, source);
}
assert.equal(Core.extractTrippingCurve("DB-B16 revision C", { deviceContext: false }), null);
assert.equal(Core.extractTrippingCurve("16A MCB", { deviceContext: true }), null);
assert.equal(Core.extractBreakingCapacity("16A MCB 10 kA")?.value, 10);

// 8-10: spatial rows, repeated headers, continuation boards, and merged cells.
const words = [
  { text: "Way", bbox: { x0: 10, y0: 10, x1: 35, y1: 20 }, confidence: 95 },
  { text: "Description", bbox: { x0: 100, y0: 10, x1: 180, y1: 20 }, confidence: 94 },
  { text: "1", bbox: { x0: 10, y0: 35, x1: 16, y1: 45 }, confidence: 93 },
  { text: "Lighting office and corridor", bbox: { x0: 100, y0: 35, x1: 280, y1: 45 }, confidence: 90 },
];
const spatial = Core.reconstructSpatialRows(words);
assert.equal(spatial.length, 2);
assert.equal(spatial[1].cells.length, 2);
assert.deepEqual(spatial[1].bbox, [10, 35, 270, 10]);

const stitched = Core.stitchSchedulePages([
  { page: 1, boardRef: "DB-01", rows: [{ text: "Way Description" }, { text: "1 Lighting" }] },
  { page: 2, boardRef: null, rows: [{ text: "Way Description" }, { text: "2 Sockets" }] },
]);
assert.deepEqual(stitched.map((item) => item.text), ["1 Lighting", "2 Sockets"]);
assert.ok(stitched.every((item) => item.boardRef === "DB-01"));

// Source coordinates and word confidence survive line reconstruction.
const lines = Core.ocrWordsToLines(words, 300, 100, 600, 200);
assert.deepEqual(lines[1].bbox, [20, 70, 540, 20]);
assert.ok(lines[1].confidence > 0.8);
assert.equal(lines[1].words.length, 2);

// 22: rerunning OCR or seeing a continuation page cannot double-count a circuit.
const duplicateRows = [
  { id: "low", boardNorm: "DB01", way: 1, phase: "L1", device: "MCB", rating: 16, conf: 0.62, page: 1 },
  { id: "high", boardNorm: "DB01", way: 1, phase: "L1", device: "MCB", rating: 16, conf: 0.94, page: 2 },
  { id: "other", boardNorm: "DB01", way: 2, phase: "L2", device: "MCB", rating: 16, conf: 0.9, page: 2 },
];
const deduplicated = Core.deduplicateExtractionRows(duplicateRows);
assert.deepEqual(deduplicated.rows.map((item) => item.id), ["high", "other"]);
assert.equal(deduplicated.duplicates.length, 1);

const conflictingSpecifications = Core.deduplicateExtractionRows([
  { id: "sp", boardNorm: "DB01", way: 3, phase: "L3", device: "MCB", rating: 16, curve: "C", breakingCapacity: 10, poleConfiguration: "SP" },
  { id: "spn", boardNorm: "DB01", way: 3, phase: "L3", device: "MCB", rating: 16, curve: "C", breakingCapacity: 10, poleConfiguration: "SPN" },
  { id: "six-ka", boardNorm: "DB01", way: 4, phase: "L1", device: "MCB", rating: 20, curve: "B", breakingCapacityKa: 6, poleConfiguration: "SPN" },
  { id: "ten-ka", boardNorm: "DB01", way: 4, phase: "L1", device: "MCB", rating: 20, curve: "B", breakingCapacityKa: 10, poleConfiguration: "SPN" },
]);
assert.equal(conflictingSpecifications.rows.length, 4, "conflicting pole or capacity values must reach review instead of being deduplicated");
assert.equal(conflictingSpecifications.duplicates.length, 0);

console.log("OCR routing, preprocessing, electrical validation, layout, and deduplication: OK");
