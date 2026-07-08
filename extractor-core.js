(function attachEstimationExtractorCore(global) {
  'use strict';

  const DEFAULT_PROTECTION_LEGEND = {
    P1: { device: 'MCB', curve: 'C', source: 'legend' },
    P2: { device: 'RCBO', rcdType: 'A', sensitivityMa: 30, source: 'legend' },
    P3: { device: 'MCB+RCD', sensitivityMa: 30, source: 'legend' },
    P4: { device: 'Fuse', fuseType: 'HRC', source: 'legend' },
    P5: { device: 'MCB', userDefined: true, source: 'legend' },
    B: { device: null, fittedBlank: true, source: 'legend' },
  };

  function cloneLegend() {
    return Object.fromEntries(
      Object.entries(DEFAULT_PROTECTION_LEGEND).map(([key, value]) => [key, { ...value }]),
    );
  }

  function parseProtectionLegend(text) {
    const legend = cloneLegend();
    const source = String(text || '');
    const explicitCodes = new Set();
    for (const code of ['P1', 'P2', 'P3', 'P4', 'P5']) {
      if (new RegExp(`\\b${code}\\s*[-–:]`).test(source)) explicitCodes.add(code);
    }
    if (/\bP1\s*[-–:]\s*MCB\s+Curve\s+Type\s+C/i.test(source)) {
      legend.P1 = { device: 'MCB', curve: 'C', source: 'document_legend' };
    }
    if (/\bP2\s*[-–:]\s*RCBO/i.test(source)) {
      legend.P2 = {
        device: 'RCBO',
        rcdType: /Type\s+A/i.test(source) ? 'A' : null,
        sensitivityMa: /30\s*mA/i.test(source) ? 30 : null,
        source: 'document_legend',
      };
    }
    if (/\bP3\s*[-–:]\s*MCB\s*\/\s*Fuse/i.test(source)) {
      legend.P3 = {
        device: 'MCB+RCD',
        sensitivityMa: /30\s*mA/i.test(source) ? 30 : null,
        source: 'document_legend',
      };
    }
    if (/\bP4\s*[-–:]\s*HRC/i.test(source)) {
      legend.P4 = { device: 'Fuse', fuseType: 'HRC', source: 'document_legend' };
    }
    if (/\bP5\s*[-–:]\s*MCB/i.test(source)) {
      legend.P5 = { device: 'MCB', userDefined: true, source: 'document_legend' };
    }
    if (/\bB\s+Fitted\s+blank/i.test(source)) {
      legend.B = { device: null, fittedBlank: true, source: 'document_legend' };
    }
    return { legend, explicitCodes: [...explicitCodes] };
  }

  function normaliseInstallMethod(value) {
    return value ? value.replace(/\s+/g, '').replace(/,+/g, ',') : null;
  }

  function parseTrailingCable(text) {
    const value = String(text || '').trim();
    const match = value.match(/^(.*?)(?:\s+(\d+(?:\.\d+)?)\s+(T[1-6])\s+([\d\s,]+))$/i);
    if (!match) return { description: value, cable: null };
    return {
      description: match[1].trim(),
      cable: {
        size: Number(match[2]),
        typeCode: match[3].toUpperCase(),
        installMethod: normaliseInstallMethod(match[4]),
        orig: `${match[2]} mm² ${match[3].toUpperCase()}`,
      },
    };
  }

  function normaliseBoardReference(value) {
    return String(value || '').toUpperCase().replace(/[\s._/-]+/g, '');
  }

  // Words that can follow "DB" in prose without naming a board ("DB Schedule",
  // "DB Fed From", …). A candidate whose first token is one of these is prose.
  const BOARD_REF_STOPWORDS = new Set([
    'SCHEDULE', 'SCHEDULES', 'REFERENCE', 'REF', 'BOARD', 'BOARDS', 'FED', 'FROM',
    'TO', 'SERVING', 'SERVED', 'TYPE', 'RATING', 'SIZE', 'WAY', 'WAYS', 'NO',
    'NUMBER', 'DATA', 'INCOMER', 'LOCATION', 'NOTES', 'NOTE', 'LEGEND', 'CHART',
    'CHARTS', 'IDENTITY', 'AND', 'OR', 'THE', 'FOR', 'WITH', 'IS', 'ARE', 'MODEL',
  ]);

  function extractBoardReferences(text) {
    const source = String(text || '');
    // Ordered most-specific first; shorter matches fully contained inside an
    // already-found span are dropped (so "DB-00-SUBEXT" wins over "DB-00").
    const patterns = [
      // compound refs containing DB as an inner/terminal token: G1-GF-DB-LL
      { re: /\b[A-Z0-9]{1,6}(?:-[A-Z0-9]{1,6})*-DB(?:-[A-Z0-9]{1,6})+\b/gi },
      { re: /\bSMDB(?:[\s._/-]?\d+[A-Z]?)*\b/gi },
      { re: /\bMDB(?:[\s._/-]?\d+[A-Z]?)*\b/gi },
      { re: /\b(?:LDB|PDB|MCC|MCP|SB)(?:[\s._/-]?\d+[A-Z]?)+\b/gi },
      // DB + letter-bearing tokens: DB-MECH, DB-AV, DB/GF, DB-ESS-01, DB-00-SUBEXT
      { re: /\bDB\s?[.\-_/]\s?[A-Z0-9]{1,8}(?:[.\-_/][A-Z0-9]{1,8})*\b/gi, guard: true },
      { re: /\bDB\.?(?:[\s._/-]?\d+[A-Z]?)+(?:\s+[A-Z])?\b/gi },
      // panelboards / switchboards: PB01, MSB1
      { re: /\b(?:PB|MSB)[\s.\-_/]?\d+[A-Z]?\b/gi },
      { re: /\bmain\s+lv\s+(?:panel|switchboard)\b/gi },
      { re: /\bmain\s+switchboard\b/gi },
      // consumer-unit variants: "Consumer Unit (General Apartment)" → CU General Apartment
      { re: /\bconsumer\s+unit\s*\(([^)]{2,30})\)/gi, cu: true },
    ];
    // header-labelled refs catch names no generic pattern can (e.g. "Reference: 2A4")
    const headerRe = /(?<!(?:cable|drawing|document|project|job|schedule)\s)\b(?:board\s+)?(?:reference|identity)\s*[:\-]?\s+([A-Z0-9][A-Z0-9/._-]{1,14})/gi;
    const spans = [];
    for (const { re, guard, cu } of patterns) {
      re.lastIndex = 0;
      for (const match of source.matchAll(re)) {
        let original = match[0].trim();
        if (cu) original = 'CU ' + match[1].trim();
        if (guard) {
          const tokens = original.split(/[\s.\-_/]+/).slice(1);
          if (!tokens.length || BOARD_REF_STOPWORDS.has(tokens[0].toUpperCase())) continue;
        }
        spans.push({ original, start: match.index, end: match.index + match[0].length });
      }
    }
    headerRe.lastIndex = 0;
    for (const match of source.matchAll(headerRe)) {
      const token = match[1].replace(/[.,:]+$/, '');
      // require a digit or separator so prose ("Reference: Drawings") is skipped
      if (!/[\d/-]/.test(token) || BOARD_REF_STOPWORDS.has(token.toUpperCase())) continue;
      spans.push({ original: token, start: match.index, end: match.index + match[0].length });
    }
    // drop spans fully contained in a longer span (sub-matches of the same text)
    const kept = spans.filter((s) => !spans.some((o) => o !== s
      && o.start <= s.start && o.end >= s.end && (o.end - o.start) > (s.end - s.start)));
    const found = [];
    const seen = new Set();
    for (const s of kept) {
      const normalised = /main\s/i.test(s.original) ? 'MAINLVPANEL' : normaliseBoardReference(s.original);
      if (!normalised || seen.has(normalised)) continue;
      seen.add(normalised);
      found.push({ original: s.original, normalised });
    }
    return found;
  }

  function classifyPageText(text, pageIndex = 0, totalPages = 1) {
    const source = String(text || '');
    const lower = source.toLowerCase();
    const scores = {};
    const add = (type, score) => { scores[type] = (scores[type] || 0) + score; };
    if (/drawing register|drawing list|drawing index|dwg register/.test(lower)) add('register', 8);
    if (/\blegend\b/.test(lower) && /symbol|description|abbrev/.test(lower)) add('legend', 5);
    if (/lighting (?:layout|plan|drawing)/.test(lower)) add('lighting-plan', 5);
    if (/small.?power|power (?:layout|plan)/.test(lower)) add('power-plan', 5);
    if (/fire.?alarm (?:layout|plan|drawing)|fire detection layout/.test(lower)) add('fire-plan', 5);
    if (/containment|cable tray layout|trunking layout|basket layout/.test(lower)) add('containment-plan', 5);
    if (/single.?line|schematic|busbar|incoming supply|main switchboard/.test(lower)) add('sld', 4);
    if (/distribution board schedule|board schedule|db schedule/.test(lower)) add('db-schedule', 7);
    if (/main (?:panel|lv panel|switch\s?board).{0,30}schedule/.test(lower)) add('main-schedule', 7);
    if (/cable schedule/.test(lower)) add('cable-schedule', 7);
    if (/equipment schedule/.test(lower)) add('equipment-schedule', 7);
    if (/specification|shall be provided|shall comply|bs 7671|clause/.test(lower)) add('spec', 3);
    if (/general notes|electrical notes/.test(lower)) add('notes', 4);
    const protectionCodes = (source.match(/\bP[1-5]\b/g) || []).length;
    const phaseRows = (source.match(/\bL[123]\b/g) || []).length;
    if (protectionCodes >= 4 && phaseRows >= 6) add('db-schedule', 7);
    const boardCount = extractBoardReferences(source).length;
    if (boardCount >= 3 && /mccb|fuse|cable|connected from|connected to/i.test(source)) add('sld', 5);
    if (pageIndex === 0 && totalPages > 1 && /project|issued|revision/.test(lower) && !Object.keys(scores).length) add('cover', 3);
    let type = 'unknown';
    let best = 0;
    for (const [candidate, score] of Object.entries(scores)) {
      if (score > best) { type = candidate; best = score; }
    }
    return { type, confidence: type === 'unknown' ? 0.3 : Math.min(0.97, 0.5 + best * 0.06), scores };
  }

  function parseBamScheduleLine(line, context = {}) {
    const text = String(line || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;

    // BAM schedules use: [Way] Phase In [Ib] ProtectionCode Description CableCSA CableType InstallMethod.
    // Empty cells disappear in PDF text extraction, so Way is optional on L2/L3 continuation rows.
    const match = text.match(/^(?:(\d{1,3})\s+)?(L[123])\s+(?:(\d+(?:\.\d+)?)\s+)?(P[1-5]|B)\b\s*(.*)$/i);
    if (!match) return null;

    const phase = match[2].toUpperCase();
    const explicitWay = match[1] ? Number(match[1]) : null;
    const phaseOrder = { L1: 1, L2: 2, L3: 3 };
    const phaseReset = explicitWay === null
      && context.lastPhase
      && phaseOrder[phase] <= phaseOrder[context.lastPhase];
    const way = explicitWay !== null ? explicitWay : (phaseReset ? null : (context.lastWay ?? null));
    const rating = match[3] ? Number(match[3]) : null;
    const protectionCode = match[4].toUpperCase();
    const resolved = (context.protectionLegend || DEFAULT_PROTECTION_LEGEND)[protectionCode]
      || DEFAULT_PROTECTION_LEGEND[protectionCode]
      || {};
    const { description, cable } = parseTrailingCable(match[5]);
    const spare = /\bspare\b/i.test(description);
    const space = protectionCode === 'B' || Boolean(resolved.fittedBlank);
    const placeholder = /\b(TBC|TBD|GUESS|UNKNOWN)\b|\?\?/i.test(description);

    const row = {
      way,
      phase,
      rating,
      protectionCode,
      device: resolved.device || null,
      curve: resolved.curve || null,
      rcdType: resolved.rcdType || null,
      sens: resolved.sensitivityMa || null,
      poles: 1,
      ka: null,
      cable,
      desc: description,
      spare,
      space,
      incomer: false,
      qty: space ? 0 : 1,
      placeholder,
      requiresReview: placeholder || Boolean(resolved.userDefined) || !resolved.device,
      resolutionSource: resolved.source || 'unresolved',
      srcText: text,
      conf: placeholder ? 0.55 : (resolved.source === 'document_legend' ? 0.94 : 0.86),
    };
    context.pendingRows = context.pendingRows || [];
    if (explicitWay !== null) {
      for (const pending of context.pendingRows) pending.way = explicitWay;
      context.pendingRows.length = 0;
      context.lastWay = explicitWay;
    } else if (way === null) {
      row.deferredWay = true;
      context.pendingRows.push(row);
    }
    context.lastPhase = phase;
    return row;
  }

  function aggregateDevices(rows) {
    const totals = new Map();
    for (const row of rows || []) {
      if (!row || row.space || !row.device || row.qty === 0) continue;
      const key = [
        row.device,
        row.rating ?? '',
        row.curve || '',
        row.poles || '',
        row.sens ?? '',
        row.rcdType || '',
      ].join('|');
      if (!totals.has(key)) {
        totals.set(key, {
          device: row.device,
          rating: row.rating,
          curve: row.curve,
          poles: row.poles,
          sensitivityMa: row.sens,
          rcdType: row.rcdType,
          quantity: 0,
          evidence: [],
        });
      }
      const total = totals.get(key);
      total.quantity += row.qty || 1;
      total.evidence.push({ way: row.way, phase: row.phase, source: row.srcText });
    }
    return [...totals.values()];
  }

  function finalizeScheduleContext(context = {}) {
    const pending = context.pendingRows || [];
    if (!pending.length) return [];
    if (Number.isInteger(context.lastWay)) {
      const inferredWay = context.lastWay + 1;
      for (const row of pending) {
        row.way = inferredWay;
        row.deferredWay = false;
        row.inferredWay = true;
        row.requiresReview = true;
        row.conf = Math.min(row.conf ?? 0.65, 0.65);
      }
    } else {
      for (const row of pending) {
        row.requiresReview = true;
        row.conf = Math.min(row.conf ?? 0.45, 0.45);
      }
    }
    context.pendingRows = [];
    return pending;
  }

  function normaliseAssistedDevice(value) {
    const source = String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (!source) return null;
    if (/\bAFDD\b/.test(source) && /\bRCBO\b/.test(source)) return 'AFDD+RCBO';
    if (/\bRCBO\b/.test(source)) return 'RCBO';
    if (/\bMCCB\b/.test(source)) return 'MCCB';
    if (/\bMCB\b/.test(source)) return 'MCB';
    if (/\bRCD\b/.test(source)) return 'RCD';
    if (/\b(?:HRC\s+)?FUSE\b/.test(source)) return 'FUSE';
    return source.replace(/\s*\+\s*/g, '+');
  }

  function assistedSeedFromText(text, row = null) {
    const source = String(text || row?.srcText || '').replace(/\s+/g, ' ').trim();
    const device = normaliseAssistedDevice(row?.device || source.match(/\b(?:AFDD\s*\+\s*RCBO|RCBO|MCCB|MCB|RCD|HRC\s+FUSE|FUSE)\b/i)?.[0]);
    let rating = Number.isFinite(Number(row?.rating)) ? Number(row.rating) : null;
    if (rating === null && device) {
      const escaped = device.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('AFDD\\+RCBO', 'AFDD\\s*\\+\\s*RCBO');
      const before = source.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:A|AMP(?:S)?)?\\s+${escaped}\\b`, 'i'));
      const after = source.match(new RegExp(`${escaped}\\b[^\\n]{0,18}?(\\d+(?:\\.\\d+)?)\\s*(?:A|AMP(?:S)?)\\b`, 'i'));
      const generic = source.match(/\b(\d+(?:\.\d+)?)\s*(?:A|AMP(?:S)?)\b/i);
      const found = before || after || generic;
      if (found) rating = Number(found[1]);
    }
    if (!device || !Number.isFinite(rating)) return null;
    return { device, rating, label: `${rating}A ${device}`, source };
  }

  function matchAssistedRows(rows, seed, options = {}) {
    if (!seed) return { rows: [], quantity: 0 };
    const boardNorm = options.boardNorm || seed.boardNorm || null;
    const fileId = options.fileId || seed.fileId || null;
    const device = normaliseAssistedDevice(seed.device);
    const rating = Number(seed.rating);
    const matches = (rows || []).filter((row) => {
      if (!row || row.status === 'rejected' || row.space || !row.device) return false;
      if (boardNorm && row.boardNorm !== boardNorm) return false;
      if (fileId && row.fileId !== fileId) return false;
      return normaliseAssistedDevice(row.device) === device && Number(row.rating) === rating;
    });
    return {
      rows: matches,
      quantity: matches.reduce((sum, row) => sum + (Number(row.qty) || 1), 0),
    };
  }

  function ocrWordsToLines(words, renderedWidth, renderedHeight, pageWidth, pageHeight) {
    const sx = Number(pageWidth) / Math.max(1, Number(renderedWidth));
    const sy = Number(pageHeight) / Math.max(1, Number(renderedHeight));
    const clean = (words || []).map((word) => {
      const box = word?.bbox || word?.boundingBox || {};
      const x0 = Number(box.x0 ?? box.left);
      const y0 = Number(box.y0 ?? box.top);
      const x1 = Number(box.x1 ?? box.right);
      const y1 = Number(box.y1 ?? box.bottom);
      return { text: String(word?.text || '').trim(), x0, y0, x1, y1 };
    }).filter((word) => word.text && [word.x0, word.y0, word.x1, word.y1].every(Number.isFinite));
    clean.sort((a, b) => {
      const ay = (a.y0 + a.y1) / 2;
      const by = (b.y0 + b.y1) / 2;
      return Math.abs(ay - by) > Math.max(5, Math.min(a.y1 - a.y0, b.y1 - b.y0) * 0.6)
        ? ay - by
        : a.x0 - b.x0;
    });
    const lines = [];
    for (const word of clean) {
      const cy = (word.y0 + word.y1) / 2;
      const height = Math.max(1, word.y1 - word.y0);
      let line = lines.find((candidate) => Math.abs(candidate.cy - cy) <= Math.max(5, Math.min(candidate.height, height) * 0.65));
      if (!line) {
        line = { words: [], cy, height, x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 };
        lines.push(line);
      }
      line.words.push(word);
      line.x0 = Math.min(line.x0, word.x0); line.y0 = Math.min(line.y0, word.y0);
      line.x1 = Math.max(line.x1, word.x1); line.y1 = Math.max(line.y1, word.y1);
      line.cy = (line.y0 + line.y1) / 2; line.height = Math.max(1, line.y1 - line.y0);
    }
    return lines.sort((a, b) => a.y0 - b.y0).map((line) => {
      line.words.sort((a, b) => a.x0 - b.x0);
      return {
        text: line.words.map((word) => word.text).join(' '),
        bbox: [line.x0 * sx, line.y0 * sy, (line.x1 - line.x0) * sx, (line.y1 - line.y0) * sy],
        ocr: true,
      };
    });
  }

  /* ===== Workstream 0 §0.3 — reconciliation / completeness pass =====
   * Deterministic self-check of an analysis against the documents' own
   * evidence: board headers declare way counts ("18 WAY TP&N" ⇒ 18), pages
   * that look like schedules must yield rows, and every shortfall is
   * surfaced — never silently accepted. */
  const WAY_HEADER_PATTERNS = [
    /\b(\d{1,3})\s*[- ]?WAYS?\b/i,                                  // "18 WAY TP&N", "12-way"
    /\bWAYS?\s*[:=]\s*(\d{1,3})\b/i,                                // "Ways: 12"
    /\bN(?:o|umber)\.?\s*of\s*ways?\s*(?:\((?:SP|TP)\))?\s*[:=]?\s*(\d{1,3})/i,
  ];

  function expectedWaysFromText(text) {
    const source = String(text || '');
    for (const pattern of WAY_HEADER_PATTERNS) {
      const match = source.match(pattern);
      if (match) {
        const ways = Number(match[1]);
        if (ways >= 2 && ways <= 200) return { ways, evidence: match[0].trim() };
      }
    }
    return null;
  }

  function pageLooksTabular(text) {
    const lines = String(text || '').split(/\r?\n/);
    let hits = 0;
    for (const line of lines) {
      if (/^\s*\d{1,3}\s*[\/ ]\s*L[123]\b/i.test(line)) hits += 1;                 // "4/L1 …"
      else if (/^\s*(?:way|cct|ckt|circuit)\s*\d{1,3}\b/i.test(line)) hits += 1;   // "CCT 4 …"
    }
    return hits >= 4;
  }

  const COVERAGE_SCHEDULE_TYPES = new Set(['db-schedule', 'main-schedule', 'equipment-schedule']);

  /**
   * @param boards map norm → {norm, orig, pages:[{fileId,page}] }
   * @param rows   extracted rows (schedule kind) with boardNorm/way/page/fileId
   * @param pages  [{fileId, page, text, type}] — one entry per analysed page
   */
  function buildCoverage({ boards, rows, pages }) {
    const pageMap = new Map();
    for (const pg of pages || []) pageMap.set(`${pg.fileId}#${pg.page}`, pg);
    const scheduleRows = (rows || []).filter((r) => r && r.kind !== 'mention' && r.kind !== 'manual');

    const perBoard = [];
    for (const board of Object.values(boards || {})) {
      let expected = null;
      let evidence = null;
      for (const ref of board.pages || []) {
        const pg = pageMap.get(`${ref.fileId}#${ref.page}`);
        const found = pg && expectedWaysFromText(pg.text);
        if (found && (!expected || found.ways > expected)) {
          expected = found.ways;
          evidence = { fileId: ref.fileId, page: ref.page, text: found.evidence };
        }
      }
      const boardRows = scheduleRows.filter((r) => r.boardNorm === board.norm);
      const ways = new Set(boardRows.filter((r) => r.way != null).map((r) => r.way));
      const unaccounted = expected != null ? Math.max(0, expected - ways.size) : null;
      perBoard.push({
        norm: board.norm, orig: board.orig,
        expectedWays: expected, evidence,
        capturedWays: ways.size, rowsCaptured: boardRows.length,
        unaccountedWays: unaccounted,
      });
    }

    const zeroRowSchedulePages = [];
    for (const pg of pages || []) {
      if (!String(pg.text || '').trim()) continue;
      const scheduleish = COVERAGE_SCHEDULE_TYPES.has(pg.type)
        || pageLooksTabular(pg.text) || Boolean(expectedWaysFromText(pg.text));
      if (!scheduleish) continue;
      if (!scheduleRows.some((r) => r.fileId === pg.fileId && r.page === pg.page)) {
        zeroRowSchedulePages.push({ fileId: pg.fileId, page: pg.page, type: pg.type });
      }
    }

    const expectedTotal = perBoard.reduce((sum, b) => sum + (b.expectedWays || 0), 0);
    const capturedTotal = perBoard.reduce((sum, b) => sum + (b.expectedWays != null ? Math.min(b.capturedWays, b.expectedWays) : 0), 0);
    return {
      perBoard,
      zeroRowSchedulePages,
      summary: {
        boards: perBoard.length,
        boardsWithRows: perBoard.filter((b) => b.rowsCaptured > 0).length,
        expectedWays: expectedTotal,
        capturedWays: capturedTotal,
        pctComplete: expectedTotal ? Math.round((100 * capturedTotal) / expectedTotal) : null,
        unaccountedBoards: perBoard.filter((b) => (b.unaccountedWays || 0) > 0).length,
      },
    };
  }

  /* ===== Workstream 5.1 — three-type classification ===== */
  // The product taxonomy is exactly three classes; the legacy classifier emits
  // ~16 fine-grained types. Collapse them so the UI and pipeline speak in three.
  const THREE_TYPES = { schematic: 'Schematic', db_schedule: 'Distribution Board Schedule', specification: 'Specification' };
  const LEGACY_TO_THREE = {
    // schematics
    sld: 'schematic', schematic: 'schematic',
    // distribution board schedules (incl. main/cable/equipment/CU/switchboard/mccb variants)
    'db-schedule': 'db_schedule', 'main-schedule': 'db_schedule', 'cable-schedule': 'db_schedule',
    'equipment-schedule': 'db_schedule', cu: 'db_schedule', switchboard: 'db_schedule', mccb: 'db_schedule',
    // specifications
    spec: 'specification', specification: 'specification',
  };
  // Plans/legends/registers/notes/covers/unknown have no take-off value; the
  // three-type view treats them as "other" (kept out of extraction, still shown).
  function toThreeType(legacyType) {
    if (!legacyType) return 'other';
    const key = String(legacyType).toLowerCase();
    if (THREE_TYPES[key]) return key;                 // already a 3-type value
    return LEGACY_TO_THREE[key] || 'other';
  }

  global.EstimationExtractorCore = {
    expectedWaysFromText,
    pageLooksTabular,
    buildCoverage,
    THREE_TYPES,
    toThreeType,
    DEFAULT_PROTECTION_LEGEND,
    parseProtectionLegend,
    parseTrailingCable,
    normaliseBoardReference,
    extractBoardReferences,
    classifyPageText,
    parseBamScheduleLine,
    aggregateDevices,
    finalizeScheduleContext,
    normaliseAssistedDevice,
    assistedSeedFromText,
    matchAssistedRows,
    ocrWordsToLines,
  };
})(globalThis);
