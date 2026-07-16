import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import ExcelJS from "exceljs";

const source = await fs.readFile(new URL("../../report-core.js", import.meta.url), "utf8");
const context = vm.createContext({ console });
vm.runInContext(source, context, { filename: "report-core.js" });
const Report = context.EstimationReport;

const model = Report.buildModel({
  projectName: "Llangatwg Test",
  generatedAt: "2026-07-13T09:00:00Z",
  boards: {
    DB10: { norm: "DB10", orig: "DB-10", type: "DB" },
    DB2: { norm: "DB2", orig: "DB-2", type: "DB" },
  },
  rows: [
    { id: "r1", boardNorm: "DB2", device: "MCB", rating: 10, poles: 1, desc: "Lighting", associatedDevices: [{ device: "Contactor", qty: 1 }], qty: 2, status: "confirmed", conf: 1 },
    { id: "r2", boardNorm: "DB10", device: "MCB", rating: 10, poles: 1, desc: "Lighting", qty: 1, status: "pending", conf: 0.9 },
    { id: "r3", boardNorm: "DB10", device: "MCB", rating: 20, poles: 3, desc: "AHU supply", qty: 1, status: "pending", conf: 0.7 },
    { id: "r4", boardNorm: "DB2", device: "RCBO", rating: 32, poles: 1, desc: "Socket circuit", qty: 1, status: "confirmed", conf: 1 },
    { id: "r5", boardNorm: "DB2", device: "MCB", rating: 40, poles: 1, qty: 7, status: "rejected", conf: 0.2 },
    { id: "r6", boardNorm: "DB2", device: "MCB", rating: 16, poles: 1, qty: 3, kind: "mention", status: "pending", conf: 0.4 },
    { id: "r7", boardNorm: null, device: "MCB", rating: 16, poles: 1, qty: 1, status: "confirmed", conf: 1 },
  ],
});

assert.deepEqual(Array.from(model.boards, (board) => board.label), ["DB-2", "DB-10"]);
assert.equal(model.reviewCount, 3);
assert.equal(model.unassignedQty, 1);
assert.equal(model.grandTotal, 5);
assert.equal(model.deviceLineCount, 3);
assert.deepEqual(Array.from(model.boardTotals), [3, 2]);
assert.deepEqual(Array.from(model.groups, (group) => group.name), ["MCBs", "RCBOs"]);
assert.equal(model.groups[0].rows[0].label, "10A SPN MCB");
assert.deepEqual(Array.from(model.groups[0].rows[0].quantities), [2, 1]);
assert.deepEqual(Array.from(model.groups[0].rows[0].purposes), ["Lighting"]);
assert.equal(model.groups[0].rows[1].label, "20A TPN MCB");
assert.deepEqual(Array.from(model.groups[0].rows[1].purposes), ["Mechanical"]);
assert.equal(model.groups[0].rows[0].curve, "Not specified");
assert.equal(model.groups[0].rows[0].breakingCapacity, "Not specified");
assert.equal(model.reconciliation.valid, true);
assert.equal(model.associated.grandTotal, 1);
assert.equal(model.associated.groups[0].rows[0].label, "Contactor");

const workbook = Report.createExcelWorkbook(model, ExcelJS);
const sheet = workbook.getWorksheet("Device Take-Off");
const controlSheet = workbook.getWorksheet("Control Equipment");
assert.equal(sheet.getCell("A1").value, "Llangatwg Test");
assert.equal(sheet.getCell("G3").value, "DB-2");
assert.equal(sheet.getCell("H3").value, "DB-10");
assert.equal(sheet.getCell("I3").value, "Total Quantity");
assert.equal(sheet.getCell("I4").value.formula, "SUM(G4:H4)");
assert.equal(sheet.getCell("G7").value.formula, "SUM(G4:G6)");
assert.equal(sheet.getCell("E4").fill.fgColor.argb, "FFFFF2CC");
assert.equal(sheet.getCell("A3").fill.fgColor.argb, "FFF7E0D1");
assert.equal(sheet.views[0].ySplit, 3);
assert.equal(workbook.getWorksheet("Device Detail").rowCount, 6);
assert.ok(workbook.getWorksheet("Review Required"));
assert.ok(workbook.getWorksheet("Assumptions and Qualifications"));
assert.ok(workbook.getWorksheet("Extraction Audit"));
assert.equal(controlSheet.getCell("A2").value, "Control & Associated Equipment");
assert.equal(controlSheet.getCell("C5").value, 1);

const buffer = await workbook.xlsx.writeBuffer();
assert.equal(buffer[0], 0x50);
assert.equal(buffer[1], 0x4b);
const roundTrip = new ExcelJS.Workbook();
await roundTrip.xlsx.load(buffer);
assert.equal(roundTrip.getWorksheet("Device Take-Off").getCell("I4").value.formula, "SUM(G4:H4)");
assert.equal(roundTrip.getWorksheet("Control Equipment").getCell("C5").value, 1);

const wideBoards = Object.fromEntries(Array.from({ length: 57 }, (_, index) => {
  const number = index + 1;
  return [`DB${number}`, { norm: `DB${number}`, orig: `DB-${number}`, type: "DB" }];
}));
const wideModel = Report.buildModel({
  projectName: "Wide report",
  includeEmptyBoards: true,
  boards: wideBoards,
  rows: [{ boardNorm: "DB1", device: "MCB", rating: 10, poles: 1, qty: 1, status: "confirmed" }],
});
const wideWorkbook = Report.createExcelWorkbook(wideModel, ExcelJS);
const wideBuffer = await wideWorkbook.xlsx.writeBuffer();
const wideRoundTrip = new ExcelJS.Workbook();
await wideRoundTrip.xlsx.load(wideBuffer);
assert.equal(wideRoundTrip.getWorksheet("Device Take-Off").getCell("G4").value, 1);
assert.equal(wideRoundTrip.getWorksheet("Device Take-Off").getCell("H4").value, null);

console.log("Report matrix and XLSX export: OK");
