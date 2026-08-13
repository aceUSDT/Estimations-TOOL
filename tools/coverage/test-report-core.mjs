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
    { id: "r1", boardNorm: "DB2", device: "MCB", rating: 10, poles: 1, desc: "Lighting", associatedDevices: [{ device: "Contactor", qty: 1 }], qty: 2, status: "confirmed", conf: 1, protectionStandard: "BS EN 60898", rcdProtected: true, sens: 30, afdd: false },
    { id: "r2", boardNorm: "DB10", device: "MCB", rating: 10, poles: 1, desc: "Lighting", qty: 1, status: "pending", conf: 0.9, protectionStandard: "60898", rcdProtected: true, sens: 30, afdd: false },
    { id: "r3", boardNorm: "DB10", device: "MCB", rating: 20, poles: 3, desc: "AHU supply", qty: 1, status: "pending", conf: 0.7 },
    { id: "r4", boardNorm: "DB2", device: "RCBO", rating: 32, poles: 1, desc: "Socket circuit", qty: 1, status: "confirmed", conf: 1 },
    { id: "r5", boardNorm: "DB2", device: "MCB", rating: 40, poles: 1, qty: 7, status: "rejected", conf: 0.2 },
    { id: "r6", boardNorm: "DB2", device: "MCB", rating: 16, poles: 1, qty: 3, kind: "mention", status: "pending", conf: 0.4 },
    { id: "r7", boardNorm: null, device: "MCB", rating: 16, poles: 1, qty: 1, status: "confirmed", conf: 1 },
    { id: "topology-only", boardNorm: "DB2", device: "MCCB", rating: 250, poles: 3, qty: 20, kind: "schematic", sourceRole: "schematic_feeder", status: "confirmed", conf: 1 },
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
assert.equal(model.groups[0].rows[1].label, "20A TP MCB");
assert.deepEqual(Array.from(model.groups[0].rows[1].purposes), ["Mechanical"]);
assert.equal(model.groups[0].rows[0].curve, "Not specified");
assert.equal(model.groups[0].rows[0].breakingCapacity, "Not specified");
assert.equal(model.groups[0].rows[0].rcdProtected, true);
assert.equal(model.groups[0].rows[0].rcdSensitivity, 30);
assert.equal(model.groups[0].rows[0].protectionStandard, "BS EN 60898");
assert.deepEqual(Array.from(model.boardSections, (board) => board.label), ["DB-2", "DB-10"]);
assert.equal(model.boardSections[0].total, 3);
assert.deepEqual(Array.from(model.boardSections[0].families, (family) => [family.name, family.total]), [["MCB", 2], ["RCBO", 1]]);
assert.equal(model.boardSections[0].families[0].rows[0].rcdLabel, "RCD 30mA");
assert.equal(model.reconciliation.valid, true);
assert.equal(model.associated.grandTotal, 1);
assert.equal(model.associated.groups[0].rows[0].label, "Contactor");

const workbook = Report.createExcelWorkbook(model, ExcelJS);
const sheet = workbook.getWorksheet("Device Take-Off");
const boardSheet = workbook.getWorksheet("Board Take-Off");
assert.equal(workbook.worksheets[0].name, "Board Take-Off");
assert.deepEqual(workbook.worksheets.map((worksheet) => worksheet.name), ["Board Take-Off", "Device Take-Off"]);
assert.match(boardSheet.getCell("A4").value, /DB-2/);
assert.equal(boardSheet.getCell("A5").value, "MCB | 2");
assert.equal(boardSheet.getCell("B6").value, 2);
assert.equal(boardSheet.getCell("H6").value, "RCD 30mA");
assert.equal(boardSheet.getCell("K6").value, "BS EN 60898");
assert.equal(sheet.getCell("A1").value, "Llangatwg Test");
assert.equal(sheet.getCell("A4").value, "Board Reference");
assert.match(sheet.getCell("B4").value, /MCB\n10A\nSPN/);
assert.equal(sheet.getCell("B5").value, 2);
assert.equal(sheet.getCell("B6").value, 1);
assert.equal(sheet.getCell("F5").value.formula, "SUM(B5:E5)");
assert.equal(sheet.getCell("B7").value.formula, "SUM(B5:B6)");
assert.equal(sheet.getCell("B4").fill.fgColor.argb, "FFFFF2CC");
assert.equal(sheet.getCell("A3").fill.fgColor.argb, "FF171717");
assert.equal(sheet.getCell("A3").font.color.argb, "FFFFFFFF");
assert.equal(sheet.views[0].ySplit, 4);
for (const worksheet of workbook.worksheets) {
  worksheet.eachRow((row) => row.eachCell((cell) => {
    assert.doesNotMatch(String(cell.value?.result ?? cell.value ?? ''), /Not specified|Unclear|Not applicable/i);
  }));
}

const buffer = await workbook.xlsx.writeBuffer();
if (process.env.REPORT_XLSX_PATH) await fs.writeFile(process.env.REPORT_XLSX_PATH, Buffer.from(buffer));
assert.equal(buffer[0], 0x50);
assert.equal(buffer[1], 0x4b);
const roundTrip = new ExcelJS.Workbook();
await roundTrip.xlsx.load(buffer);
assert.equal(roundTrip.getWorksheet("Device Take-Off").getCell("F5").value.formula, "SUM(B5:E5)");
assert.equal(roundTrip.getWorksheet("Board Take-Off").getCell("H6").value, "RCD 30mA");

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
assert.equal(wideRoundTrip.getWorksheet("Device Take-Off").getCell("B5").value, 1);
assert.equal(wideRoundTrip.getWorksheet("Device Take-Off").getCell("B6").value, null);

const excludedModel = Report.buildModel({
  boards: {
    MSDB1: { norm: "MSDB1", orig: "MSDB-1", type: "SB", inScope: false, outOfScopeReasons: ["MSDB_ASSEMBLY"] },
    DB1: { norm: "DB1", orig: "DB-1", type: "DB", inScope: true },
  },
  rows: [
    { boardNorm: "MSDB1", device: "Fuse", rating: 100, poles: 3, qty: 4, status: "confirmed", outOfScope: true },
    { boardNorm: "DB1", device: "MCB", rating: 16, poles: 1, qty: 2, status: "confirmed" },
  ],
});
assert.deepEqual(Array.from(excludedModel.boards, (board) => board.label), ["DB-1"]);
assert.equal(excludedModel.grandTotal, 2);

const occupancyModel = Report.buildModel({
  boards: { DB1: { norm: "DB1", orig: "DB-1", type: "DB", inScope: true } },
  rows: [
    { id: "fitted-spare", boardNorm: "DB1", device: "MCB", rating: 6, poles: 1, desc: "Spare", spare: true, space: false, qty: 1, status: "confirmed", conf: 1 },
    { id: "space-description", boardNorm: "DB1", device: "MCB", rating: 10, curve: "C", poles: 1, desc: "Open Space next to dining", spare: false, space: false, qty: 1, status: "confirmed", conf: 1 },
    { id: "empty-space", boardNorm: "DB1", device: null, rating: null, desc: "Space", spare: false, space: true, qty: 0, status: "confirmed", conf: 1 },
    { id: "pending-ai", boardNorm: "DB1", device: "MCB", rating: 20, poles: 1, kind: "ai", qty: 1, status: "pending", conf: 0.7 },
  ],
});
assert.equal(occupancyModel.grandTotal, 2);
assert.equal(occupancyModel.boardSections[0].total, 2);
assert.deepEqual(Array.from(occupancyModel.groups[0].rows, (row) => row.rating), [6, 10]);

console.log("Report matrix and XLSX export: OK");
