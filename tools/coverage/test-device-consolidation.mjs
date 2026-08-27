import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import ExcelJS from "exceljs";

const source = await fs.readFile(new URL("../../report-core.js", import.meta.url), "utf8");
const context = vm.createContext({ console });
vm.runInContext(source, context, { filename: "report-core.js" });
const Report = context.EstimationReport;

const boards = {
  DB02: { norm: "DB02", orig: "DB-02", type: "DB" },
  DB03: { norm: "DB03", orig: "DB-03", type: "DB" },
  DB05: { norm: "DB05", orig: "DB-05", type: "DB" },
  DB06: { norm: "DB06", orig: "DB-06", type: "DB" },
};

const row = (id, boardNorm, qty, overrides = {}) => ({
  id,
  boardNorm,
  fileId: "riverside-pdf",
  fileName: "Riverside schedules.pdf",
  page: Number(id.replace(/\D/g, "")) || 1,
  line: 10,
  bbox: [100, 200, 300, 18],
  device: "MCB",
  rating: 16,
  poles: 1,
  curve: null,
  ka: null,
  desc: "General circuit",
  qty,
  status: "confirmed",
  conf: 0.96,
  kind: "schedule",
  extractionMethod: "native_text",
  srcText: "16A SPN MCB General circuit",
  ...overrides,
});

// Regression fixture reproduced from the supplied Riverside workbook:
// 15 general + 1 lighting + 5 mechanical = one procurement line of 21.
const riversideRows = [
  row("r1", "DB02", 5),
  row("r2", "DB03", 2),
  row("r3", "DB05", 4),
  row("r4", "DB06", 4),
  row("r5", "DB05", 1, { desc: "Lighting", discipline: "Lighting" }),
  row("r6", "DB03", 1, { desc: "Mechanical controls", discipline: "Mechanical" }),
  row("r7", "DB06", 4, { desc: "Mechanical controls", discipline: "Mechanical" }),
];

const riverside = Report.buildModel({
  projectName: "Riverside Office Fit-Out",
  generatedAt: "2026-07-15T09:00:00Z",
  boards,
  rows: riversideRows,
});

assert.equal(riverside.deviceLineCount, 1, "purpose text must not split procurement lines");
const consolidated = riverside.groups[0].rows[0];
assert.equal(consolidated.label, "16A SPN MCB");
assert.equal(consolidated.deviceFamily, "MCB");
assert.equal(consolidated.rating, 16);
assert.equal(consolidated.pole, "SPN");
assert.equal(consolidated.curve, "Not specified");
assert.equal(consolidated.breakingCapacity, "Not specified");
assert.deepEqual(Array.from(consolidated.quantities), [5, 3, 5, 8]);
assert.equal(consolidated.total, 21);
assert.deepEqual(Array.from(consolidated.purposes), ["General / unspecified", "Lighting", "Mechanical"]);
assert.equal(consolidated.contributors.length, 7);
assert.match(consolidated.notes.join(" "), /Tripping curve not specified/);
assert.match(consolidated.notes.join(" "), /Breaking capacity not specified/);
assert.equal(consolidated.reviewStatus, "Review required");
assert.equal(riverside.grandTotal, 21);

function groupedRows(rows) {
  return Report.buildModel({ boards: { DB02: boards.DB02 }, rows }).groups.flatMap((group) => group.rows);
}

const curves = groupedRows([
  row("c1", "DB02", 1, { curve: "B" }),
  row("c2", "DB02", 1, { curve: "Type C" }),
  row("c3", "DB02", 1, { curve: null }),
]);
assert.equal(curves.length, 3, "known and unspecified curves must remain separate");
assert.deepEqual(Array.from(curves, (item) => item.curve).sort(), ["B", "C", "Not specified"]);
assert.ok(curves.filter((item) => item.curve !== "Not specified").every((item) =>
  item.reviewReasons.includes("Conflicting tripping curves appear for otherwise identical devices"),
), "conflicting known curves must be visibly flagged without merging");

const curveVariants = groupedRows([
  row("cv1", "DB02", 1, { curve: "B16" }),
  row("cv2", "DB02", 1, { curve: "Type B" }),
  row("cv3", "DB02", 1, { curve: "B-curve" }),
]);
assert.equal(curveVariants.length, 1, "equivalent curve notation must share one canonical group");
assert.equal(curveVariants[0].curve, "B");
assert.equal(curveVariants[0].total, 3);

const sameCircuitConflict = groupedRows([
  row("sc1", "DB02", 1, { way: 9, curve: "B", ka: 10 }),
  row("sc2", "DB02", 1, { way: 9, curve: "C", ka: 10 }),
]);
assert.equal(sameCircuitConflict.length, 2, "conflicting specifications on the same circuit must reach review");
assert.ok(sameCircuitConflict.every((item) => item.reviewReasons.some((reason) => /Conflicting tripping curves/.test(reason))));

const rerunDuplicate = Report.buildModel({
  boards: { DB02: boards.DB02 },
  rows: [
    row("dup-low", "DB02", 1, { way: 10, curve: "C", ka: 10, conf: 0.6, status: "pending" }),
    row("dup-high", "DB02", 1, { way: 10, curve: "C", ka: 10, conf: 0.97 }),
  ],
});
assert.equal(rerunDuplicate.grandTotal, 1, "an exact OCR rerun must not double-count a circuit");
assert.equal(rerunDuplicate.duplicates.length, 1);

const capacities = groupedRows([
  row("k1", "DB02", 1, { ka: 6 }),
  row("k2", "DB02", 1, { ka: "10 kA" }),
  row("k3", "DB02", 1, { ka: null }),
]);
assert.equal(capacities.length, 3, "different and unspecified breaking capacities must remain separate");
assert.deepEqual(Array.from(capacities, (item) => item.breakingCapacity).sort(), ["10kA", "6kA", "Not specified"]);
assert.ok(capacities.filter((item) => item.breakingCapacity !== "Not specified").every((item) =>
  item.reviewReasons.includes("Conflicting breaking capacities appear for otherwise identical devices"),
), "conflicting known capacities must be visibly flagged without merging");

const poles = groupedRows([
  row("p1", "DB02", 1, { poles: 1 }),
  row("p2", "DB02", 1, { poles: 2 }),
  row("p3", "DB02", 1, { poles: null }),
]);
assert.equal(poles.length, 3, "known and unclear pole configurations must remain separate");
assert.deepEqual(Array.from(poles, (item) => item.pole).sort(), ["DPN", "SPN", "Unclear"]);
assert.ok(poles.filter((item) => item.pole !== "Unclear").every((item) =>
  item.reviewReasons.includes("Conflicting pole configurations appear for otherwise identical devices"),
), "conflicting known pole configurations must be visibly flagged without merging");

const families = groupedRows([
  row("f1", "DB02", 1, { device: "MCB" }),
  row("f2", "DB02", 1, { device: "RCBO" }),
]);
assert.equal(families.length, 2, "device family is procurement-relevant");

const rcdProtection = groupedRows([
  row("rcd1", "DB02", 1, { rcdProtected: true, sens: 30, afdd: false }),
  row("rcd2", "DB02", 1, { rcdProtected: false, sens: null, afdd: false }),
]);
assert.equal(rcdProtection.length, 2, "RCD-protected and unprotected MCBs must remain separate procurement specifications");
assert.deepEqual(Array.from(rcdProtection, (item) => item.rcdProtected).sort(), [false, true]);

const hiddenMetadataVariants = groupedRows([
  row("meta1", "DB02", 1, { way: 1, curve: "C", ka: 10, rcdProtected: false, afdd: false, protectionStandard: "BS EN 60898", tripUnit: "Thermal magnetic" }),
  row("meta2", "DB02", 2, { way: 2, curve: "C", ka: 10, rcdProtected: false, afdd: false, protectionStandard: "60898-1", tripUnit: null }),
]);
assert.equal(hiddenMetadataVariants.length, 1, "supporting standard and trip-unit text must not duplicate an otherwise identical device column");
assert.equal(hiddenMetadataVariants[0].total, 3);
assert.equal(hiddenMetadataVariants[0].contributors.length, 2, "every source must remain available beneath the consolidated device");

const mccbTripUnits = groupedRows([
  row("tu1", "DB02", 1, { device: "MCCB", rating: 160, poles: 3, curve: null, ka: 25, tripUnit: "LSI", productRange: "h3+ P160" }),
  row("tu2", "DB02", 1, { device: "MCCB", rating: 160, poles: 3, curve: null, ka: 25, tripUnit: "LSIG", productRange: "H3+ / P160" }),
  row("tu3", "DB02", 1, { device: "MCCB", rating: 160, poles: 3, curve: null, ka: 25, tripUnit: "TM-D", productRange: "h3+ P160" }),
  row("tu4", "DB02", 2, { device: "MCCB", rating: 160, poles: 3, curve: null, ka: 25, tripUnit: "Thermal magnetic", productRange: "H3+ / P160" }),
]);
assert.equal(mccbTripUnits.length, 3, "LSI, LSIG, and TM MCCBs must remain separate procurement groups");
assert.deepEqual(Array.from(mccbTripUnits, (item) => item.tripUnit).sort(), ["LSI", "LSIG", "TM"]);
assert.equal(mccbTripUnits.find((item) => item.tripUnit === "TM").total, 3, "TM-D and thermal-magnetic notation must canonicalise to TM");
assert.ok(mccbTripUnits.every((item) => item.productRange === "H3+ / P160"));
assert.ok(mccbTripUnits.every((item) => /TP/.test(item.label) && /25kA/.test(item.label) && /trip/.test(item.label)),
  "the consolidated label must display poles, capacity, and trip unit");

const rangeVariants = groupedRows([
  row("range1", "DB02", 1, { device: "MCCB", rating: 160, poles: 3, curve: null, ka: 25, tripUnit: "LSI", productRange: "H3+ P160" }),
  row("range2", "DB02", 1, { device: "MCCB", rating: 160, poles: 3, curve: null, ka: 25, tripUnit: "LSI", productRange: "X160" }),
]);
assert.equal(rangeVariants.length, 2, "different MCCB product ranges must remain separate procurement groups");
assert.deepEqual(Array.from(rangeVariants, (item) => item.productRange).sort(), ["H3+ / P160", "X160"]);

assert.deepEqual(Array.from(Report.TRIP_UNIT_OPTIONS), ["LSI", "LSIG", "LSNI", "TM", "ATFM", "ATAM", "LI"]);
assert.equal(Report.normaliseTripUnit("TMD"), "TM");
assert.equal(Report.normaliseTripUnit("Micrologic 5.0"), "Not specified", "unsupported trip-unit text must not create a new category");

const reconciliation = Report.validateModel(riverside);
assert.equal(reconciliation.valid, true);
assert.equal(reconciliation.sourceTotal, 21);
assert.equal(reconciliation.boardTotal, 21);
assert.equal(reconciliation.groupTotal, 21);

const workbook = Report.createExcelWorkbook(riverside, ExcelJS);
assert.deepEqual(workbook.worksheets.map((worksheet) => worksheet.name), ["Board Take-Off", "Device Take-Off"]);

const takeoff = workbook.getWorksheet("Device Take-Off");
assert.equal(takeoff.getCell("A1").value, "Riverside Office Fit-Out");
assert.match(takeoff.getCell("B4").value, /MCB\n16A\nSPN/);
assert.doesNotMatch(takeoff.getCell("B4").value, /Not specified|Unclear/i);
assert.deepEqual([5, 6, 7, 8].map((rowNumber) => takeoff.getCell(rowNumber, 2).value), [5, 3, 5, 8]);
assert.equal(takeoff.getCell("B9").value.result, 21);
assert.equal(takeoff.getCell("C5").value.result, 5);

const corrected = Report.buildModel({
  boards: { DB02: boards.DB02 },
  rows: [row("ocr1", "DB02", 1, {
    curve: "C",
    ka: 10,
    originalOcrText: "16A SPN MCB curve O 10kA",
    extractionMethod: "ocr:enhanced-deskew",
    corrections: [{
      field: "Tripping Curve",
      original: "O",
      corrected: "C",
      reason: "Electrical OCR context correction",
    }, {
      field: "RCD Protection",
      original: "Not specified",
      corrected: "Yes",
      reason: "User correction in Viewer",
    }],
    rcdProtected: true,
    sens: 30,
    afdd: false,
  })],
});
assert.ok(!corrected.groups[0].rows[0].reviewReasons.includes("An automatic OCR correction needs confirmation"),
  "an approved correction remains in the audit trail without permanently blocking release");
const correctionWorkbook = Report.createExcelWorkbook(corrected, ExcelJS);
assert.deepEqual(correctionWorkbook.worksheets.map((worksheet) => worksheet.name), ["Board Take-Off", "Device Take-Off"]);
const correctionEvidence = corrected.groups[0].rows[0].contributors[0];
assert.ok(correctionEvidence.corrections.some((item) => item.field === "Tripping Curve" && item.corrected === "C"));
assert.ok(correctionEvidence.corrections.some((item) => item.field === "RCD Protection" && item.corrected === "Yes"));

const tampered = Report.buildModel({ boards, rows: riversideRows });
tampered.groups[0].rows[0].total = 20;
assert.equal(Report.validateModel(tampered).valid, false);
assert.throws(
  () => Report.createExcelWorkbook(tampered, ExcelJS),
  /reconciliation/i,
  "an inconsistent workbook must not be exported silently",
);

console.log("Device consolidation, traceability, and workbook reconciliation: OK");
