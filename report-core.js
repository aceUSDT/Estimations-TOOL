(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.EstimationReport = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const GROUP_ORDER = [
    "MCB's",
    "RCBO's",
    "MCCB's",
    "ACB's",
    "RCD's",
    "Switches & Isolators",
    "Fuses",
    "Surge Protection",
    "Contactors & Control",
    "Metering",
    "Other Devices",
  ];

  const DEVICE_NAMES = {
    MCB: "MCB",
    RCBO: "RCBO",
    MCCB: "MCCB",
    ACB: "ACB",
    RCD: "RCD",
    RCCB: "RCD",
    SPD: "SPD",
    FUSE: "Fuse",
    ISOLATOR: "Isolator",
    SWITCH: "Switch",
    CONTACTOR: "Contactor",
    METER: "Meter",
  };

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  function canonicalDevice(row) {
    const raw = text(row && row.device).replace(/s$/i, "").toUpperCase();
    return DEVICE_NAMES[raw] || text(row && row.device) || "Other device";
  }

  function groupForDevice(device) {
    const key = text(device).toUpperCase();
    if (key === "MCB") return "MCB's";
    if (key === "RCBO") return "RCBO's";
    if (key === "MCCB") return "MCCB's";
    if (key === "ACB") return "ACB's";
    if (key === "RCD") return "RCD's";
    if (key === "ISOLATOR" || key === "SWITCH") return "Switches & Isolators";
    if (key === "FUSE") return "Fuses";
    if (key === "SPD") return "Surge Protection";
    if (key === "CONTACTOR") return "Contactors & Control";
    if (key === "METER") return "Metering";
    return "Other Devices";
  }

  function poleLabel(row) {
    const poles = Number(row && row.poles);
    const phase = text(row && row.phase).toUpperCase();
    if (phase === "3PH" || phase === "L1L2L3" || poles >= 3) return "TPN";
    if (poles === 2) return "DPN";
    if (poles === 1) return "SPN";
    return "";
  }

  function disciplineLabel(row) {
    const explicit = text((row && (row.discipline || row.service)) || "").toLowerCase();
    const description = text((row && (row.desc || row.description)) || "").toLowerCase();
    const haystack = `${explicit} ${description}`;
    if (/\b(light|lighting|luminaire|luminaires|emergency lighting)\b/.test(haystack)) return "Lighting";
    if (/\b(mech|mechanical|ahu|fcu|fan|pump|bms|boiler|chiller|ventilation|extract|motor|lift|heat pump)\b/.test(haystack)) return "Mech";
    return "";
  }

  function formatRating(value) {
    const rating = Number(value);
    if (!Number.isFinite(rating) || rating <= 0) return "";
    return Number.isInteger(rating) ? String(rating) : String(Number(rating.toFixed(2)));
  }

  function deviceLabel(row) {
    const device = canonicalDevice(row);
    const rating = formatRating(row && row.rating);
    const poles = /^(MCB|RCBO|MCCB|ACB|RCD)$/i.test(device) ? poleLabel(row) : "";
    const discipline = disciplineLabel(row);
    const incomer = row && row.incomer ? "Incomer" : "";
    const main = [rating ? `${rating}A` : "", poles, device].filter(Boolean).join(" ");
    const suffix = [discipline, incomer].filter(Boolean).join(" / ");
    return suffix ? `${main} - ${suffix}` : main;
  }

  function includeRow(row) {
    if (!row || row.status === "rejected" || row.space || !row.device) return false;
    if (row.spare && !row.device) return false;
    if (row.kind === "mention" && row.status !== "confirmed") return false;
    return Number(row.qty || 1) > 0;
  }

  function groupIndex(name) {
    const index = GROUP_ORDER.indexOf(name);
    return index < 0 ? GROUP_ORDER.length : index;
  }

  function boardEntries(boards) {
    return Object.entries(boards || {}).map(([norm, board]) => ({
      norm,
      label: text(board && (board.orig || board.ref)) || norm,
      type: text(board && board.type),
    }));
  }

  function buildModel(options) {
    const rows = Array.isArray(options && options.rows) ? options.rows : [];
    const knownBoards = boardEntries(options && options.boards);
    const boardMap = new Map(knownBoards.map((board) => [board.norm, board]));
    const included = rows.filter(includeRow);

    included.forEach((row) => {
      const norm = text(row.boardNorm);
      if (norm && !boardMap.has(norm)) boardMap.set(norm, { norm, label: norm, type: "" });
    });

    const boards = Array.from(boardMap.values()).sort((a, b) => naturalCompare(a.label, b.label));
    const boardOrder = new Map(boards.map((board, index) => [board.norm, index]));
    const grouped = new Map();
    let unassignedQty = 0;

    included.forEach((source) => {
      const qty = Math.max(1, Number(source.qty) || 1);
      const boardIndex = boardOrder.get(text(source.boardNorm));
      if (boardIndex == null) {
        unassignedQty += qty;
        return;
      }
      const label = deviceLabel(source);
      const group = groupForDevice(canonicalDevice(source));
      const key = `${group}\u0000${label}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          group,
          label,
          rating: Number(source.rating) || 0,
          pole: poleLabel(source),
          quantities: Array(boards.length).fill(0),
          rowIdsByBoard: Array.from({ length: boards.length }, () => []),
          total: 0,
        });
      }
      const reportRow = grouped.get(key);
      reportRow.quantities[boardIndex] += qty;
      reportRow.total += qty;
      if (source.id) reportRow.rowIdsByBoard[boardIndex].push(source.id);
    });

    const groupMap = new Map();
    grouped.forEach((row) => {
      if (!groupMap.has(row.group)) groupMap.set(row.group, []);
      groupMap.get(row.group).push(row);
    });

    const poleRank = { SPN: 1, DPN: 2, TPN: 3, "": 4 };
    const groups = Array.from(groupMap.entries())
      .sort((a, b) => groupIndex(a[0]) - groupIndex(b[0]) || naturalCompare(a[0], b[0]))
      .map(([name, deviceRows]) => ({
        name,
        rows: deviceRows.sort((a, b) =>
          a.rating - b.rating ||
          (poleRank[a.pole] || 9) - (poleRank[b.pole] || 9) ||
          naturalCompare(a.label, b.label),
        ),
      }));

    const boardTotals = boards.map((_, index) =>
      groups.reduce((sum, group) => sum + group.rows.reduce((subtotal, row) => subtotal + row.quantities[index], 0), 0),
    );
    const reviewCount = rows.filter((row) => row && row.status === "pending" && Number(row.conf || 0) < 0.8).length;
    const coverage = options && options.coverage;
    const coverageIssueCount = coverage
      ? (coverage.perBoard || []).filter((board) => Number(board.unaccountedWays || 0) > 0).length
        + (coverage.zeroRowSchedulePages || []).length
      : 0;
    const grandTotal = boardTotals.reduce((sum, value) => sum + value, 0);
    const deviceLineCount = groups.reduce((sum, group) => sum + group.rows.length, 0);

    return {
      projectName: text(options && options.projectName) || "Electrical project",
      generatedAt: options && options.generatedAt ? new Date(options.generatedAt) : new Date(),
      boards,
      groups,
      boardTotals,
      grandTotal,
      deviceLineCount,
      reviewCount,
      coverageIssueCount,
      unassignedQty,
      includedRows: included.length,
    };
  }

  function columnName(index) {
    let value = Number(index);
    let result = "";
    while (value > 0) {
      value -= 1;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result;
  }

  function matrixRows(model) {
    const rows = [];
    rows.push([model.projectName, "DB Reference", ...model.boards.map((board) => board.label), "", ""]);
    rows.push(["Distribution Board Devices", "", ...model.boards.map(() => ""), "", ""]);
    rows.push(["Discipline", "Unit", ...model.boards.map(() => "Qty"), "Total", "WS"]);
    model.groups.forEach((group) => {
      rows.push([group.name, "", ...model.boards.map(() => ""), "", ""]);
      group.rows.forEach((row) => rows.push([row.label, "Nr", ...row.quantities.map((qty) => qty || ""), row.total, ""]));
    });
    rows.push(["DB Device Total", "", ...model.boardTotals, model.grandTotal, ""]);
    return rows;
  }

  function createExcelWorkbook(model, ExcelJS) {
    if (!ExcelJS || typeof ExcelJS.Workbook !== "function") throw new Error("Excel export library is unavailable");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Estimation Tools";
    workbook.company = "Hager";
    workbook.created = model.generatedAt;
    workbook.modified = model.generatedAt;
    workbook.calcProperties.fullCalcOnLoad = true;

    const sheet = workbook.addWorksheet("DB Devices", {
      views: [{ state: "frozen", ySplit: 3, activeCell: "A4" }],
      pageSetup: {
        paperSize: model.boards.length > 16 ? 8 : 9,
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        margins: { left: 0.2, right: 0.2, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
      },
      properties: { defaultRowHeight: 20 },
    });

    const boardStart = 3;
    const totalColumn = boardStart + model.boards.length;
    const wsColumn = totalColumn + 1;
    const lastColumn = columnName(wsColumn);
    const lastBoardColumn = model.boards.length ? columnName(totalColumn - 1) : "B";
    const rows = matrixRows(model);
    rows.forEach((values, rowIndex) => {
      values.forEach((value, columnIndex) => {
        sheet.getCell(rowIndex + 1, columnIndex + 1).value = value;
      });
    });

    let cursor = 4;
    model.groups.forEach((group) => {
      cursor += 1;
      group.rows.forEach((reportRow) => {
        if (model.boards.length) {
          sheet.getCell(cursor, totalColumn).value = {
            formula: `SUM(C${cursor}:${lastBoardColumn}${cursor})`,
            result: reportRow.total,
          };
        } else {
          sheet.getCell(cursor, totalColumn).value = 0;
        }
        cursor += 1;
      });
    });
    const totalRow = cursor;
    model.boardTotals.forEach((value, index) => {
      const col = boardStart + index;
      const letter = columnName(col);
      sheet.getCell(totalRow, col).value = {
        formula: `SUM(${letter}4:${letter}${totalRow - 1})`,
        result: value,
      };
    });
    if (model.boards.length) {
      const totalLetter = columnName(totalColumn);
      sheet.getCell(totalRow, totalColumn).value = {
        formula: `SUM(${totalLetter}4:${totalLetter}${totalRow - 1})`,
        result: model.grandTotal,
      };
    }

    sheet.getColumn(1).width = 40;
    for (let col = 2; col <= wsColumn; col += 1) sheet.getColumn(col).width = 10;
    sheet.getRow(1).height = 60;
    sheet.getRow(2).height = 60;
    for (let row = 3; row <= totalRow; row += 1) sheet.getRow(row).height = 20;

    for (let row = 1; row <= totalRow; row += 1) {
      for (let col = 1; col <= wsColumn; col += 1) {
        const cell = sheet.getCell(row, col);
        cell.font = { name: "Montserrat", size: 9, color: { argb: "FF000000" } };
        cell.alignment = { vertical: "middle", horizontal: col === 1 ? "left" : "center" };
        cell.border = {
          top: { style: "thin", color: { argb: "FF7F7F7F" } },
          left: { style: "thin", color: { argb: "FF7F7F7F" } },
          bottom: { style: "thin", color: { argb: "FF7F7F7F" } },
          right: { style: "thin", color: { argb: "FF7F7F7F" } },
        };
      }
    }

    for (let row = 1; row <= 2; row += 1) {
      for (let col = 1; col <= wsColumn; col += 1) {
        const cell = sheet.getCell(row, col);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
        cell.font = { name: "Montserrat", size: 9, bold: col <= 2, color: { argb: "FFFFFFFF" } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      }
    }
    for (let col = boardStart; col < totalColumn; col += 1) {
      sheet.getCell(1, col).alignment = { vertical: "middle", horizontal: "center", textRotation: 90, wrapText: true };
    }
    for (let col = 1; col <= wsColumn; col += 1) {
      const cell = sheet.getCell(3, col);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7E0D1" } };
      cell.font = { name: "Montserrat", size: 9, bold: true, color: { argb: "FF000000" } };
    }

    cursor = 4;
    model.groups.forEach((group) => {
      for (let col = 1; col <= wsColumn; col += 1) {
        const cell = sheet.getCell(cursor, col);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
        cell.font = { name: "Montserrat", size: 9, bold: true, color: { argb: "FF000000" } };
      }
      cursor += group.rows.length + 1;
    });
    for (let col = 1; col <= wsColumn; col += 1) {
      const cell = sheet.getCell(totalRow, col);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
      cell.font = { name: "Montserrat", size: 9, bold: true, color: { argb: "FF000000" } };
    }
    for (let row = 4; row < totalRow; row += 1) sheet.getCell(row, totalColumn).font = { name: "Montserrat", size: 9, bold: true };

    sheet.pageSetup.printArea = `A1:${lastColumn}${totalRow}`;
    sheet.pageSetup.printTitlesRow = "1:3";
    sheet.pageSetup.fitToHeight = totalRow <= 32 ? 1 : 0;
    return workbook;
  }

  function csv(model) {
    const escape = (value) => {
      const raw = String(value == null ? "" : value);
      return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
    };
    return "\ufeff" + matrixRows(model).map((row) => row.map(escape).join(",")).join("\r\n");
  }

  function safeFileName(value) {
    const cleaned = text(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
    return cleaned || "Electrical project";
  }

  return {
    GROUP_ORDER,
    buildModel,
    canonicalDevice,
    createExcelWorkbook,
    csv,
    deviceLabel,
    matrixRows,
    safeFileName,
  };
});
