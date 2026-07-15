(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.EstimationReport = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const GROUP_ORDER = [
    "MCB's",
    "RCBO's",
    "AFDD & Combined Protection",
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
    TIMECLOCK: "Time clock",
    "TIME CLOCK": "Time clock",
    PHOTOCELL: "Photocell",
    RELAY: "Relay",
    TIMER: "Timer",
    STARTER: "Starter",
    OVERLOAD: "Overload",
    TRANSFORMER: "Transformer",
    "DALI CONTROLLER": "DALI controller",
    "AFDD+RCBO": "AFDD+RCBO",
    "RCBO+AFDD": "AFDD+RCBO",
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
    if (key === "AFDD+RCBO") return "AFDD & Combined Protection";
    if (key === "MCCB") return "MCCB's";
    if (key === "ACB") return "ACB's";
    if (key === "RCD") return "RCD's";
    if (key === "ISOLATOR" || key === "SWITCH") return "Switches & Isolators";
    if (key === "FUSE") return "Fuses";
    if (key === "SPD") return "Surge Protection";
    if (["CONTACTOR", "TIME CLOCK", "PHOTOCELL", "RELAY", "TIMER", "STARTER", "OVERLOAD", "TRANSFORMER", "DALI CONTROLLER"].includes(key)) return "Contactors & Control";
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
    const device = canonicalDevice(row);
    const rating = Number(row && row.rating);
    const poles = Number(row && row.poles) || 1;
    const serviceCode = text(row && row.serviceCode).toUpperCase();
    if (/\bmech(?:anical)?\b/.test(explicit)) return "Mech";
    if (serviceCode === "L" && device === "MCB" && poles === 1 && (rating === 10 || rating === 32)) return "Lighting";
    if (!serviceCode && /\b(light|lighting|luminaire|luminaires|emergency lighting)\b/.test(`${explicit} ${description}`)) return "Lighting";
    if (device !== "MCB") return "";
    if (rating === 16 && poles === 1 && /\b(?:water fountains? circulation|fire smoke damper control)\b/.test(description)) return "Mech";
    if (rating === 20 && /\b(?:ahu|fcu|mvhr|bms|boiler|chiller|ventilation|pump|heat pump|indoor ac|ac units?|air conditioning|water heaters?|fume cupboard|drying oven|gas proving|extract (?:unit|fan))\b/.test(description)) return "Mech";
    if (rating === 32 && poles === 1 && /\bextract canopy\b/.test(description)) return "Mech";
    if (rating === 32 && poles >= 3 && /\b(?:condenser|condensor)\b/.test(description)) return "Mech";
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
    const poles = /^(MCB|RCBO|AFDD\+RCBO|MCCB|ACB|RCD)$/i.test(device) ? poleLabel(row) : "";
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

  const ASSOCIATED_DEFS = [
    { device: "Contactor", re: /\bcontactors?\b/i },
    { device: "Time clock", re: /\b(?:time\s*clock|timeclock)s?\b/i },
    { device: "Photocell", re: /\b(?:photo\s*cell|photocell)s?\b/i },
    { device: "Relay", re: /\brelays?\b/i },
    { device: "Timer", re: /\btimers?\b/i },
    { device: "Motor starter", re: /\b(?:motor\s+)?starters?\b/i },
    { device: "Overload", re: /\boverloads?\b/i },
    { device: "Transformer", re: /\btransformers?\b/i },
    { device: "DALI controller", re: /\bDALI\s+(?:headend|controller|control\s+unit)\b/i },
    { device: "Lighting controller", re: /\blighting\s+(?:controller|control\s+(?:module|unit))\b/i },
    { device: "Key switch", re: /\bkey\s+switch(?:es)?\b/i },
  ];

  function associatedEquipment(row) {
    if (Array.isArray(row && row.associatedDevices) && row.associatedDevices.length) {
      return row.associatedDevices.map((item) => ({
        device: text(item && (item.device || item.name)) || "Control equipment",
        qty: Math.max(1, Number(item && item.qty) || 1),
      }));
    }
    if (!row || !/^(?:MCB|RCBO|AFDD\+RCBO|MCCB|ACB|RCD|FUSE)$/i.test(canonicalDevice(row))) return [];
    const description = text(row.desc || row.description);
    const found = [];
    ASSOCIATED_DEFS.forEach((definition) => {
      const match = description.match(definition.re);
      if (!match) return;
      const before = description.slice(Math.max(0, match.index - 12), match.index);
      found.push({ device: definition.device, qty: Number(before.match(/(\d{1,3})\s*(?:x|×)\s*$/i)?.[1]) || 1 });
    });
    return found;
  }

  function buildAssociatedModel(included, boards, boardOrder, resolveBoard) {
    const grouped = new Map();
    included.forEach((source) => {
      const boardIndex = boardOrder.get(resolveBoard(source.boardNorm));
      if (boardIndex == null) return;
      associatedEquipment(source).forEach((item) => {
        const label = text(item.device) || "Control equipment";
        const key = label.toUpperCase();
        if (!grouped.has(key)) {
          grouped.set(key, {
            key,
            group: "Control & associated equipment",
            label,
            rating: 0,
            pole: "",
            quantities: Array(boards.length).fill(0),
            rowIdsByBoard: Array.from({ length: boards.length }, () => []),
            total: 0,
          });
        }
        const reportRow = grouped.get(key);
        reportRow.quantities[boardIndex] += item.qty;
        reportRow.total += item.qty;
        if (source.id) reportRow.rowIdsByBoard[boardIndex].push(source.id);
      });
    });
    const rows = Array.from(grouped.values()).sort((left, right) => naturalCompare(left.label, right.label));
    const groups = rows.length ? [{ name: "Control & associated equipment", rows }] : [];
    const boardTotals = boards.map((_, index) => rows.reduce((sum, row) => sum + row.quantities[index], 0));
    return {
      groups,
      boardTotals,
      grandTotal: boardTotals.reduce((sum, value) => sum + value, 0),
      deviceLineCount: rows.length,
    };
  }

  function groupIndex(name) {
    const index = GROUP_ORDER.indexOf(name);
    return index < 0 ? GROUP_ORDER.length : index;
  }

  function boardEntries(boards) {
    return Object.entries(boards || {}).map(([sourceNorm, board]) => {
      const rawLabel = text(board && (board.orig || board.ref)) || sourceNorm;
      let label = rawLabel.toUpperCase()
        .replace(/\s*[._/\\-]\s*/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      const split = label.match(/^(DB(?:-[A-Z0-9]+)+)-(LP|L|P)$/i);
      if (split && /(?:^|-)\d{1,3}$/.test(split[1])) label = split[1];
      const norm = label.replace(/[\s._/\\-]+/g, "");
      return { sourceNorm, norm, label: label || rawLabel, type: text(board && board.type) };
    });
  }

  function buildModel(options) {
    const rows = Array.isArray(options && options.rows) ? options.rows : [];
    const knownBoards = boardEntries(options && options.boards);
    const aliases = new Map(knownBoards.map((board) => [board.sourceNorm, board.norm]));
    const knownMap = new Map();
    knownBoards.forEach((board) => {
      if (!knownMap.has(board.norm)) knownMap.set(board.norm, board);
    });
    const included = rows.filter(includeRow);
    const resolveBoard = (value) => aliases.get(text(value)) || text(value);
    const activeBoards = new Set(included.map((row) => resolveBoard(row.boardNorm)).filter(Boolean));
    const boardMap = new Map();
    if (options && options.includeEmptyBoards) knownMap.forEach((board, norm) => boardMap.set(norm, board));
    else included.forEach((row) => {
      const norm = resolveBoard(row.boardNorm);
      if (norm && activeBoards.has(norm) && !boardMap.has(norm)) boardMap.set(norm, knownMap.get(norm) || { norm, label: norm, type: "" });
    });

    included.forEach((row) => {
      const norm = resolveBoard(row.boardNorm);
      if (norm && !boardMap.has(norm)) boardMap.set(norm, { norm, label: norm, type: "" });
    });

    const boards = Array.from(boardMap.values());
    const boardOrder = new Map(boards.map((board, index) => [board.norm, index]));
    const grouped = new Map();
    let unassignedQty = 0;

    included.forEach((source) => {
      const qty = Math.max(1, Number(source.qty) || 1);
      const boardIndex = boardOrder.get(resolveBoard(source.boardNorm));
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
    const activeCoverageNorms = new Set();
    included.forEach((row) => activeCoverageNorms.add(text(row.boardNorm)));
    boards.forEach((board) => {
      activeCoverageNorms.add(text(board.sourceNorm));
      activeCoverageNorms.add(text(board.norm));
    });
    const coverageBoardIsActive = (norm) => activeCoverageNorms.has(text(norm));
    const coverageIssueCount = coverage
      ? (coverage.perBoard || []).filter((board) =>
        coverageBoardIsActive(board.norm) && Number(board.unaccountedWays || 0) > 0).length
        + (coverage.zeroRowSchedulePages || []).filter((page) => {
          const norms = Array.isArray(page.boardNorms) && page.boardNorms.length
            ? page.boardNorms
            : [page.boardNorm].filter(Boolean);
          return norms.length ? norms.some(coverageBoardIsActive) : true;
        }).length
      : 0;
    const grandTotal = boardTotals.reduce((sum, value) => sum + value, 0);
    const deviceLineCount = groups.reduce((sum, group) => sum + group.rows.length, 0);
    const associated = buildAssociatedModel(included, boards, boardOrder, resolveBoard);

    return {
      projectName: text(options && options.projectName) || "Electrical project",
      generatedAt: options && options.generatedAt ? new Date(options.generatedAt) : new Date(),
      boards,
      groups,
      boardTotals,
      grandTotal,
      deviceLineCount,
      associated,
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

  function matrixRows(model, options = {}) {
    const groups = options.groups || model.groups;
    const boardTotals = options.boardTotals || model.boardTotals;
    const grandTotal = options.grandTotal == null ? model.grandTotal : options.grandTotal;
    const title = options.title || "Distribution Board Devices";
    const totalLabel = options.totalLabel || "DB Device Total";
    const rows = [];
    rows.push([model.projectName, "DB Reference", ...model.boards.map((board) => board.label), null, null]);
    rows.push([title, null, ...model.boards.map(() => null), null, null]);
    rows.push(["Discipline", "Unit", ...model.boards.map(() => "Qty"), "Total", "WS"]);
    groups.forEach((group) => {
      rows.push([group.name, null, ...model.boards.map(() => null), null, null]);
      group.rows.forEach((row) => rows.push([row.label, "Nr", ...row.quantities.map((qty) => qty || null), row.total, null]));
    });
    rows.push([totalLabel, null, ...boardTotals, grandTotal, null]);
    return rows;
  }

  function createMatrixWorksheet(workbook, model, options = {}) {
    const groups = options.groups || model.groups;
    const boardTotals = options.boardTotals || model.boardTotals;
    const grandTotal = options.grandTotal == null ? model.grandTotal : options.grandTotal;
    const sheet = workbook.addWorksheet(options.sheetName || "DB Devices", {
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
    const rows = matrixRows(model, options);
    rows.forEach((values, rowIndex) => {
      values.forEach((value, columnIndex) => {
        sheet.getCell(rowIndex + 1, columnIndex + 1).value = value;
      });
    });

    let cursor = 4;
    groups.forEach((group) => {
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
    boardTotals.forEach((value, index) => {
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
        result: grandTotal,
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
    groups.forEach((group) => {
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
    return sheet;
  }

  function createExcelWorkbook(model, ExcelJS) {
    if (!ExcelJS || typeof ExcelJS.Workbook !== "function") throw new Error("Excel export library is unavailable");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Estimation Tools";
    workbook.company = "Hager";
    workbook.created = model.generatedAt;
    workbook.modified = model.generatedAt;
    workbook.calcProperties.fullCalcOnLoad = true;

    createMatrixWorksheet(workbook, model, {
      sheetName: "DB Devices",
      title: "Distribution Board Devices",
      totalLabel: "DB Device Total",
    });
    if (model.associated && model.associated.grandTotal) {
      createMatrixWorksheet(workbook, model, {
        sheetName: "Control Equipment",
        title: "Control & Associated Equipment",
        totalLabel: "Associated Equipment Total",
        groups: model.associated.groups,
        boardTotals: model.associated.boardTotals,
        grandTotal: model.associated.grandTotal,
      });
    }
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
