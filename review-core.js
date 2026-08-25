(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EstimationReviewCore = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const CONTRACT_VERSION = 1;
  const boardKey = (row) => row?.boardNorm || "__none__";
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function emptySession() {
    return {
      contractVersion: CONTRACT_VERSION,
      active: false,
      currentRowId: null,
      initialCount: 0,
      moving: false,
      boardOrder: [],
      initialByBoard: {},
      rowOrderByBoard: {},
      startedAt: null,
      updatedAt: null,
    };
  }

  function startSession(orderedRows, now = new Date().toISOString()) {
    const rows = Array.isArray(orderedRows) ? orderedRows.filter(Boolean) : [];
    if (!rows.length) return emptySession();
    const session = emptySession();
    session.active = true;
    session.currentRowId = rows[0].id;
    session.initialCount = rows.length;
    session.startedAt = now;
    session.updatedAt = now;
    rows.forEach((row) => {
      const key = boardKey(row);
      if (!session.boardOrder.includes(key)) session.boardOrder.push(key);
      session.initialByBoard[key] = (session.initialByBoard[key] || 0) + 1;
      (session.rowOrderByBoard[key] = session.rowOrderByBoard[key] || []).push(row.id);
    });
    return session;
  }

  function restoreSession(saved, orderedPendingRows, now = new Date().toISOString()) {
    const rows = Array.isArray(orderedPendingRows) ? orderedPendingRows.filter(Boolean) : [];
    if (!saved?.active || !rows.length) return emptySession();
    const fallback = startSession(rows, saved.startedAt || now);
    const pendingIds = new Set(rows.map((row) => row.id));
    const session = {
      ...fallback,
      ...clone(saved),
      contractVersion: CONTRACT_VERSION,
      active: true,
      moving: false,
      currentRowId: pendingIds.has(saved.currentRowId) ? saved.currentRowId : rows[0].id,
      updatedAt: now,
    };
    const seenBoards = new Set(session.boardOrder || []);
    rows.forEach((row) => {
      const key = boardKey(row);
      if (!seenBoards.has(key)) { session.boardOrder.push(key); seenBoards.add(key); }
      if (!session.initialByBoard[key]) session.initialByBoard[key] = rows.filter((item) => boardKey(item) === key).length;
      if (!Array.isArray(session.rowOrderByBoard[key])) session.rowOrderByBoard[key] = rows.filter((item) => boardKey(item) === key).map((item) => item.id);
    });
    return session;
  }

  function nextSession(current, orderedPendingRows, completedRow, now = new Date().toISOString()) {
    const rows = Array.isArray(orderedPendingRows) ? orderedPendingRows.filter(Boolean) : [];
    if (!current?.active || !rows.length) return emptySession();
    const previousBoard = boardKey(completedRow);
    const next = rows.find((row) => boardKey(row) === previousBoard) || rows[0];
    return { ...clone(current), active: true, moving: false, currentRowId: next.id, updatedAt: now };
  }

  function renameBoard(session, from, to) {
    if (!session || !from || !to || from === to) return session;
    const next = clone(session);
    next.boardOrder = (next.boardOrder || []).map((key) => key === from ? to : key);
    if (Object.prototype.hasOwnProperty.call(next.initialByBoard || {}, from)) {
      next.initialByBoard[to] = next.initialByBoard[from];
      delete next.initialByBoard[from];
    }
    if (Object.prototype.hasOwnProperty.call(next.rowOrderByBoard || {}, from)) {
      next.rowOrderByBoard[to] = next.rowOrderByBoard[from];
      delete next.rowOrderByBoard[from];
    }
    next.updatedAt = new Date().toISOString();
    return next;
  }

  function serialise(session) {
    const source = session?.active ? session : emptySession();
    return { ...clone(source), contractVersion: CONTRACT_VERSION, moving: false };
  }

  return { CONTRACT_VERSION, emptySession, startSession, restoreSession, nextSession, renameBoard, serialise };
});
