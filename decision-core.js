(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EstimationDecisionCore = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const CONTRACT_VERSION = 1;
  const ROW_FIELDS = Object.freeze({
    boardNorm: "Board Reference",
    way: "Way",
    phase: "Phase",
    device: "Device Family",
    qty: "Quantity",
    rating: "Current Rating",
    curve: "Tripping Curve",
    poleConfiguration: "Pole Configuration",
    ka: "Breaking Capacity",
    protectionStandard: "Protection Standard",
    tripUnit: "Trip Unit",
    protectionCode: "Protection Code",
    rcdProtected: "RCD Protection",
    rcdArrangement: "RCD Arrangement",
    rcdType: "RCD Type",
    sens: "RCD Sensitivity",
    afdd: "AFDD Protection",
    earthFaultDevice: "Earth Fault Device",
    arcFlashDevice: "Arc Flash Device",
    circuitReference: "Circuit Reference",
    circuitConfig: "Circuit Configuration",
    serviceCode: "Service Code",
    discipline: "Discipline",
    cable: "Cable Details",
    spare: "Spare Way",
    space: "Fitted Blank",
    incomer: "Incomer",
    desc: "Description",
  });
  const BOARD_HEADER_FIELDS = Object.freeze({
    job_reference: "Job Reference",
    job_number: "Job Number",
    description: "Board Description",
    board_type_text: "Board Type / Size",
    board_rating_a: "Board Rating",
    voltage_v: "Voltage",
    purpose: "Purpose",
    serving: "Serving",
    location: "Location",
    fed_from_ref: "Supplied From",
    supplied_from_text: "Supplied From Text",
    supply_cable_details: "Supply Cable",
    supply_cpd_details: "Supply CPD",
    internal_isolator_details: "Internal Isolator",
    ways_total: "Ways Total",
    ways_sp: "SP Ways",
    ways_tp: "TP Ways",
    spare_capacity_pct: "Spare Capacity",
    incomer_class: "Incomer Class",
    incomer_rating_a: "Incomer Rating",
    incomer_poles: "Incomer Poles",
    supply_cpd_class: "Supply CPD Class",
    supply_cpd_rating_a: "Supply CPD Rating",
    supply_cpd_standard: "Supply CPD Standard",
    supply_cpd_trip_unit: "Supply CPD Trip Unit",
    internal_isolator_class: "Internal Isolator Class",
    internal_isolator_rating_a: "Internal Isolator Rating",
    board_model: "Board Model",
    fault_ka: "Fault Rating",
    metering: "Metering",
    phase_config: "Phase Configuration",
    phase_config_evidence: "Phase Configuration Evidence",
    phase_count: "Phase Count",
    board_family_reason: "Board Family Reason",
    continuation: "Continuation Page",
  });

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function sameValue(left, right) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  }

  function displayValue(value) {
    if (value == null || value === "") return "Not specified";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "object") return value.orig || value.descriptor || JSON.stringify(value);
    return String(value);
  }

  function canonicalRowSourceKey(row) {
    const source = row || {};
    const bbox = source.highlightBbox || source.bbox || source.sourceCell?.bbox || null;
    const geometry = Array.isArray(bbox) && bbox.length
      ? bbox.map((value) => Number(value).toFixed(2)).join(",")
      : "";
    const line = source.line == null ? "" : String(source.line);
    const anchor = geometry || line
      ? ""
      : String(source.srcText || source.originalOcrText || "").trim();
    return [source.fileId || "", source.page ?? "", geometry, line, anchor].join("|");
  }

  function eventId(now, random) {
    const stamp = String(now || Date.now()).replace(/\D/g, "");
    return `decision_${stamp}_${String(random == null ? Math.random() : random).replace(/\D/g, "").slice(0, 8)}`;
  }

  function ensureProject(project) {
    if (!project) return project;
    if (!Array.isArray(project.approvalLog)) project.approvalLog = [];
    if (!Array.isArray(project.correctionLog)) project.correctionLog = [];
    if (!project.contractVersions || typeof project.contractVersions !== "object") project.contractVersions = {};
    project.contractVersions.decisions = CONTRACT_VERSION;
    return project;
  }

  function appendEvent(project, event) {
    ensureProject(project);
    const complete = {
      id: event.id || eventId(event.createdAt),
      contractVersion: CONTRACT_VERSION,
      createdAt: event.createdAt || new Date().toISOString(),
      actor: event.actor || "Local user",
      ...clone(event),
    };
    project.correctionLog.unshift(complete);
    if (project.correctionLog.length > 10000) project.correctionLog.length = 10000;
    return complete;
  }

  function applyRowPatch(project, row, patch, options) {
    if (!row || !patch || typeof patch !== "object") return { changedFields: [], events: [] };
    const surface = options?.surface || "App";
    const reason = options?.reason || `User correction in ${surface}`;
    const transactionId = options?.transactionId || eventId(Date.now());
    const labels = { ...ROW_FIELDS, ...(options?.labels || {}) };
    const changedFields = [];
    const events = [];
    row.corrections = Array.isArray(row.corrections) ? row.corrections : [];
    row.fieldEvidence = row.fieldEvidence && typeof row.fieldEvidence === "object" ? row.fieldEvidence : {};

    Object.keys(patch).forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(labels, field)) return;
      const before = clone(row[field] ?? null);
      const after = clone(patch[field] ?? null);
      if (sameValue(before, after)) return;
      row[field] = after;
      const correction = {
        id: eventId(Date.now()),
        transactionId,
        field: labels[field],
        fieldKey: field,
        original: displayValue(before),
        originalValue: before,
        corrected: displayValue(after),
        correctedValue: after,
        reason,
        surface,
        createdAt: new Date().toISOString(),
      };
      row.corrections.push(correction);
      const existing = row.fieldEvidence[labels[field]] || row.fieldEvidence[field] || {};
      row.fieldEvidence[labels[field]] = {
        ...existing,
        originalText: existing.originalText || row.originalOcrText || row.srcText || "",
        normalisedValue: correction.corrected,
        correction: correction.corrected,
        correctionReason: reason,
        reviewStatus: "Approved",
        method: "User correction",
        correctionId: correction.id,
      };
      const event = appendEvent(project, {
        id: correction.id,
        transactionId,
        entityType: "row",
        entityId: row.id || null,
        boardNorm: field === "boardNorm" ? after : row.boardNorm || null,
        field,
        fieldLabel: labels[field],
        before,
        after,
        reason,
        surface,
        fileId: row.fileId || null,
        page: row.page ?? null,
        sourceText: String(row.srcText || "").slice(0, 500),
      });
      events.push(event);
      changedFields.push(labels[field]);
    });
    if (changedFields.length) row.edited = true;
    return { changedFields, events, transactionId };
  }

  function replaceReference(value, from, to) {
    return value === from ? to : value;
  }

  function renameBoardReferences(project, analysis, from, to) {
    if (!analysis || !from || !to || from === to) return;
    (analysis.rows || []).forEach((row) => { row.boardNorm = replaceReference(row.boardNorm, from, to); });
    (analysis.cables || []).forEach((cable) => { cable.boardNorm = replaceReference(cable.boardNorm, from, to); });
    (analysis.feeders || []).forEach((feed) => {
      feed.from = replaceReference(feed.from, from, to);
      feed.to = replaceReference(feed.to, from, to);
      feed.boardNorm = replaceReference(feed.boardNorm, from, to);
    });
    (analysis.discrepancies || []).forEach((item) => {
      ["boardNorm", "board", "from", "to", "scheduleBoard", "schematicBoard"].forEach((field) => {
        item[field] = replaceReference(item[field], from, to);
      });
    });
    Object.values(analysis.boards || {}).forEach((board) => {
      board.parent = replaceReference(board.parent, from, to);
      if (board.header) board.header.fed_from_ref = replaceReference(board.header.fed_from_ref, from, to);
    });
    [ensureProject(project).approvalLog, project.correctionLog].forEach((entries) => {
      entries.forEach((item) => {
        const current = item.canonicalBoardNorm || item.boardNorm;
        if (current === from) item.canonicalBoardNorm = to;
      });
    });
  }

  function applyBoardPatch(project, analysis, boardNorm, patch, options) {
    const board = analysis?.boards?.[boardNorm];
    if (!board) throw new Error("Board no longer exists");
    const surface = options?.surface || "Boards & Devices";
    const reason = options?.reason || `User correction in ${surface}`;
    const transactionId = options?.transactionId || eventId(Date.now());
    const nextNorm = patch.norm || boardNorm;
    if (nextNorm !== boardNorm && analysis.boards[nextNorm]) throw new Error("Another board already uses that reference");
    const events = [];
    const changedFields = [];
    board.corrections = Array.isArray(board.corrections) ? board.corrections : [];
    board.header = board.header && typeof board.header === "object" ? board.header : {};
    board.sourceNorm = board.sourceNorm || boardNorm;

    const change = (field, label, before, after, target, targetField) => {
      if (sameValue(before, after)) return;
      target[targetField] = clone(after);
      const correction = {
        id: eventId(Date.now()), transactionId, field: label, fieldKey: field,
        original: displayValue(before), originalValue: clone(before),
        corrected: displayValue(after), correctedValue: clone(after),
        reason, surface, createdAt: new Date().toISOString(),
      };
      board.corrections.push(correction);
      events.push(appendEvent(project, {
        id: correction.id, transactionId, entityType: "board", entityId: board.id || boardNorm,
        boardNorm: nextNorm, field, fieldLabel: label, before: clone(before), after: clone(after),
        reason, surface,
      }));
      changedFields.push(label);
    };

    change("orig", "Board Reference", board.orig || boardNorm, patch.orig || nextNorm, board, "orig");
    ["type", "family", "parent"].forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(patch, field)) return;
      const labels = { type: "Board Type", family: "Equipment Family", parent: "Supplied From" };
      change(field, labels[field], board[field] ?? null, patch[field] ?? null, board, field);
    });
    const headerPatch = patch.header || {};
    Object.keys(BOARD_HEADER_FIELDS).forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(headerPatch, field)) return;
      change(`header.${field}`, BOARD_HEADER_FIELDS[field], board.header[field] ?? null, headerPatch[field] ?? null, board.header, field);
    });

    if (nextNorm !== boardNorm) {
      renameBoardReferences(project, analysis, boardNorm, nextNorm);
      delete analysis.boards[boardNorm];
      board.norm = nextNorm;
      analysis.boards[nextNorm] = board;
    }
    if (changedFields.length) {
      board.manual = true;
      board.edited = true;
      board.reviewStatus = "Approved";
      if (changedFields.includes("Equipment Family")) {
        board.familyConfidence = 1;
        board.familyReview = false;
        board.familyReasons = [board.header.board_family_reason || reason];
      } else if (changedFields.includes("Board Family Reason")) {
        board.familyReasons = board.header.board_family_reason ? [board.header.board_family_reason] : [];
      }
    }
    return { board, boardNorm: nextNorm, previousBoardNorm: boardNorm, changedFields, events, transactionId };
  }

  return {
    CONTRACT_VERSION,
    ROW_FIELDS,
    BOARD_HEADER_FIELDS,
    ensureProject,
    appendEvent,
    applyRowPatch,
    applyBoardPatch,
    renameBoardReferences,
    displayValue,
    canonicalRowSourceKey,
  };
});
