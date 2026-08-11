(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.EstimationReport = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const GROUP_ORDER = [
    "MCBs",
    "RCBOs",
    "AFDD & Combined Protection",
    "MCCBs",
    "ACBs",
    "RCDs",
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

  const NOT_SPECIFIED = "Not specified";
  const UNCLEAR = "Unclear";
  const QUALIFICATIONS = {
    curve: "Tripping curve not specified in the source document. No curve has been assumed. Confirm the required tripping characteristic before procurement or final quotation.",
    breakingCapacity: "Breaking capacity not specified in the source document. No breaking capacity has been assumed. Confirm the required value before procurement or final quotation.",
    poles: "Pole configuration could not be confirmed from the source document. Review required before procurement or final quotation.",
    rating: "Current rating could not be confirmed from the source document. Review required before procurement or final quotation.",
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
    const original = text(row && row.device);
    const raw = original
      .toUpperCase()
      .replace(/\bMINIATURE\s+CIRCUIT\s+BREAKER\b/g, "MCB")
      .replace(/\bMOULDED\s+CASE\s+CIRCUIT\s+BREAKER\b/g, "MCCB")
      .replace(/\bRESIDUAL\s+CURRENT\s+BREAKER\s+WITH\s+OVERCURRENT\b/g, "RCBO")
      .replace(/\bRESIDUAL\s+CURRENT\s+DEVICE\b/g, "RCD")
      .replace(/[^A-Z0-9+]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/S$/i, "");
    const compact = raw.replace(/\s+/g, "");
    return DEVICE_NAMES[raw] || DEVICE_NAMES[compact] || original || "Other device";
  }

  function groupForDevice(device) {
    const key = text(device).toUpperCase();
    if (key === "MCB") return "MCBs";
    if (key === "RCBO") return "RCBOs";
    if (key === "AFDD+RCBO") return "AFDD & Combined Protection";
    if (key === "MCCB") return "MCCBs";
    if (key === "ACB") return "ACBs";
    if (key === "RCD") return "RCDs";
    if (key === "ISOLATOR" || key === "SWITCH") return "Switches & Isolators";
    if (key === "FUSE") return "Fuses";
    if (key === "SPD") return "Surge Protection";
    if (["CONTACTOR", "TIME CLOCK", "PHOTOCELL", "RELAY", "TIMER", "STARTER", "OVERLOAD", "TRANSFORMER", "DALI CONTROLLER"].includes(key)) return "Contactors & Control";
    if (key === "METER") return "Metering";
    return "Other Devices";
  }

  function normalisePole(value, row) {
    const source = text(value).toUpperCase().replace(/[.]/g, "").replace(/\s+/g, " ");
    if (/\b(?:SINGLE\s+POLE\s+(?:AND|&)\s+NEUTRAL|1P\s*\+\s*N|SPN)\b/.test(source)) return "SPN";
    if (/\b(?:DOUBLE\s+POLE\s+(?:AND|&)\s+NEUTRAL|2P\s*\+\s*N|DPN)\b/.test(source)) return "DPN";
    if (/\b(?:TRIPLE\s+POLE\s+(?:AND|&)\s+NEUTRAL|THREE\s+POLE\s+(?:AND|&)\s+NEUTRAL|3P\s*\+\s*N|TPN|TP&N)\b/.test(source)) return "TPN";
    if (/^(?:SP|1P|SINGLE POLE)$/.test(source)) return "SP";
    if (/^(?:DP|2P|DOUBLE POLE)$/.test(source)) return "DP";
    if (/^(?:TP|3P|TRIPLE POLE|THREE POLE)$/.test(source)) return "TP";
    if (/^(?:4P|FOUR POLE)$/.test(source)) return "4P";
    if (source === NOT_SPECIFIED.toUpperCase()) return NOT_SPECIFIED;
    if (source === UNCLEAR.toUpperCase()) return UNCLEAR;
    const poles = Number(value);
    if (poles === 4) return "4P";
    if (poles === 3) return "TP";
    if (poles === 2) return "DPN";
    if (poles === 1) return "SPN";
    const phase = text(row && row.phase).toUpperCase();
    if (phase === "3PH" || phase === "L1L2L3") return "TP";
    return row && row.polesUnclear ? UNCLEAR : UNCLEAR;
  }

  function poleLabel(row) {
    return normalisePole(row && (row.poleConfiguration || row.poleConfig || row.pole || row.poles), row);
  }

  function normaliseCurve(value) {
    const source = text(value).toUpperCase();
    if (!source || source === NOT_SPECIFIED.toUpperCase()) return NOT_SPECIFIED;
    const compact = source.match(/^([BCDKZ])\s*[- ]?\s*\d+(?:\.\d+)?\s*A?$/i);
    if (compact) return compact[1].toUpperCase();
    const match = source.match(/(?:^|\b)(?:TYPE|CURVE|CHARACTERISTIC)?\s*[-:]?\s*([BCDKZ])(?:\s*[- ]?CURVE)?(?:\b|$)/i);
    return match ? match[1].replace(/\s/g, "").toUpperCase() : source;
  }

  function normaliseBreakingCapacity(value) {
    if (value == null || text(value) === "" || text(value).toUpperCase() === NOT_SPECIFIED.toUpperCase()) return NOT_SPECIFIED;
    const source = text(value).replace(/,/g, ".");
    const match = source.match(/(\d+(?:\.\d+)?)\s*(?:K?A)?/i);
    if (!match) return source;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return source;
    return `${Number.isInteger(amount) ? amount : Number(amount.toFixed(2))}kA`;
  }

  function normaliseRating(value) {
    if (value == null || text(value) === "") return null;
    const match = text(value).replace(/,/g, ".").match(/\d+(?:\.\d+)?/);
    const rating = match ? Number(match[0]) : Number(value);
    return Number.isFinite(rating) && rating > 0 ? rating : null;
  }

  function normaliseBoolean(value) {
    if (value === true || value === false) return value;
    const source = text(value).toUpperCase();
    if (/^(?:YES|Y|TRUE|1|CHECKED|TICK)$/.test(source)) return true;
    if (/^(?:NO|N|FALSE|0|X)$/.test(source)) return false;
    return null;
  }

  function normaliseSensitivity(value) {
    if (value == null || text(value) === '') return null;
    const match = text(value).replace(/,/g, '.').match(/\d+(?:\.\d+)?/);
    const sensitivity = match ? Number(match[0]) : Number(value);
    return Number.isFinite(sensitivity) && sensitivity > 0 && sensitivity <= 1000 ? sensitivity : null;
  }

  function normaliseProtectionStandard(value) {
    const source = text(value).toUpperCase().replace(/\s+/g, ' ');
    if (!source) return NOT_SPECIFIED;
    const match = source.match(/\b(60898(?:-1)?|61009(?:-1)?|61008(?:-1)?|60947(?:\s*[-/]\s*[23])?)\b/);
    if (!match) return source;
    const code = match[1].replace(/\s+/g, '').replace('/', '-').replace(/-(?:1)$/, '');
    return `BS EN ${code}`;
  }

  function protectionSpecification(row) {
    const rcdSensitivity = normaliseSensitivity(row && (row.rcdSensitivity ?? row.sens));
    const explicitRcd = normaliseBoolean(row && row.rcdProtected);
    const rcdProtected = explicitRcd == null && rcdSensitivity != null ? true : explicitRcd;
    const hasAfddIndicator = Boolean(row && Object.prototype.hasOwnProperty.call(row, 'afddIndicated'));
    const afdd = hasAfddIndicator ? normaliseBoolean(row.afddIndicated) : normaliseBoolean(row && row.afdd);
    return {
      protectionStandard: normaliseProtectionStandard(row && (row.protectionStandard || row.standard)),
      tripUnit: text(row && row.tripUnit) || NOT_SPECIFIED,
      rcdProtected,
      rcdSensitivity,
      afdd,
    };
  }

  function rcdProtectionLabel(value, sensitivity) {
    if (value === true) return sensitivity == null ? 'RCD protected' : `RCD ${formatRating(sensitivity)}mA`;
    if (value === false) return 'No RCD';
    return NOT_SPECIFIED;
  }

  function afddProtectionLabel(value) {
    if (value === true) return 'AFDD';
    if (value === false) return 'No AFDD';
    return NOT_SPECIFIED;
  }

  function disciplineLabel(row) {
    const explicit = text((row && (row.discipline || row.service)) || "").toLowerCase();
    const description = text((row && (row.desc || row.description)) || "").toLowerCase();
    const serviceCode = text(row && row.serviceCode).toUpperCase();
    if (/\bmech(?:anical)?\b/.test(explicit)) return "Mechanical";
    if (/\bsmall\s+power\b/.test(explicit)) return "Small Power";
    if (/\bpower\b/.test(explicit)) return "Power";
    if (/\blight(?:ing)?\b/.test(explicit)) return "Lighting";
    if (serviceCode === "L") return "Lighting";
    if (serviceCode === "P") return "Power";
    if (/\b(light|lighting|luminaire|luminaires|emergency lighting)\b/.test(description)) return "Lighting";
    if (/\b(?:mechanical|ahu|fcu|mvhr|bms|boiler|chiller|ventilation|pump|heat pump|air conditioning|water heater|extract fan|condenser|condensor)\b/.test(description)) return "Mechanical";
    if (/\bsmall\s+power\b|\bsocket(?:s| outlet)?\b/.test(description)) return "Small Power";
    return "General / unspecified";
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
    return [rating ? `${rating}A` : NOT_SPECIFIED, poles, device].filter(Boolean).join(" ");
  }

  function includeRow(row) {
    if (!row || row.status === "rejected" || row.outOfScope || row.space || !row.device) return false;
    if (row.spare && !row.device) return false;
    if (row.kind === "mention" && row.status !== "confirmed") return false;
    return Number(row.qty || 1) > 0;
  }

  const ASSOCIATED_DEFS = [
    { device: "Contactor", re: /\bcontactors?\b/i },
    { device: "Emergency power off", re: /\bEPO\b|\bemergency\s+(?:power\s+)?off\b|\bmushroom\s+push\s+button\s+emergency\s+stop\b/i },
    { device: "Key reset", re: /\bkey\s+reset(?:\s+buttons?)?\b/i },
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
    { device: "BMS interface", re: /\bBMS\s+(?:interface|connection|control\s+point)\b/i },
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

  function buildAssociatedModel(included, boards, boardOrder, resolveBoard, fileNames) {
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
            deviceFamily: label,
            rating: null,
            pole: NOT_SPECIFIED,
            curve: NOT_SPECIFIED,
            breakingCapacity: NOT_SPECIFIED,
            quantities: Array(boards.length).fill(0),
            rowIdsByBoard: Array.from({ length: boards.length }, () => []),
            contributors: [],
            purposes: [],
            sourcePages: [],
            confidence: 1,
            notes: ["Technical selection details for associated control equipment were not specified in the source. Confirm coil voltage, poles, duty, and product reference before procurement."],
            reviewReasons: ["Associated control-equipment specification is incomplete"],
            reviewStatus: "Review required",
            total: 0,
          });
        }
        const reportRow = grouped.get(key);
        const specification = { key, deviceFamily: label, rating: null, pole: NOT_SPECIFIED, curve: NOT_SPECIFIED, breakingCapacity: NOT_SPECIFIED };
        const contributor = contributorFor({ ...source, device: label, qty: item.qty }, specification, boards[boardIndex], fileNames || new Map());
        reportRow.quantities[boardIndex] += item.qty;
        reportRow.total += item.qty;
        reportRow.contributors.push(contributor);
        reportRow.confidence = Math.min(reportRow.confidence, contributor.confidence);
        if (source.id) reportRow.rowIdsByBoard[boardIndex].push(source.id);
      });
    });
    grouped.forEach((reportRow) => {
      reportRow.purposes = Array.from(new Set(reportRow.contributors.map((item) => item.purpose))).sort(purposeSort);
      reportRow.sourcePages = summariseSourcePages(reportRow.contributors);
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
      return {
        sourceNorm,
        norm,
        label: label || rawLabel,
        type: text(board && board.type),
        inScope: board?.inScope !== false,
        outOfScopeReasons: Array.isArray(board?.outOfScopeReasons) ? board.outOfScopeReasons.slice() : [],
      };
    });
  }

  function extractionMethod(row) {
    if (text(row && row.extractionMethod)) return text(row.extractionMethod);
    if (row && row.kind === "ai") return "AI-assisted extraction";
    if (row && row.kind === "manual") return "Manual entry";
    if (row && row.ocr) return "OCR";
    return "Embedded text / deterministic parser";
  }

  function sourceFingerprint(row) {
    const board = text(row && row.boardNorm).toUpperCase();
    const way = row && (row.circuitReference ?? row.circuitRef ?? row.way);
    const phase = text(row && row.phase).toUpperCase();
    const specification = deviceSpecification(row);
    if (board && way != null && text(way) !== "") {
      return ["circuit", board, text(way), phase, specification.key].join("|");
    }
    const bbox = Array.isArray(row && row.bbox) ? row.bbox.map((value) => Number(value).toFixed(1)).join(",") : "";
    if (text(row && row.fileId) && row && row.page != null && bbox) {
      return ["region", text(row.fileId), row.page, bbox, specification.key].join("|");
    }
    return ["source", text(row && row.id), text(row && row.fileId), row && row.page, row && row.line, text(row && row.srcText)].join("|");
  }

  function deduplicateRows(rows) {
    const unique = [];
    const duplicates = [];
    const byFingerprint = new Map();
    (rows || []).forEach((row) => {
      const fingerprint = sourceFingerprint(row);
      const priorIndex = byFingerprint.get(fingerprint);
      if (priorIndex == null) {
        byFingerprint.set(fingerprint, unique.length);
        unique.push(row);
        return;
      }
      const prior = unique[priorIndex];
      const priorScore = (prior.status === "confirmed" ? 2 : 0) + Number(prior.conf || 0);
      const nextScore = (row.status === "confirmed" ? 2 : 0) + Number(row.conf || 0);
      if (nextScore > priorScore) {
        unique[priorIndex] = row;
        duplicates.push({ excluded: prior, retained: row, fingerprint });
      } else {
        duplicates.push({ excluded: row, retained: prior, fingerprint });
      }
    });
    return { unique, duplicates };
  }

  function purposeSort(left, right) {
    const order = ["General / unspecified", "Lighting", "Mechanical", "Power", "Small Power"];
    const a = order.indexOf(left);
    const b = order.indexOf(right);
    return (a < 0 ? order.length : a) - (b < 0 ? order.length : b) || naturalCompare(left, right);
  }

  function summariseSourcePages(contributors) {
    const sources = new Map();
    (contributors || []).forEach((item) => {
      const document = text(item.sourceDocument) || NOT_SPECIFIED;
      if (!sources.has(document)) sources.set(document, new Set());
      sources.get(document).add(text(item.page) || NOT_SPECIFIED);
    });
    return Array.from(sources.entries())
      .sort((left, right) => naturalCompare(left[0], right[0]))
      .map(([document, pages]) => `${document} ${Array.from(pages).sort(naturalCompare).map((page) => `p${page}`).join(", ")}`);
  }

  function deviceSpecification(row) {
    const deviceFamily = canonicalDevice(row);
    const rating = normaliseRating(row && row.rating);
    const curve = normaliseCurve(row && row.curve);
    const breakingCapacity = normaliseBreakingCapacity(row && (row.breakingCapacity ?? row.breakingCapacityKa ?? row.ka));
    const pole = poleLabel(row);
    const protection = protectionSpecification(row);
    const key = [
      deviceFamily.toUpperCase(), rating == null ? NOT_SPECIFIED : formatRating(rating), curve, breakingCapacity, pole,
      protection.protectionStandard, protection.tripUnit,
      protection.rcdProtected == null ? NOT_SPECIFIED : protection.rcdProtected ? 'RCD' : 'NO RCD',
      protection.rcdSensitivity == null ? NOT_SPECIFIED : `${formatRating(protection.rcdSensitivity)}mA`,
      protection.afdd == null ? NOT_SPECIFIED : protection.afdd ? 'AFDD' : 'NO AFDD',
    ]
      .join("|");
    return { key, deviceFamily, rating, curve, breakingCapacity, pole, ...protection };
  }

  function markSpecificationConflicts(reportRows) {
    const checks = [
      {
        field: "curve",
        identity: (row) => [row.deviceFamily, row.rating, row.pole, row.breakingCapacity],
        missing: (value) => value === NOT_SPECIFIED,
        reason: "Conflicting tripping curves appear for otherwise identical devices",
        note: "Multiple tripping curves were extracted for the same family, rating, pole configuration, and breaking capacity. Lines remain separate; confirm each source selection before procurement.",
      },
      {
        field: "breakingCapacity",
        identity: (row) => [row.deviceFamily, row.rating, row.pole, row.curve],
        missing: (value) => value === NOT_SPECIFIED,
        reason: "Conflicting breaking capacities appear for otherwise identical devices",
        note: "Multiple breaking capacities were extracted for the same family, rating, pole configuration, and tripping curve. Lines remain separate; confirm each source selection before procurement.",
      },
      {
        field: "pole",
        identity: (row) => [row.deviceFamily, row.rating, row.curve, row.breakingCapacity],
        missing: (value) => value === NOT_SPECIFIED || value === UNCLEAR,
        reason: "Conflicting pole configurations appear for otherwise identical devices",
        note: "Multiple pole configurations were extracted for the same family, rating, tripping curve, and breaking capacity. Lines remain separate; confirm each source selection before procurement.",
      },
    ];

    checks.forEach((check) => {
      const candidates = new Map();
      reportRows.forEach((row) => {
        if (check.missing(row[check.field])) return;
        const identity = check.identity(row).map((value) => text(value).toUpperCase()).join("|");
        if (!candidates.has(identity)) candidates.set(identity, []);
        candidates.get(identity).push(row);
      });
      candidates.forEach((rows) => {
        if (new Set(rows.map((row) => row[check.field])).size < 2) return;
        rows.forEach((row) => {
          row.reviewReasons.push(check.reason);
          row.notes.push(check.note);
        });
      });
    });
  }

  function contributorFor(row, specification, board, fileNames) {
    const quantity = Math.max(1, Number(row && row.qty) || 1);
    const confidence = Math.max(0, Math.min(1, Number(row && row.conf) || 0));
    const sourceDocument = text(row && row.fileName) || fileNames.get(text(row && row.fileId)) || text(row && row.fileId) || NOT_SPECIFIED;
    const bbox = Array.isArray(row && row.bbox) ? Array.from(row.bbox) : null;
    const corrections = Array.isArray(row && row.corrections)
      ? row.corrections
      : row && row.correction
        ? [row.correction]
        : [];
    const printedCircuitReference = text(row && (row.circuitReference ?? row.circuitRef));
    const way = row && row.way != null ? row.way : null;
    return {
      groupKey: specification.key,
      sourceId: text(row && row.id) || sourceFingerprint(row),
      boardNorm: board ? board.norm : text(row && row.boardNorm),
      board: board ? board.label : text(row && row.boardNorm) || NOT_SPECIFIED,
      circuitReference: printedCircuitReference || (way == null ? NOT_SPECIFIED : `Way ${way}`),
      printedCircuitReference: printedCircuitReference || null,
      way,
      phase: text(row && row.phase) || null,
      description: text(row && (row.desc || row.description)) || NOT_SPECIFIED,
      purpose: disciplineLabel(row),
      role: row && row.incomer ? "Incomer" : "Outgoing",
      quantity,
      deviceFamily: specification.deviceFamily,
      rating: specification.rating,
      pole: specification.pole,
      curve: specification.curve,
      breakingCapacity: specification.breakingCapacity,
      protectionStandard: specification.protectionStandard,
      tripUnit: specification.tripUnit,
      rcdProtected: specification.rcdProtected,
      rcdSensitivity: specification.rcdSensitivity,
      afdd: specification.afdd,
      sourceDocument,
      fileId: text(row && row.fileId),
      page: row && row.page != null ? row.page : NOT_SPECIFIED,
      bbox,
      highlightBbox: Array.isArray(row && row.highlightBbox) ? Array.from(row.highlightBbox) : bbox,
      sourceText: text(row && row.srcText),
      originalOcrText: text(row && (row.originalOcrText || row.ocrText || row.srcText)),
      confidence,
      extractionMethod: extractionMethod(row),
      corrections,
      reviewStatus: row && row.status === "confirmed" ? "Approved" : "Review required",
      fieldEvidence: row && row.fieldEvidence ? row.fieldEvidence : null,
    };
  }

  function circuitLocators(contributors) {
    return Array.from(new Set((contributors || []).map((item) => {
      const location = [item.way == null ? null : `Way ${item.way}`, item.phase].filter(Boolean).join(' ');
      const reference = item.printedCircuitReference;
      return [location || null, reference || null].filter(Boolean).join(' - ') || NOT_SPECIFIED;
    }))).sort(naturalCompare);
  }

  function buildBoardSections(boards, groups, boardTotals) {
    const reportRows = (groups || []).flatMap((group) => group.rows || []);
    return (boards || []).map((board, boardIndex) => {
      const familyMap = new Map();
      reportRows.forEach((reportRow) => {
        const contributors = (reportRow.contributors || []).filter((item) => item.boardNorm === board.norm);
        const quantity = Number(reportRow.quantities?.[boardIndex]) || 0;
        if (!quantity || !contributors.length) return;
        const familyKey = reportRow.deviceFamily;
        if (!familyMap.has(familyKey)) familyMap.set(familyKey, {
          name: reportRow.deviceFamily,
          category: reportRow.group,
          total: 0,
          rows: [],
        });
        const family = familyMap.get(familyKey);
        family.total += quantity;
        family.rows.push({
          ...reportRow,
          quantity,
          contributors,
          circuitLocators: circuitLocators(contributors),
          descriptions: Array.from(new Set(contributors.map((item) => item.description).filter((value) => value !== NOT_SPECIFIED))).sort(naturalCompare),
          sourcePages: summariseSourcePages(contributors),
          reviewStatus: reportRow.reviewReasons.length || contributors.some((item) => item.reviewStatus !== 'Approved') ? 'Review required' : 'Ready',
          rcdLabel: rcdProtectionLabel(reportRow.rcdProtected, reportRow.rcdSensitivity),
          afddLabel: afddProtectionLabel(reportRow.afdd),
        });
      });
      const families = Array.from(familyMap.values()).sort((left, right) =>
        groupIndex(left.category) - groupIndex(right.category) || naturalCompare(left.name, right.name));
      return {
        ...board,
        total: Number(boardTotals?.[boardIndex]) || 0,
        reviewCount: families.flatMap((family) => family.rows).filter((row) => row.reviewStatus !== 'Ready').length,
        families,
      };
    });
  }

  function buildModel(options) {
    const rows = Array.isArray(options && options.rows) ? options.rows : [];
    const allKnownBoards = boardEntries(options && options.boards);
    const excludedBoardNorms = new Set(allKnownBoards.filter((board) => !board.inScope).flatMap((board) => [board.sourceNorm, board.norm]));
    const knownBoards = allKnownBoards.filter((board) => board.inScope);
    const aliases = new Map(knownBoards.map((board) => [board.sourceNorm, board.norm]));
    const knownMap = new Map();
    knownBoards.forEach((board) => {
      if (!knownMap.has(board.norm)) knownMap.set(board.norm, board);
    });
    const accepted = rows.filter((row) => includeRow(row) && !excludedBoardNorms.has(text(row.boardNorm)));
    const deduplicated = deduplicateRows(accepted);
    const included = deduplicated.unique;
    const fileNames = new Map((Array.isArray(options && options.files) ? options.files : [])
      .map((file) => [text(file && file.id), text(file && file.name)]));
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
      const specification = deviceSpecification(source);
      const label = deviceLabel({ ...source, rating: specification.rating, poleConfiguration: specification.pole });
      const group = groupForDevice(specification.deviceFamily);
      const key = specification.key;
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          group,
          label,
          deviceFamily: specification.deviceFamily,
          rating: specification.rating,
          pole: specification.pole,
          curve: specification.curve,
          breakingCapacity: specification.breakingCapacity,
          protectionStandard: specification.protectionStandard,
          tripUnit: specification.tripUnit,
          rcdProtected: specification.rcdProtected,
          rcdSensitivity: specification.rcdSensitivity,
          afdd: specification.afdd,
          quantities: Array(boards.length).fill(0),
          rowIdsByBoard: Array.from({ length: boards.length }, () => []),
          contributors: [],
          purposes: [],
          sourcePages: [],
          confidence: 1,
          reviewReasons: [],
          notes: [],
          reviewStatus: "Ready",
          total: 0,
        });
      }
      const reportRow = grouped.get(key);
      const contributor = contributorFor(source, specification, boards[boardIndex], fileNames);
      reportRow.quantities[boardIndex] += qty;
      reportRow.total += qty;
      reportRow.contributors.push(contributor);
      reportRow.confidence = Math.min(reportRow.confidence, contributor.confidence);
      if (source.id) reportRow.rowIdsByBoard[boardIndex].push(source.id);
    });

    grouped.forEach((reportRow) => {
      reportRow.purposes = Array.from(new Set(reportRow.contributors.map((item) => item.purpose))).sort(purposeSort);
      reportRow.sourcePages = summariseSourcePages(reportRow.contributors);
      if (reportRow.rating == null) {
        reportRow.notes.push(QUALIFICATIONS.rating);
        reportRow.reviewReasons.push("Current rating is missing");
      }
      if (reportRow.curve === NOT_SPECIFIED) {
        reportRow.notes.push(QUALIFICATIONS.curve);
        reportRow.reviewReasons.push("Tripping curve is not specified");
      }
      if (reportRow.breakingCapacity === NOT_SPECIFIED) {
        reportRow.notes.push(QUALIFICATIONS.breakingCapacity);
        reportRow.reviewReasons.push("Breaking capacity is not specified");
      }
      if (reportRow.pole === UNCLEAR || reportRow.pole === NOT_SPECIFIED) {
        reportRow.notes.push(QUALIFICATIONS.poles);
        reportRow.reviewReasons.push("Pole configuration is unclear");
      }
      if (reportRow.contributors.every((item) => item.description === NOT_SPECIFIED)) {
        reportRow.reviewReasons.push("Circuit description is missing");
      }
      if (reportRow.confidence < 0.8) reportRow.reviewReasons.push("One or more source values have low confidence");
      if (reportRow.contributors.some((item) => item.reviewStatus !== "Approved")) reportRow.reviewReasons.push("One or more source records need review");
      if (reportRow.contributors.some((item) => item.reviewStatus !== "Approved" && item.corrections.length)) {
        reportRow.reviewReasons.push("An automatic OCR correction needs confirmation");
      }
    });

    markSpecificationConflicts(Array.from(grouped.values()));
    grouped.forEach((reportRow) => {
      reportRow.reviewReasons = Array.from(new Set(reportRow.reviewReasons));
      reportRow.notes = Array.from(new Set(reportRow.notes));
      reportRow.reviewStatus = reportRow.reviewReasons.length ? "Review required" : "Ready";
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
          (a.rating == null ? Number.MAX_SAFE_INTEGER : a.rating) - (b.rating == null ? Number.MAX_SAFE_INTEGER : b.rating) ||
          (poleRank[a.pole] || 9) - (poleRank[b.pole] || 9) ||
          naturalCompare(a.curve, b.curve) ||
          naturalCompare(a.breakingCapacity, b.breakingCapacity) ||
          naturalCompare(a.label, b.label),
        ),
      }));

    const boardTotals = boards.map((_, index) =>
      groups.reduce((sum, group) => sum + group.rows.reduce((subtotal, row) => subtotal + row.quantities[index], 0), 0),
    );
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
    const associated = buildAssociatedModel(included, boards, boardOrder, resolveBoard, fileNames);
    associated.boardSections = buildBoardSections(boards, associated.groups, associated.boardTotals);
    const procurementRows = groups.flatMap((group) => group.rows);
    const reviewCount = procurementRows.filter((row) => row.reviewStatus === "Review required").length;
    const sourceTotal = included.reduce((sum, row) => {
      return boardOrder.has(resolveBoard(row.boardNorm)) ? sum + Math.max(1, Number(row.qty) || 1) : sum;
    }, 0);

    const model = {
      projectName: text(options && options.projectName) || "Electrical project",
      generatedAt: options && options.generatedAt ? new Date(options.generatedAt) : new Date(),
      boards,
      groups,
      boardSections: buildBoardSections(boards, groups, boardTotals),
      boardTotals,
      grandTotal,
      deviceLineCount,
      associated,
      reviewCount,
      coverageIssueCount,
      unassignedQty,
      includedRows: included.length,
      sourceTotal,
      duplicateCount: deduplicated.duplicates.length,
      duplicates: deduplicated.duplicates,
    };
    model.reconciliation = validateModel(model);
    return model;
  }

  function validateModel(model) {
    const issues = [];
    const rows = (model && Array.isArray(model.groups) ? model.groups : [])
      .flatMap((group) => Array.isArray(group.rows) ? group.rows : []);
    let sourceTotal = 0;
    let groupTotal = 0;
    rows.forEach((row) => {
      const boardSum = (row.quantities || []).reduce((sum, value) => sum + (Number(value) || 0), 0);
      const contributorSum = (row.contributors || []).reduce((sum, contributor) => sum + (Number(contributor.quantity) || 0), 0);
      const total = Number(row.total) || 0;
      groupTotal += total;
      sourceTotal += contributorSum;
      if (boardSum !== total) issues.push(`${row.label}: total ${total} does not equal board-column sum ${boardSum}`);
      if (contributorSum !== total) issues.push(`${row.label}: total ${total} does not equal contributing-record sum ${contributorSum}`);
    });
    const calculatedBoardTotals = (model && Array.isArray(model.boards) ? model.boards : []).map((_, index) =>
      rows.reduce((sum, row) => sum + (Number(row.quantities && row.quantities[index]) || 0), 0));
    const declaredBoardTotals = model && Array.isArray(model.boardTotals) ? model.boardTotals : [];
    calculatedBoardTotals.forEach((value, index) => {
      if (value !== (Number(declaredBoardTotals[index]) || 0)) {
        issues.push(`Board ${model.boards[index].label}: declared total ${declaredBoardTotals[index] || 0} does not equal device-line sum ${value}`);
      }
    });
    const boardTotal = declaredBoardTotals.reduce((sum, value) => sum + (Number(value) || 0), 0);
    const grandTotal = Number(model && model.grandTotal) || 0;
    if (boardTotal !== grandTotal) issues.push(`Grand total ${grandTotal} does not equal board total ${boardTotal}`);
    if (groupTotal !== grandTotal) issues.push(`Grand total ${grandTotal} does not equal procurement-line total ${groupTotal}`);
    if (sourceTotal !== grandTotal) issues.push(`Grand total ${grandTotal} does not equal contributing-record total ${sourceTotal}`);
    if (model && model.sourceTotal != null && Number(model.sourceTotal) !== sourceTotal) {
      issues.push(`Stored source total ${model.sourceTotal} does not equal contributing-record total ${sourceTotal}`);
    }
    return {
      valid: issues.length === 0,
      issues,
      sourceTotal,
      boardTotal,
      groupTotal,
      grandTotal,
      checkedAt: new Date().toISOString(),
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
    if (options.legacyMatrix) {
      const rows = [];
      rows.push([model.projectName, "DB Reference", ...model.boards.map((board) => board.label), null, null]);
      rows.push([options.title || "Distribution Board Devices", null, ...model.boards.map(() => null), null, null]);
      rows.push(["Device", "Unit", ...model.boards.map(() => "Qty"), "Total", "WS"]);
      groups.forEach((group) => {
        rows.push([group.name, null, ...model.boards.map(() => null), null, null]);
        group.rows.forEach((row) => rows.push([row.label, "Nr", ...row.quantities.map((quantity) => quantity || null), row.total, null]));
      });
      rows.push([options.totalLabel || "Device Total", null, ...boardTotals, grandTotal, null]);
      return rows;
    }
    const devices = deviceColumns(model);
    const rows = [["Board Reference", ...devices.map((device) => deviceColumnHeader(device).replace(/\n/g, " | ")), "Board Total"]];
    model.boards.forEach((board, boardIndex) => {
      const quantities = devices.map((device) => Number(device.quantities[boardIndex]) || null);
      rows.push([board.label, ...quantities, quantities.reduce((sum, quantity) => sum + (Number(quantity) || 0), 0)]);
    });
    rows.push(["All Boards Total", ...devices.map((device) => device.total), devices.reduce((sum, device) => sum + (Number(device.total) || 0), 0)]);
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
    const rows = matrixRows(model, { ...options, legacyMatrix: true });
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
      cell.font = { name: "Montserrat", size: 9, bold: true, color: { argb: fill === XLSX_COLORS.black ? XLSX_COLORS.white : "FF000000" } };
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

  const XLSX_COLORS = {
    black: "FF171717",
    white: "FFFFFFFF",
    peach: "FFF7E0D1",
    grey: "FFE5E7EB",
    line: "FFA3A3A3",
    amber: "FFFFF2CC",
    red: "FFFCE8E6",
    green: "FFE2F0D9",
  };

  function borderStyle() {
    return {
      top: { style: "thin", color: { argb: XLSX_COLORS.line } },
      left: { style: "thin", color: { argb: XLSX_COLORS.line } },
      bottom: { style: "thin", color: { argb: XLSX_COLORS.line } },
      right: { style: "thin", color: { argb: XLSX_COLORS.line } },
    };
  }

  function styleHeaderRow(sheet, rowNumber, lastColumn, fill = XLSX_COLORS.peach) {
    const row = sheet.getRow(rowNumber);
    row.height = 34;
    const fontColor = fill === XLSX_COLORS.black ? XLSX_COLORS.white : 'FF000000';
    for (let column = 1; column <= lastColumn; column += 1) {
      const cell = row.getCell(column);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      cell.font = { name: "Montserrat", size: 9, bold: true, color: { argb: fontColor } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = borderStyle();
    }
  }

  function styleDataRange(sheet, firstRow, lastRow, lastColumn) {
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = 1; column <= lastColumn; column += 1) {
        const cell = sheet.getCell(row, column);
        cell.font = { name: "Montserrat", size: 9, color: { argb: "FF000000" } };
        cell.alignment = { vertical: "top", horizontal: column >= 7 ? "center" : "left", wrapText: true };
        cell.border = borderStyle();
      }
    }
  }

  function addTitleRows(sheet, model, title, lastColumn) {
    sheet.mergeCells(1, 1, 1, lastColumn);
    sheet.mergeCells(2, 1, 2, lastColumn);
    sheet.getCell(1, 1).value = model.projectName;
    sheet.getCell(2, 1).value = title;
    [1, 2].forEach((rowNumber) => {
      const row = sheet.getRow(rowNumber);
      row.height = rowNumber === 1 ? 34 : 28;
      const cell = sheet.getCell(rowNumber, 1);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XLSX_COLORS.black } };
      cell.font = { name: "Montserrat", size: rowNumber === 1 ? 14 : 11, bold: true, color: { argb: XLSX_COLORS.white } };
      cell.alignment = { vertical: "middle", horizontal: "left" };
    });
  }

  function deliverableValue(value) {
    const normalised = text(value);
    return !normalised || normalised === NOT_SPECIFIED || normalised === UNCLEAR || /^not applicable$/i.test(normalised) ? null : value;
  }

  function combinedBoardSections(model) {
    const main = new Map((model.boardSections || []).map((board) => [board.norm, board]));
    const associated = new Map((model.associated?.boardSections || []).map((board) => [board.norm, board]));
    return (model.boards || []).map((board) => {
      const protective = main.get(board.norm);
      const controls = associated.get(board.norm);
      const families = [...(protective?.families || []), ...(controls?.families || [])];
      return {
        ...board,
        families,
        total: (Number(protective?.total) || 0) + (Number(controls?.total) || 0),
        reviewCount: families.flatMap((family) => family.rows || []).filter((row) => row.reviewStatus !== 'Ready').length,
      };
    });
  }

  function deviceColumns(model) {
    return [
      ...(model.groups || []).flatMap((group) => group.rows.map((row) => ({ ...row, category: group.name }))),
      ...((model.associated?.groups || []).flatMap((group) => group.rows.map((row) => ({ ...row, category: group.name })))),
    ];
  }

  function deviceColumnHeader(row) {
    const fields = [
      row.deviceFamily,
      row.rating == null ? null : `${formatRating(row.rating)}A`,
      deliverableValue(row.pole),
      deliverableValue(row.curve) ? `${row.curve} curve` : null,
      deliverableValue(row.tripUnit) ? `Trip ${row.tripUnit}` : null,
      deliverableValue(row.breakingCapacity),
      deliverableValue(row.protectionStandard),
      row.rcdProtected === true ? rcdProtectionLabel(true, row.rcdSensitivity) : row.rcdProtected === false ? 'No RCD' : null,
      row.afdd === true ? 'AFDD' : row.afdd === false ? 'No AFDD' : null,
    ].filter(Boolean);
    return fields.join('\n');
  }

  function createBoardTakeOffWorksheet(workbook, model) {
    const lastColumn = 13;
    const sheet = workbook.addWorksheet('Board Take-Off', {
      views: [{ state: 'frozen', ySplit: 3, activeCell: 'A4' }],
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 },
      },
    });
    addTitleRows(sheet, model, 'Board-by-board device take-off', lastColumn);
    const headers = [
      'Circuit Description', 'Quantity', 'Current Rating (A)', 'Pole Configuration', 'Tripping Curve', 'Trip Unit',
      'Breaking Capacity', 'RCD Protection', 'AFDD Protection', 'Circuit / Way', 'Protection Standard', 'Source Pages', 'Review Status',
    ];
    headers.forEach((value, index) => { sheet.getCell(3, index + 1).value = value; });
    styleHeaderRow(sheet, 3, lastColumn);

    let rowNumber = 4;
    combinedBoardSections(model).filter((board) => board.families.length).forEach((board) => {
      sheet.mergeCells(rowNumber, 1, rowNumber, lastColumn);
      const boardCell = sheet.getCell(rowNumber, 1);
      boardCell.value = `${board.label} | ${board.total} device${board.total === 1 ? '' : 's'} | ${board.reviewCount} specification${board.reviewCount === 1 ? '' : 's'} to review`;
      boardCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLSX_COLORS.black } };
      boardCell.font = { name: 'Montserrat', size: 11, bold: true, color: { argb: XLSX_COLORS.white } };
      boardCell.alignment = { vertical: 'middle', horizontal: 'left' };
      sheet.getRow(rowNumber).height = 28;
      rowNumber += 1;
      board.families.forEach((family) => {
        sheet.mergeCells(rowNumber, 1, rowNumber, lastColumn);
        const familyCell = sheet.getCell(rowNumber, 1);
        familyCell.value = `${family.name} | ${family.total}`;
        familyCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLSX_COLORS.grey } };
        familyCell.font = { name: 'Montserrat', size: 9, bold: true, color: { argb: 'FF000000' } };
        familyCell.alignment = { vertical: 'middle', horizontal: 'left' };
        familyCell.border = borderStyle();
        sheet.getRow(rowNumber).height = 22;
        rowNumber += 1;
        family.rows.forEach((item) => {
          const values = [
            deliverableValue(item.descriptions.filter((value) => deliverableValue(value)).join('; ')),
            item.quantity,
            item.rating == null ? null : item.rating,
            deliverableValue(item.pole),
            deliverableValue(item.curve),
            deliverableValue(item.tripUnit),
            deliverableValue(item.breakingCapacity),
            deliverableValue(item.rcdLabel),
            deliverableValue(item.afddLabel),
            deliverableValue(item.circuitLocators.filter((value) => deliverableValue(value)).join('; ')),
            deliverableValue(item.protectionStandard),
            item.sourcePages.filter((value) => deliverableValue(value) && !/\bNot specified\b|\bUnclear\b/i.test(String(value))).join('; ') || null,
            item.reviewStatus,
          ];
          values.forEach((value, columnIndex) => { sheet.getCell(rowNumber, columnIndex + 1).value = value; });
          styleDataRange(sheet, rowNumber, rowNumber, lastColumn);
          sheet.getCell(rowNumber, 13).fill = {
            type: 'pattern', pattern: 'solid', fgColor: { argb: item.reviewStatus === 'Ready' ? XLSX_COLORS.green : XLSX_COLORS.red },
          };
          rowNumber += 1;
        });
      });
    });
    const widths = [36, 10, 14, 15, 14, 14, 16, 18, 17, 28, 20, 32, 17];
    widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.pageSetup.printArea = `A1:${columnName(lastColumn)}${Math.max(3, rowNumber - 1)}`;
    sheet.pageSetup.printTitlesRow = '1:3';
    return sheet;
  }

  function createTakeOffWorksheet(workbook, model) {
    const sheet = workbook.addWorksheet("Device Take-Off", {
      views: [{ state: "frozen", xSplit: 1, ySplit: 4, activeCell: "B5" }],
      pageSetup: {
        paperSize: 8,
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.2, right: 0.2, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
      },
    });
    const devices = deviceColumns(model);
    const firstDeviceColumn = 2;
    const totalColumn = firstDeviceColumn + devices.length;
    const lastColumn = totalColumn;
    addTitleRows(sheet, model, "Device specifications by board", lastColumn);

    sheet.getCell(3, 1).value = 'Board Reference';
    sheet.getCell(4, 1).value = 'Board Reference';
    devices.forEach((device, index) => {
      const column = firstDeviceColumn + index;
      sheet.getCell(3, column).value = device.category;
      sheet.getCell(4, column).value = deviceColumnHeader(device);
      sheet.getCell(4, column).note = [
        `Source pages: ${device.sourcePages.join('; ') || 'Open the report source window'}`,
        `Review status: ${device.reviewStatus}`,
      ].join('\n');
    });
    sheet.getCell(3, totalColumn).value = 'Board Total';
    sheet.getCell(4, totalColumn).value = 'Board Total';
    styleHeaderRow(sheet, 3, lastColumn, XLSX_COLORS.black);
    styleHeaderRow(sheet, 4, lastColumn);
    sheet.getRow(3).height = 24;
    sheet.getRow(4).height = 108;
    for (let column = 1; column <= lastColumn; column += 1) {
      sheet.getCell(4, column).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    }
    devices.forEach((device, index) => {
      if (device.reviewStatus === 'Ready') return;
      sheet.getCell(4, firstDeviceColumn + index).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLSX_COLORS.amber } };
    });

    model.boards.forEach((board, boardIndex) => {
      const rowNumber = 5 + boardIndex;
      sheet.getCell(rowNumber, 1).value = board.label;
      devices.forEach((device, deviceIndex) => {
        sheet.getCell(rowNumber, firstDeviceColumn + deviceIndex).value = Number(device.quantities[boardIndex]) || null;
      });
      const boardTotal = devices.reduce((sum, device) => sum + (Number(device.quantities[boardIndex]) || 0), 0);
      sheet.getCell(rowNumber, totalColumn).value = devices.length
        ? { formula: `SUM(B${rowNumber}:${columnName(totalColumn - 1)}${rowNumber})`, result: boardTotal }
        : boardTotal;
    });

    const totalRow = 5 + model.boards.length;
    sheet.getCell(totalRow, 1).value = 'All Boards Total';
    devices.forEach((device, index) => {
      const column = firstDeviceColumn + index;
      sheet.getCell(totalRow, column).value = model.boards.length
        ? { formula: `SUM(${columnName(column)}5:${columnName(column)}${totalRow - 1})`, result: device.total }
        : device.total;
    });
    const combinedGrandTotal = devices.reduce((sum, device) => sum + (Number(device.total) || 0), 0);
    sheet.getCell(totalRow, totalColumn).value = devices.length
      ? { formula: `SUM(B${totalRow}:${columnName(totalColumn - 1)}${totalRow})`, result: combinedGrandTotal }
      : combinedGrandTotal;

    styleDataRange(sheet, 5, totalRow, lastColumn);
    for (let column = 1; column <= lastColumn; column += 1) {
      const cell = sheet.getCell(totalRow, column);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLSX_COLORS.grey } };
      cell.font = { name: 'Montserrat', size: 9, bold: true, color: { argb: 'FF000000' } };
    }
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(5, totalRow - 1), column: lastColumn } };
    sheet.getColumn(1).width = 24;
    for (let column = firstDeviceColumn; column < totalColumn; column += 1) sheet.getColumn(column).width = 21;
    sheet.getColumn(totalColumn).width = 13;
    sheet.pageSetup.printArea = `A1:${columnName(lastColumn)}${totalRow}`;
    sheet.pageSetup.printTitlesRow = "1:4";
    return sheet;
  }

  function createFlatSheet(workbook, name, headers, rows, widths) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1, activeCell: "A2" }] });
    headers.forEach((value, index) => { sheet.getCell(1, index + 1).value = value; });
    rows.forEach((values, rowIndex) => {
      values.forEach((value, columnIndex) => { sheet.getCell(rowIndex + 2, columnIndex + 1).value = value; });
    });
    styleHeaderRow(sheet, 1, headers.length, XLSX_COLORS.black);
    for (let column = 1; column <= headers.length; column += 1) {
      sheet.getCell(1, column).font = { name: "Montserrat", size: 9, bold: true, color: { argb: XLSX_COLORS.white } };
    }
    if (rows.length) styleDataRange(sheet, 2, rows.length + 1, headers.length);
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: headers.length } };
    (widths || []).forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    return sheet;
  }

  function allReportGroups(model) {
    return [...(model.groups || []), ...((model.associated && model.associated.groups) || [])];
  }

  function detailRows(model) {
    return allReportGroups(model).flatMap((group) => group.rows.flatMap((reportRow) => reportRow.contributors.map((item) => [
      reportRow.key,
      reportRow.label,
      item.board,
      item.circuitReference,
      item.quantity,
      item.rating == null ? NOT_SPECIFIED : item.rating,
      item.purpose,
      item.description,
      item.pole,
      item.curve,
      item.breakingCapacity,
      item.protectionStandard,
      item.tripUnit,
      rcdProtectionLabel(item.rcdProtected, item.rcdSensitivity),
      item.rcdSensitivity == null ? NOT_SPECIFIED : item.rcdSensitivity,
      afddProtectionLabel(item.afdd),
      item.role,
      item.sourceDocument,
      item.page,
      item.bbox ? item.bbox.join(", ") : NOT_SPECIFIED,
      item.sourceText,
      item.confidence,
      item.extractionMethod,
      item.reviewStatus,
    ])));
  }

  function reviewRows(model) {
    const rows = [];
    allReportGroups(model).forEach((group) => group.rows.forEach((reportRow) => {
      reportRow.reviewReasons.forEach((reason) => {
        const field = /curve/i.test(reason) ? "Tripping Curve"
          : /breaking/i.test(reason) ? "Breaking Capacity"
            : /pole/i.test(reason) ? "Pole Configuration"
              : /rating/i.test(reason) ? "Current Rating"
                : "Source Record";
        const note = field === "Tripping Curve" ? QUALIFICATIONS.curve
          : field === "Breaking Capacity" ? QUALIFICATIONS.breakingCapacity
            : field === "Pole Configuration" ? QUALIFICATIONS.poles
              : field === "Current Rating" ? QUALIFICATIONS.rating
                : "Open the contributing source records, confirm the value, then approve or correct it.";
        rows.push(["Device group", reportRow.key, reportRow.label, field, reason, note, reportRow.sourcePages.join("; "), reportRow.confidence, "Open"]);
      });
    }));
    (model.duplicates || []).forEach((duplicate) => rows.push([
      "Duplicate prevention",
      duplicate.fingerprint,
      deviceLabel(duplicate.excluded),
      "Source record",
      "A repeated circuit or OCR region was excluded from totals.",
      "Confirm the retained source record is the clearest occurrence.",
      `${text(duplicate.excluded.fileId)} p${duplicate.excluded.page == null ? NOT_SPECIFIED : duplicate.excluded.page}`,
      Number(duplicate.excluded.conf || 0),
      "Excluded from count",
    ]));
    return rows;
  }

  function qualificationRows(model) {
    const rows = [];
    allReportGroups(model).forEach((group) => group.rows.forEach((reportRow) => {
      reportRow.notes.forEach((note) => rows.push([
        "Device group",
        reportRow.key,
        reportRow.label,
        note,
        reportRow.sourcePages.join("; "),
        reportRow.reviewStatus,
      ]));
    }));
    rows.push([
      "Report",
      "RECONCILIATION",
      "All countable devices",
      model.reconciliation.valid
        ? `Reconciled: ${model.reconciliation.sourceTotal} source devices = ${model.reconciliation.boardTotal} board-column devices = ${model.reconciliation.groupTotal} consolidated devices.`
        : `Incomplete: ${model.reconciliation.issues.join("; ")}`,
      "Generated report model",
      model.reconciliation.valid ? "Passed" : "Failed",
    ]);
    rows.push([
      "Report",
      "NO-SILENT-ASSUMPTIONS",
      "Technical properties",
      "Missing technical values are reported as Not specified or Unclear. No manufacturer default or tripping characteristic has been assumed.",
      "Extraction policy",
      "Applies to all rows",
    ]);
    return rows;
  }

  function auditRows(model) {
    const rows = [];
    allReportGroups(model).forEach((group) => group.rows.forEach((reportRow) => reportRow.contributors.forEach((item) => {
      const fields = [
        ["Device Family", item.deviceFamily],
        ["Current Rating", item.rating == null ? NOT_SPECIFIED : `${formatRating(item.rating)}A`],
        ["Pole Configuration", item.pole],
        ["Tripping Curve", item.curve],
        ["Breaking Capacity", item.breakingCapacity],
        ["Protection Standard", item.protectionStandard],
        ["Trip Unit", item.tripUnit],
        ["RCD Protection", rcdProtectionLabel(item.rcdProtected, item.rcdSensitivity)],
        ["RCD Sensitivity", item.rcdSensitivity == null ? NOT_SPECIFIED : `${formatRating(item.rcdSensitivity)}mA`],
        ["AFDD Protection", afddProtectionLabel(item.afdd)],
        ["Circuit Reference", item.circuitReference],
        ["Description", item.description],
        ["Phase", item.phase || NOT_SPECIFIED],
        ["Way", item.way == null ? NOT_SPECIFIED : item.way],
      ];
      fields.forEach(([field, normalised]) => {
        const key = field.toLowerCase().replace(/\s+/g, "");
        const evidence = item.fieldEvidence && (item.fieldEvidence[field] || item.fieldEvidence[key]) || {};
        const correction = item.corrections.find((candidate) => text(candidate && candidate.field).toLowerCase() === field.toLowerCase()) || {};
        const corrected = text(evidence.correction || correction.corrected || correction.normalized || correction.value);
        const reason = text(evidence.correctionReason || correction.reason);
        rows.push([
          `${item.sourceId}:${key}`,
          reportRow.key,
          item.sourceId,
          field,
          text(evidence.originalText || evidence.original || item.originalOcrText || item.sourceText),
          normalised,
          item.sourceDocument,
          item.page,
          Array.isArray(evidence.bbox) ? evidence.bbox.join(", ") : item.bbox ? item.bbox.join(", ") : NOT_SPECIFIED,
          text(evidence.method || item.extractionMethod),
          Number(evidence.confidence ?? item.confidence),
          corrected || "None",
          reason || "None",
          (normalised === NOT_SPECIFIED || normalised === UNCLEAR || corrected || item.reviewStatus !== "Approved") ? "Review required" : "Approved",
        ]);
      });
    })));
    return rows;
  }

  function createExcelWorkbook(model, ExcelJS) {
    if (!ExcelJS || typeof ExcelJS.Workbook !== "function") throw new Error("Excel export library is unavailable");
    const reconciliation = validateModel(model);
    if (!reconciliation.valid) throw new Error(`Report reconciliation failed: ${reconciliation.issues.join("; ")}`);
    model.reconciliation = reconciliation;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Estimation Tools";
    workbook.company = "Hager";
    workbook.created = model.generatedAt;
    workbook.modified = model.generatedAt;
    workbook.calcProperties.fullCalcOnLoad = true;

    createBoardTakeOffWorksheet(workbook, model);
    createTakeOffWorksheet(workbook, model);
    return workbook;
  }

  function csv(model) {
    const reconciliation = validateModel(model);
    if (!reconciliation.valid) throw new Error(`Report reconciliation failed: ${reconciliation.issues.join("; ")}`);
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
    deduplicateRows,
    deviceSpecification,
    deviceLabel,
    matrixRows,
    normaliseBreakingCapacity,
    normaliseCurve,
    normalisePole,
    safeFileName,
    validateModel,
  };
});
