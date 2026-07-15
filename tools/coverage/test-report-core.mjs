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
assert.equal(model.reviewCount, 2);
assert.equal(model.unassignedQty, 1);
assert.equal(model.grandTotal, 5);
assert.equal(model.deviceLineCount, 3);
assert.deepEqual(Array.from(model.boardTotals), [3, 2]);
assert.deepEqual(Array.from(model.groups, (group) => group.name), ["MCB's", "RCBO's"]);
assert.equal(model.groups[0].rows[0].label, "10A SPN MCB - Lighting");
assert.deepEqual(Array.from(model.groups[0].rows[0].quantities), [2, 1]);
assert.equal(model.groups[0].rows[1].label, "20A TPN MCB - Mech");
assert.equal(model.associated.grandTotal, 1);
assert.equal(model.associated.groups[0].rows[0].label, "Contactor");

const workbook = Report.createExcelWorkbook(model, ExcelJS);
const sheet = workbook.getWorksheet("DB Devices");
const controlSheet = workbook.getWorksheet("Control Equipment");
assert.equal(sheet.getCell("A1").value, "Llangatwg Test");
assert.equal(sheet.getCell("C1").value, "DB-2");
assert.equal(sheet.getCell("D1").value, "DB-10");
assert.equal(sheet.getCell("E3").value, "Total");
assert.equal(sheet.getCell("E5").value.formula, "SUM(C5:D5)");
assert.equal(sheet.getCell("C9").value.formula, "SUM(C4:C8)");
assert.equal(sheet.getCell("A4").fill.fgColor.argb, "FFD9D9D9");
assert.equal(sheet.getCell("A3").fill.fgColor.argb, "FFF7E0D1");
assert.equal(sheet.views[0].ySplit, 3);
assert.equal(sheet.pageSetup.fitToHeight, 1);
assert.equal(controlSheet.getCell("A2").value, "Control & Associated Equipment");
assert.equal(controlSheet.getCell("C5").value, 1);

const buffer = await workbook.xlsx.writeBuffer();
assert.equal(buffer[0], 0x50);
assert.equal(buffer[1], 0x4b);
const roundTrip = new ExcelJS.Workbook();
await roundTrip.xlsx.load(buffer);
assert.equal(roundTrip.getWorksheet("DB Devices").getCell("E5").value.formula, "SUM(C5:D5)");
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
assert.equal(wideRoundTrip.getWorksheet("DB Devices").getCell("C5").value, 1);
assert.equal(wideRoundTrip.getWorksheet("DB Devices").getCell("D5").value, null);

console.log("Report matrix and XLSX export: OK");
