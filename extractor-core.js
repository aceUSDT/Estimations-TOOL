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

  function canonicalBoardReference(value) {
    const original = String(value || '').trim();
    let display = original.toUpperCase()
      .replace(/\s*[._/\\-]\s*/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    let splitSection = null;
    const split = display.match(/^(DB(?:-[A-Z0-9]+)+)-(LP|L|P)$/i);
    if (split && /(?:^|-)\d{1,3}$/.test(split[1])) {
      display = split[1];
      splitSection = split[2].toUpperCase();
    }
    return {
      original,
      display: display || original,
      normalised: normaliseBoardReference(display || original),
      splitSection,
    };
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
    const codedRows = (source.match(/(?:^|\n)\s*(?:\d{1,3}\s+)?(?:L[123]\s+)?\d+(?:\.\d+)?\s+[JKLMN]\s+[BCD]\b[^\n]*\b(?:Ri|Ra)\s+[LP]\b/gim) || []).length;
    if (codedRows >= 2 && phaseRows >= 3) add('db-schedule', 9);
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

  const TBA_PROTECTION_LEGEND = {
    J: { device: 'MCCB' },
    K: { device: 'MCB' },
    L: { device: 'Fuse' },
    M: { device: 'RCBO' },
    N: { device: 'AFDD+RCBO', afdd: true },
  };

  const ASSOCIATED_EQUIPMENT_DEFS = [
    { device: 'Contactor', re: /\bcontactors?\b/i },
    { device: 'Time clock', re: /\b(?:time\s*clock|timeclock)\b/i },
    { device: 'Photocell', re: /\b(?:photo\s*cell|photocell)\b/i },
    { device: 'Relay', re: /\brelays?\b/i },
    { device: 'Timer', re: /\btimers?\b/i },
    { device: 'Motor starter', re: /\b(?:motor\s+)?starters?\b/i },
    { device: 'Overload', re: /\boverloads?\b/i },
    { device: 'Transformer', re: /\btransformers?\b/i },
    { device: 'DALI controller', re: /\bDALI\s+(?:headend|controller|control\s+unit)\b/i },
    { device: 'Lighting controller', re: /\blighting\s+(?:controller|control\s+(?:module|unit))\b/i },
    { device: 'Key switch', re: /\bkey\s+switch(?:es)?\b/i },
  ];

  function extractAssociatedEquipment(description) {
    const source = String(description || '');
    const equipment = [];
    for (const definition of ASSOCIATED_EQUIPMENT_DEFS) {
      const match = source.match(definition.re);
      if (!match) continue;
      const before = source.slice(Math.max(0, match.index - 12), match.index);
      const quantity = Number(before.match(/(\d{1,3})\s*(?:x|×)\s*$/i)?.[1]) || 1;
      equipment.push({ device: definition.device, qty: quantity });
    }
    return equipment;
  }

  function cleanTbaDescription(value) {
    const source = String(value || '').replace(/\s+/g, ' ').trim();
    const cablePattern = /(?:^|\s)([A-I])\s+(\d+)\s+(\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?)\s+(\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?)\s+([WXYZ])\s+([NY])\s+(N\/A|[A-Z])\s+([NY])(?=\s|$)/ig;
    let cableMatch = null;
    for (const match of source.matchAll(cablePattern)) cableMatch = match;
    if (!cableMatch) return { description: source, cable: null };
    const sizeValue = cableMatch[3].replace(/\s+/g, '');
    const cpcValue = cableMatch[4].replace(/\s+/g, '');
    const description = `${source.slice(0, cableMatch.index)} ${source.slice(cableMatch.index + cableMatch[0].length)}`
      .replace(/\s+/g, ' ')
      .trim();
    return {
      description,
      cable: {
        typeCode: cableMatch[1].toUpperCase(),
        cores: Number(cableMatch[2]),
        size: /^\d+(?:\.\d+)?$/.test(sizeValue) ? Number(sizeValue) : sizeValue,
        cpc: /^\d+(?:\.\d+)?$/.test(cpcValue) ? Number(cpcValue) : cpcValue,
        cpcType: cableMatch[5].toUpperCase(),
        orig: `${cableMatch[2]}C ${sizeValue}mm2`,
      },
    };
  }

  function parseTbaProtectionLine(line) {
    const text = String(line || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/^(?:(\d{1,3})\s+)?(L[123])\s+(\d+(?:\.\d+)?)\s+([JKLMN])(?:\s+([BCD]))?\s+(.*?)\s+(Ri|Ra)\s+([LP])(?:\s+(.*))?$/i);
    if (!match) return null;
    const protectionCode = match[4].toUpperCase();
    const resolved = TBA_PROTECTION_LEGEND[protectionCode];
    if (!resolved) return null;
    const middleNumbers = (match[6].match(/\d+(?:\.\d+)?/g) || []).map(Number);
    const ka = middleNumbers.length ? middleNumbers[middleNumbers.length - 1] : null;
    const sensitivity = middleNumbers.length > 1 ? middleNumbers[0] : null;
    const cleaned = cleanTbaDescription(match[9]);
    const associatedDevices = extractAssociatedEquipment(cleaned.description);
    return {
      way: match[1] ? Number(match[1]) : null,
      phase: match[2].toUpperCase(),
      rating: Number(match[3]),
      protectionCode,
      device: resolved.device,
      curve: match[5] ? match[5].toUpperCase() : null,
      sens: sensitivity,
      poles: 1,
      ka,
      circuitConfig: match[7].toLowerCase() === 'ri' ? 'ring' : 'radial',
      serviceCode: match[8].toUpperCase(),
      discipline: match[8].toUpperCase() === 'L' ? 'Lighting' : '',
      cable: cleaned.cable,
      desc: cleaned.description,
      associatedDevices,
      afdd: Boolean(resolved.afdd),
      spare: false,
      space: false,
      incomer: false,
      qty: 1,
      resolutionSource: 'document_legend',
      srcText: text,
      conf: 0.98,
    };
  }

  function parseTbaSchedulePage(lines, context = {}) {
    const sourceLines = (lines || []).map((line, index) => ({
      index,
      text: String(line && line.text != null ? line.text : line || '').replace(/\s+/g, ' ').trim(),
    }));
    const consumed = new Set();
    const reconstructed = [];
    let detachedCount = 0;

    for (let index = 0; index < sourceLines.length; index += 1) {
      if (consumed.has(index)) continue;
      const source = sourceLines[index];
      const detached = source.text.match(/^(?:(\d{1,3})\s+)?(\d+(?:\.\d+)?)\s+([JKLMN])\b(.*)$/i);
      if (detached && /\b(?:Ri|Ra)\s+[LP]\b/i.test(source.text)) {
        const embedded = detached[4].match(/\b(L[123])\b/i);
        if (embedded) {
          const phase = embedded[1].toUpperCase();
          const remainder = `${detached[4].slice(0, embedded.index)} ${detached[4].slice(embedded.index + embedded[0].length)}`.trim();
          reconstructed.push({
            index: source.index,
            text: `${detached[1] ? `${detached[1]} ` : ''}${phase} ${detached[2]} ${detached[3]} ${remainder}`,
          });
          detachedCount += 1;
          continue;
        }
        let joined = false;
        for (let lookahead = index + 1; lookahead <= Math.min(index + 2, sourceLines.length - 1); lookahead += 1) {
          if (consumed.has(lookahead)) continue;
          const phaseOnly = sourceLines[lookahead].text.match(/^(?:(\d{1,3})\s+)?(L[123])(?:\s+(.*))?$/i);
          if (!phaseOnly || /^\d+(?:\.\d+)?\s+[JKLMN]\b/i.test(phaseOnly[3] || '')) continue;
          const way = detached[1] || phaseOnly[1];
          reconstructed.push({
            index: source.index,
            text: `${way ? `${way} ` : ''}${phaseOnly[2].toUpperCase()} ${detached[2]} ${detached[3]} ${detached[4]} ${phaseOnly[3] || ''}`,
          });
          consumed.add(lookahead);
          detachedCount += 1;
          joined = true;
          break;
        }
        if (joined) continue;
      }
      reconstructed.push(source);
    }

    const slots = [];
    for (const source of reconstructed) {
      const phaseLine = source.text.match(/^(?:(\d{1,3})\s+)?(L[123])(?:\s+(.*))?$/i);
      if (!phaseLine) continue;
      const payload = String(phaseLine[3] || '').trim();
      const row = parseTbaProtectionLine(source.text);
      slots.push({
        line: source.index,
        explicitWay: phaseLine[1] ? Number(phaseLine[1]) : null,
        phase: phaseLine[2].toUpperCase(),
        payload,
        row,
        spare: /\bsp\s*;?\s*are\b/i.test(payload),
        blank: !payload,
      });
    }

    const rows = [];
    let group = [];
    const finalizeGroup = () => {
      if (!group.length) return;
      const explicit = group.find((slot) => Number.isInteger(slot.explicitWay));
      const way = explicit ? explicit.explicitWay
        : (Number.isInteger(context.lastTbaWay) ? context.lastTbaWay + 1 : null);
      if (Number.isInteger(way)) context.lastTbaWay = way;
      const deviceSlots = group.filter((slot) => slot.row);
      const phases = new Set(group.map((slot) => slot.phase));
      const isThreePole = deviceSlots.length === 1
        && phases.size === 3
        && group.filter((slot) => !slot.row).every((slot) => slot.blank && !slot.spare);
      for (const slot of deviceSlots) {
        rows.push({
          ...slot.row,
          way,
          phase: isThreePole ? '3PH' : slot.phase,
          poles: isThreePole ? 3 : 1,
          line: slot.line,
        });
      }
      if (!deviceSlots.length && Number.isInteger(way)) {
        const isSpare = group.some((slot) => slot.spare);
        const slot = group.find((candidate) => candidate.spare) || group[0];
        rows.push({
          way,
          phase: null,
          rating: null,
          protectionCode: null,
          device: null,
          poles: 1,
          desc: isSpare ? 'Spare' : 'Space',
          spare: isSpare,
          space: !isSpare,
          incomer: false,
          qty: 0,
          srcText: slot.payload || (isSpare ? 'Spare' : 'Blank way'),
          conf: 0.98,
          line: slot.line,
        });
      }
      group = [];
    };

    for (const slot of slots) {
      if (group.length && (slot.phase === 'L1'
        || (Number.isInteger(slot.explicitWay) && group.some((candidate) => Number.isInteger(candidate.explicitWay))))) {
        finalizeGroup();
      }
      group.push(slot);
      if (slot.phase === 'L3') finalizeGroup();
    }
    finalizeGroup();

    const codedCount = rows.filter((row) => row.device).length;
    return { matched: codedCount > 0, rows, codedCount, detachedCount };
  }

  function dialectSpareRow(text, way, phase = null) {
    return {
      way,
      phase,
      rating: null,
      device: null,
      poles: 1,
      desc: 'Spare',
      spare: true,
      space: false,
      incomer: false,
      qty: 0,
      srcText: text,
      conf: 0.96,
      resolutionSource: 'schedule_columns',
    };
  }

  function dialectDevice({ rcdMa = null, afdd = false } = {}) {
    if (afdd) return 'AFDD+RCBO';
    return Number(rcdMa) > 0 ? 'RCBO' : 'MCB';
  }

  function parseKnownScheduleLine(line) {
    const text = String(line || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;

    const slash = text.match(/^(\d{1,3})\s*\/\s*(L[123])\s+(.+)$/i);
    if (slash) {
      const way = Number(slash[1]);
      const phase = slash[2].toUpperCase();
      const body = slash[3].trim();
      if (/^spare\b|\bspare$/i.test(body)) return dialectSpareRow(text, way, phase);

      const syntegral = body.match(/^(\d+(?:\.\d+)?)\s+([BCD])\s+(\d+(?:\.\d+)?|-)\s+(YES|NO)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?|SWA)\s+(RAD|RING)\s+(.+)$/i);
      if (syntegral) {
        const rcdMa = syntegral[3] === '-' ? null : Number(syntegral[3]);
        const afdd = syntegral[4].toUpperCase() === 'YES';
        const description = syntegral[9].trim();
        return {
          way,
          phase,
          rating: Number(syntegral[1]),
          device: dialectDevice({ rcdMa, afdd }),
          curve: syntegral[2].toUpperCase(),
          sens: rcdMa,
          afdd,
          poles: 1,
          circuitConfig: syntegral[8].toUpperCase() === 'RING' ? 'ring' : 'radial',
          cable: {
            typeCode: syntegral[5],
            size: Number(syntegral[6]),
            cpc: /^\d/.test(syntegral[7]) ? Number(syntegral[7]) : syntegral[7].toUpperCase(),
            orig: `${syntegral[6]}mm2 type ${syntegral[5]}`,
          },
          desc: description,
          associatedDevices: extractAssociatedEquipment(description),
          spare: false,
          space: false,
          incomer: false,
          qty: 1,
          srcText: text,
          conf: 0.94,
          resolutionSource: 'schedule_columns',
        };
      }

      const heavacomp = body.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?|SWA)\s+(.+?)\s+(Fixed power|Lighting)\s+(.+)$/i);
      if (heavacomp) {
        const service = heavacomp[5].toLowerCase();
        const description = `${heavacomp[5]} ${heavacomp[6]}`.trim();
        return {
          way,
          phase,
          rating: Number(heavacomp[1]),
          device: service === 'lighting' ? 'MCB' : 'RCBO',
          curve: null,
          sens: service === 'lighting' ? null : 30,
          poles: 1,
          serviceCode: service === 'lighting' ? 'L' : 'P',
          discipline: service === 'lighting' ? 'Lighting' : '',
          cable: {
            size: Number(heavacomp[2]),
            cpc: /^\d/.test(heavacomp[3]) ? Number(heavacomp[3]) : heavacomp[3].toUpperCase(),
            construction: heavacomp[4],
            orig: `${heavacomp[2]}mm2 ${heavacomp[4]}`,
          },
          desc: description,
          associatedDevices: extractAssociatedEquipment(description),
          spare: false,
          space: false,
          incomer: false,
          qty: 1,
          srcText: text,
          conf: 0.9,
          resolutionSource: 'schedule_columns',
        };
      }
    }

    const bes = text.match(/^(\d{1,3})\s+(L[123])\s+(.+?)\s+(RAD|RING)\s+(\d+(?:\.\d+)?)\s+([BCD])\s+(\d+(?:\.\d+)?|-)\s+(YES|NO)$/i);
    if (bes) {
      const rcdMa = bes[7] === '-' ? null : Number(bes[7]);
      const afdd = bes[8].toUpperCase() === 'YES';
      const description = bes[3].trim();
      return {
        way: Number(bes[1]),
        phase: bes[2].toUpperCase(),
        rating: Number(bes[5]),
        device: dialectDevice({ rcdMa, afdd }),
        curve: bes[6].toUpperCase(),
        sens: rcdMa,
        afdd,
        poles: 1,
        circuitConfig: bes[4].toUpperCase() === 'RING' ? 'ring' : 'radial',
        desc: description,
        associatedDevices: extractAssociatedEquipment(description),
        spare: false,
        space: false,
        incomer: false,
        qty: 1,
        srcText: text,
        conf: 0.93,
        resolutionSource: 'schedule_columns',
      };
    }

    const amtechSpare = text.match(/^(\d{1,3})\s+Spare(?:\s+0)?$/i);
    if (amtechSpare) return dialectSpareRow(text, Number(amtechSpare[1]));
    const amtech = text.match(/^(\d{1,3})\s+(.+?)\s+(\d+(?:\.\d+)?)\s+([BCD])\s+(\d+(?:\.\d+)?|-)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\d+(?:\.\d+)?)$/i);
    if (amtech) {
      const rcdMa = amtech[5] === '-' ? null : Number(amtech[5]);
      const description = amtech[2].trim();
      return {
        way: Number(amtech[1]),
        phase: null,
        rating: Number(amtech[3]),
        device: dialectDevice({ rcdMa }),
        curve: amtech[4].toUpperCase(),
        sens: rcdMa,
        poles: 1,
        discipline: /\blighting\b/i.test(description) ? 'Lighting' : '',
        cable: {
          size: Number(amtech[6]),
          cores: Number(amtech[7]),
          cpc: Number(amtech[8]),
          orig: `${amtech[7]}C ${amtech[6]}mm2`,
        },
        desc: description,
        associatedDevices: extractAssociatedEquipment(description),
        spare: false,
        space: false,
        incomer: false,
        qty: 1,
        srcText: text,
        conf: 0.91,
        resolutionSource: 'schedule_columns',
      };
    }
    return null;
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

  function assessPageText(lines, options = {}) {
    const records = (lines || []).map((line) => typeof line === 'string' ? { text: line } : (line || {}));
    const source = records.map((line) => String(line.text || '')).join('\n').trim();
    if (!source) {
      return {
        route: 'ocr', reliable: false, score: 0, lineCount: 0, characterCount: 0,
        reasons: ['No embedded text was found'],
      };
    }
    const characters = Array.from(source);
    const printable = characters.filter((character) => {
      const code = character.codePointAt(0);
      return character === '\n' || character === '\t' || (code >= 32 && code !== 0xfffd);
    }).length;
    const replacementCount = (source.match(/\uFFFD|�/g) || []).length;
    const printableRatio = printable / Math.max(1, characters.length);
    const alphanumericRatio = (source.match(/[A-Za-z0-9]/g) || []).length / Math.max(1, characters.length);
    const tokens = source.match(/[A-Za-z0-9][A-Za-z0-9+&./-]*/g) || [];
    const electricalSignals = (source.match(/\b(?:DB|BOARD|WAY|CIRCUIT|L[123]|MCB|MCCB|RCBO|RCD|AFDD|SPD|\d+(?:\.\d+)?\s*(?:A|MA|KA)|SPN|DPN|TPN)\b/gi) || []).length;
    const bboxes = records.map((line) => line.bbox).filter((bbox) => Array.isArray(bbox) && bbox.length >= 4 && bbox.every(Number.isFinite));
    let orderingErrors = 0;
    for (let index = 1; index < bboxes.length; index += 1) {
      const priorY = Number(bboxes[index - 1][1]);
      const nextY = Number(bboxes[index][1]);
      if (nextY + Math.max(4, Number(bboxes[index][3]) || 0) < priorY) orderingErrors += 1;
    }
    const orderingErrorRatio = orderingErrors / Math.max(1, bboxes.length - 1);
    const orderingUnreliable = orderingErrors > 0 && orderingErrorRatio > 0.12;
    const expectedType = String(options.expectedType || '').toLowerCase();
    const expectsDenseTable = /schedule|table/.test(expectedType);
    let score = 0.15
      + Math.min(0.25, characters.length / 1200)
      + Math.min(0.12, records.length / 30)
      + printableRatio * 0.18
      + Math.min(0.1, tokens.length / 120)
      + Math.min(0.12, electricalSignals / 30);
    if (printableRatio > 0.96 && alphanumericRatio > 0.45) score += 0.18;
    score -= Math.min(0.45, replacementCount / Math.max(1, characters.length) * 8);
    score -= Math.min(0.35, orderingErrorRatio * 1.5);
    if (expectsDenseTable && (characters.length < 80 || records.length < 3)) score -= 0.35;
    if (tokens.length && tokens.filter((token) => token.length === 1).length / tokens.length > 0.55) score -= 0.2;
    score = Math.max(0, Math.min(1, score));
    const reasons = [];
    if (replacementCount) reasons.push('The text layer contains corrupt replacement characters');
    if (printableRatio < 0.9) reasons.push('The text layer contains too many non-printable characters');
    if (orderingUnreliable) reasons.push('The text layer is not in a reliable reading order');
    else if (orderingErrors) reasons.push('Localized reading-order anomalies were normalized');
    if (expectsDenseTable && (characters.length < 80 || records.length < 3)) reasons.push('The schedule text layer appears incomplete');
    const reliable = score >= 0.62 && printableRatio >= 0.9 && replacementCount === 0 && !orderingUnreliable;
    if (!reliable && !reasons.length) reasons.push('Embedded-text quality is below the acceptance threshold');
    return {
      route: reliable ? 'embedded_text' : 'ocr',
      reliable,
      score,
      lineCount: records.length,
      characterCount: characters.length,
      printableRatio,
      alphanumericRatio,
      electricalSignals,
      orderingErrors,
      orderingErrorRatio,
      orderingUnreliable,
      reasons,
    };
  }

  function buildOcrCandidatePlan(metrics = {}) {
    const candidates = [];
    const seen = new Set();
    const add = (candidate) => {
      const value = {
        id: candidate.id,
        rotation: Number(candidate.rotation) || 0,
        deskew: Number(candidate.deskew) || 0,
        scale: Number(candidate.scale) || 2.25,
        grayscale: candidate.grayscale !== false,
        contrast: Number(candidate.contrast) || 1,
        threshold: candidate.threshold || null,
        denoise: Boolean(candidate.denoise),
        sharpen: Boolean(candidate.sharpen),
        backgroundCorrection: Boolean(candidate.backgroundCorrection),
      };
      const key = JSON.stringify(value);
      if (!seen.has(key)) { seen.add(key); candidates.push(value); }
    };
    const orientation = [90, 180, 270].includes(Number(metrics.orientation)) ? Number(metrics.orientation) : 0;
    const textHeight = Number(metrics.estimatedTextHeight) || 12;
    const lowResolution = textHeight < 9 || Math.min(Number(metrics.width) || 2000, Number(metrics.height) || 2000) < 800;
    const scale = lowResolution ? 3 : 2.25;
    add({ id: 'base', rotation: 0, scale, grayscale: true, contrast: 1.08 });
    add({ id: 'enhanced', rotation: orientation, scale, grayscale: true, contrast: 1.35, sharpen: true });
    if (orientation) add({ id: `rotate-${orientation}`, rotation: orientation, scale, grayscale: true, contrast: 1.2, sharpen: true });
    if (Math.abs(Number(metrics.skewAngle) || 0) >= 0.35) {
      add({ id: 'deskew', rotation: orientation, deskew: -Number(metrics.skewAngle), scale, grayscale: true, contrast: 1.25, sharpen: true });
    }
    if (Number(metrics.contrast) < 0.2 || metrics.unevenBackground || Number(metrics.noise) > 0.2) {
      add({
        id: 'adaptive-threshold', rotation: orientation, scale, grayscale: true, contrast: 1.45,
        threshold: 'adaptive', denoise: Number(metrics.noise) > 0.15, sharpen: true,
        backgroundCorrection: Boolean(metrics.unevenBackground),
      });
    }
    if (lowResolution) add({ id: 'upscaled', rotation: orientation, scale: 3, grayscale: true, contrast: 1.3, sharpen: true });
    if (metrics.tryOrientations) {
      [90, 180, 270].forEach((rotation) => add({ id: `fallback-${rotation}`, rotation, scale, grayscale: true, contrast: 1.25, sharpen: true }));
    }
    return candidates;
  }

  function scoreOcrCandidate(candidate = {}) {
    const text = String(candidate.text || candidate.data?.text || '');
    const lines = Array.isArray(candidate.lines) && candidate.lines.length
      ? candidate.lines
      : text.split(/\r?\n/).filter(Boolean).map((value) => ({ text: value }));
    const quality = assessPageText(lines, { expectedType: candidate.expectedType });
    const rawConfidence = Number(candidate.confidence ?? candidate.data?.confidence) || 0;
    const confidence = rawConfidence > 1 ? rawConfidence / 100 : rawConfidence;
    const domainHits = (text.match(/\b(?:MCB|MCCB|RCBO|RCD|AFDD|SPD|SPN|DPN|TPN|L[123]|\d+(?:\.\d+)?\s*(?:A|MA|KA))\b/gi) || []).length;
    const tableRows = lines.filter((line) => /(?:^|\s)(?:\d{1,3}\s*(?:\/\s*)?L[123]|L[123]\s+\d+(?:\.\d+)?)/i.test(String(line.text || ''))).length;
    const score = Math.max(0, Math.min(1,
      confidence * 0.45 + quality.score * 0.42 + Math.min(0.08, domainHits * 0.008) + Math.min(0.05, tableRows * 0.01)));
    return { score, confidence, textQuality: quality, domainHits, tableRows };
  }

  function selectBestOcrCandidate(candidates) {
    const scored = (candidates || []).map((candidate, index) => ({ candidate, index, ...scoreOcrCandidate(candidate) }));
    scored.sort((left, right) => right.score - left.score || left.index - right.index);
    return scored.length ? { candidate: scored[0].candidate, score: scored[0].score, scored } : { candidate: null, score: 0, scored: [] };
  }

  function correctElectricalOcrText(value) {
    const originalText = String(value || '');
    let correctedText = originalText;
    const corrections = [];
    const replace = (pattern, replacement, reason) => {
      correctedText = correctedText.replace(pattern, (...args) => {
        const original = args[0];
        const corrected = typeof replacement === 'function' ? replacement(...args) : replacement;
        if (corrected !== original) corrections.push({ original, corrected, reason });
        return corrected;
      });
    };
    replace(/\b(Way|Cct|Ckt|Circuit)\s+[lI|](?=\s*[:#])/gi, (match, label) => `${label} 1`, 'OCR confused the circuit number 1 with I, l, or |');
    replace(/\b[lI|](\d{1,2})\s*A\b/g, (match, suffix) => {
      const candidate = Number(`1${suffix}`);
      return [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125].includes(candidate) ? `${candidate}A` : match;
    }, 'OCR confused the leading digit 1 in a standard current rating');
    replace(/\bMC8\b/gi, 'MCB', 'OCR confused the letter B with the digit 8 in MCB');
    replace(/\bMCC8\b/gi, 'MCCB', 'OCR confused the letter B with the digit 8 in MCCB');
    replace(/\bRC8O\b/gi, 'RCBO', 'OCR confused the letter B with the digit 8 in RCBO');
    replace(/\b(\d{1,2})[OoQ]\s*kA\b/gi, (match, prefix) => `${prefix}0kA`, 'OCR confused the digit 0 with O or Q in a breaking-capacity value');
    return { originalText, text: correctedText, corrections };
  }

  function extractTrippingCurve(value, context = {}) {
    const source = String(value || '');
    const explicit = source.match(/\b(?:TYPE|CURVE|CHARACTERISTIC)\s*[-:]?\s*([BCDKZ])\b/i)
      || source.match(/\b([BCDKZ])\s*[- ]?CURVE\b/i);
    if (explicit) return { value: explicit[1].toUpperCase(), original: explicit[0], confidence: 0.98, reason: 'Explicit tripping-curve wording' };
    const hasDevice = Boolean(context.deviceContext) || /\b(?:MCB|MCCB|RCBO|AFDD|CIRCUIT BREAKER)\b/i.test(source);
    if (!hasDevice) return null;
    const compact = source.match(/(?:^|\s)([BCDKZ])\s*[-]?\s*(\d{1,3})(?=\s|$|[,;])/i);
    if (!compact) return null;
    if (/\b(?:DB|BOARD|REV(?:ISION)?)\s*[- ]?\s*[BCDKZ]\s*[-]?\s*\d{1,3}\b/i.test(source) && !/\b(?:MCB|MCCB|RCBO|AFDD)\b/i.test(source)) return null;
    return { value: compact[1].toUpperCase(), rating: Number(compact[2]), original: compact[0].trim(), confidence: 0.94, reason: 'Compact curve-and-rating value in device context' };
  }

  function extractBreakingCapacity(value) {
    const source = String(value || '');
    const match = source.match(/\b(\d+(?:\.\d+)?)\s*kA\b/i);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 150) return null;
    return { value: amount, original: match[0], confidence: 0.98, reason: 'Explicit kA unit' };
  }

  function reconstructSpatialRows(words) {
    const clean = (words || []).map((word) => {
      const box = word?.bbox || word?.boundingBox || {};
      const x0 = Number(box.x0 ?? box.left);
      const y0 = Number(box.y0 ?? box.top);
      const x1 = Number(box.x1 ?? box.right);
      const y1 = Number(box.y1 ?? box.bottom);
      return { text: String(word?.text || '').trim(), x0, y0, x1, y1, confidence: Number(word?.confidence ?? word?.conf) };
    }).filter((word) => word.text && [word.x0, word.y0, word.x1, word.y1].every(Number.isFinite));
    clean.sort((left, right) => left.y0 - right.y0 || left.x0 - right.x0);
    const rows = [];
    clean.forEach((word) => {
      const cy = (word.y0 + word.y1) / 2;
      const height = Math.max(1, word.y1 - word.y0);
      let row = rows.find((candidate) => Math.abs(candidate.cy - cy) <= Math.max(4, Math.min(candidate.height, height) * 0.65));
      if (!row) {
        row = { words: [], cy, height };
        rows.push(row);
      }
      row.words.push(word);
      row.cy = row.words.reduce((sum, item) => sum + (item.y0 + item.y1) / 2, 0) / row.words.length;
      row.height = Math.max(...row.words.map((item) => item.y1 - item.y0));
    });
    return rows.sort((left, right) => left.cy - right.cy).map((row) => {
      row.words.sort((left, right) => left.x0 - right.x0);
      const cells = [];
      row.words.forEach((word) => {
        const prior = cells[cells.length - 1];
        const gap = prior ? word.x0 - prior.x1 : 0;
        if (!prior || gap > Math.max(18, row.height * 2.2)) {
          cells.push({ text: word.text, x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1, words: [word] });
        } else {
          prior.text += ` ${word.text}`;
          prior.x1 = Math.max(prior.x1, word.x1); prior.y0 = Math.min(prior.y0, word.y0); prior.y1 = Math.max(prior.y1, word.y1); prior.words.push(word);
        }
      });
      cells.forEach((cell) => {
        cell.bbox = [cell.x0, cell.y0, cell.x1 - cell.x0, cell.y1 - cell.y0];
        cell.confidence = cell.words.reduce((sum, word) => sum + (Number.isFinite(word.confidence) ? word.confidence : 0), 0) / Math.max(1, cell.words.length) / 100;
      });
      const x0 = Math.min(...row.words.map((word) => word.x0));
      const y0 = Math.min(...row.words.map((word) => word.y0));
      const x1 = Math.max(...row.words.map((word) => word.x1));
      const y1 = Math.max(...row.words.map((word) => word.y1));
      return { text: row.words.map((word) => word.text).join(' '), bbox: [x0, y0, x1 - x0, y1 - y0], cells };
    });
  }

  function stitchSchedulePages(pages) {
    const output = [];
    let boardRef = null;
    const headerKeys = new Set();
    (pages || []).forEach((page) => {
      if (page && page.boardRef) boardRef = page.boardRef;
      (page && page.rows || []).forEach((row) => {
        const text = String(row && row.text || '').replace(/\s+/g, ' ').trim();
        if (!text) return;
        const header = /\b(?:WAY|CCT|CIRCUIT)\b.*\b(?:DESCRIPTION|RATING|DEVICE|PROTECTION)\b/i.test(text);
        if (header) { headerKeys.add(text.toUpperCase()); return; }
        if (headerKeys.has(text.toUpperCase())) return;
        output.push({ ...row, text, page: page.page, boardRef: page.boardRef || boardRef });
      });
    });
    return output;
  }

  function deduplicateExtractionRows(rows) {
    const output = [];
    const duplicates = [];
    const indexes = new Map();
    const keyFor = (row) => {
      const board = String(row?.boardNorm || '').toUpperCase();
      const capacity = row?.breakingCapacity ?? row?.breakingCapacityKa ?? row?.ka ?? '';
      const poles = row?.poleConfiguration ?? row?.poleConfig ?? row?.pole ?? row?.poles ?? '';
      if (board && row?.way != null) return ['circuit', board, row.way, row.phase || '', row.device || '', row.rating ?? '', row.curve || '', capacity, poles].join('|');
      const bbox = Array.isArray(row?.bbox) ? row.bbox.map((value) => Number(value).toFixed(1)).join(',') : '';
      if (row?.fileId && row?.page != null && bbox) return ['region', row.fileId, row.page, bbox, row.device || '', row.rating ?? ''].join('|');
      return ['source', row?.id || '', row?.fileId || '', row?.page ?? '', row?.line ?? '', row?.srcText || ''].join('|');
    };
    (rows || []).forEach((row) => {
      const key = keyFor(row);
      const index = indexes.get(key);
      if (index == null) { indexes.set(key, output.length); output.push(row); return; }
      const prior = output[index];
      const priorScore = Number(prior?.conf || 0) + (prior?.status === 'confirmed' ? 1 : 0);
      const nextScore = Number(row?.conf || 0) + (row?.status === 'confirmed' ? 1 : 0);
      if (nextScore > priorScore) {
        output[index] = row;
        duplicates.push({ retained: row, excluded: prior, key });
      } else {
        duplicates.push({ retained: prior, excluded: row, key });
      }
    });
    return { rows: output, duplicates };
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
      return { text: String(word?.text || '').trim(), x0, y0, x1, y1, confidence: Number(word?.confidence ?? word?.conf) };
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
        confidence: line.words.reduce((sum, word) => sum + (Number.isFinite(word.confidence) ? word.confidence : 0), 0) / Math.max(1, line.words.length) / 100,
        words: line.words.map((word) => ({
          text: word.text,
          bbox: [word.x0 * sx, word.y0 * sy, (word.x1 - word.x0) * sx, (word.y1 - word.y0) * sy],
          confidence: Number.isFinite(word.confidence) ? word.confidence / 100 : null,
        })),
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
    const split = source.match(/\b(\d{1,3})\s*[- ]?Ways?\s+Power\s*\+\s*(\d{1,3})\s*[- ]?Ways?\s+Lighting\b/i);
    if (split) {
      const ways = Number(split[1]) + Number(split[2]);
      if (ways >= 2 && ways <= 200) return { ways, evidence: split[0].trim(), split: true };
    }
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
      else if (/^\s*(?:\d{1,3}\s+)?L[123]\b/i.test(line)) hits += 1;              // TBA phase slots
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
    const boardValues = Object.values(boards || {});
    const hasPrimaryMetadata = boardValues.some((board) =>
      (board.pages || []).some((ref) => ref && ref.primary));
    const primaryBoardsByPage = new Map();
    if (hasPrimaryMetadata) {
      for (const board of boardValues) {
        for (const ref of board.pages || []) {
          if (!ref || !ref.primary) continue;
          const key = `${ref.fileId}#${ref.page}`;
          if (!primaryBoardsByPage.has(key)) primaryBoardsByPage.set(key, new Set());
          primaryBoardsByPage.get(key).add(board.norm);
        }
      }
    }

    const perBoard = [];
    for (const board of boardValues) {
      let expected = null;
      let evidence = null;
      const boardPages = hasPrimaryMetadata
        ? (board.pages || []).filter((ref) => ref && ref.primary)
        : (board.pages || []);
      for (const ref of boardPages) {
        const pg = pageMap.get(`${ref.fileId}#${ref.page}`);
        const found = pg && expectedWaysFromText(pg.text);
        if (found && (!expected || found.ways > expected)) {
          expected = found.ways;
          evidence = { fileId: ref.fileId, page: ref.page, text: found.evidence };
        }
      }
      const boardRows = scheduleRows.filter((r) => r.boardNorm === board.norm);
      const ways = new Set(boardRows.filter((r) => r.way != null).map((r) => `${r.boardSection || ''}:${r.way}`));
      const unaccounted = expected != null ? Math.max(0, expected - ways.size) : null;
      const upstreamType = /^(?:MAIN|MDB|SMDB|MCC|SB|PB)$/.test(String(board.type || '').toUpperCase());
      const upstreamReference = /^(?:MAIN|MSB|SWB|SMDB|MDB|PB|MCC|MCP|GENERATOR)/i.test(String(board.orig || '').replace(/[\s._/\\-]+/g, ''));
      const inScope = hasPrimaryMetadata ? boardPages.length > 0 && !upstreamType && !upstreamReference : true;
      perBoard.push({
        norm: board.norm, orig: board.orig,
        expectedWays: expected, evidence,
        capturedWays: ways.size, rowsCaptured: boardRows.length,
        unaccountedWays: unaccounted, inScope,
      });
    }

    const scopedBoardNorms = new Set(perBoard.filter((board) => board.inScope).map((board) => board.norm));
    const zeroRowSchedulePages = [];
    for (const pg of pages || []) {
      if (!String(pg.text || '').trim()) continue;
      const pageKey = `${pg.fileId}#${pg.page}`;
      const primaryBoards = primaryBoardsByPage.get(pageKey);
      if (hasPrimaryMetadata && (!primaryBoards || !primaryBoards.size)) continue;
      if (hasPrimaryMetadata && !Array.from(primaryBoards).some((norm) => scopedBoardNorms.has(norm))) continue;
      const hasHeader = /\bDB\s+REFERENCE\b|\b(?:DISTRIBUTION\s+)?BOARD\s*(?:REFERENCE|REF|IDENTITY)?\s*[:=\-]/i.test(pg.text);
      const scheduleish = hasPrimaryMetadata
        ? hasHeader || pageLooksTabular(pg.text) || Boolean(expectedWaysFromText(pg.text))
        : COVERAGE_SCHEDULE_TYPES.has(pg.type) || pageLooksTabular(pg.text) || Boolean(expectedWaysFromText(pg.text));
      if (!scheduleish) continue;
      const hasRows = scheduleRows.some((r) =>
        r.fileId === pg.fileId && r.page === pg.page
        && (!hasPrimaryMetadata || primaryBoards.has(r.boardNorm)));
      if (!hasRows) {
        zeroRowSchedulePages.push({
          fileId: pg.fileId,
          page: pg.page,
          type: pg.type,
          boardNorm: primaryBoards && primaryBoards.size === 1 ? Array.from(primaryBoards)[0] : null,
          boardNorms: primaryBoards ? Array.from(primaryBoards) : [],
        });
      }
    }

    const scopedBoards = perBoard.filter((board) => board.inScope);
    const expectedTotal = scopedBoards.reduce((sum, b) => sum + (b.expectedWays || 0), 0);
    const capturedTotal = scopedBoards.reduce((sum, b) => sum + (b.expectedWays != null ? Math.min(b.capturedWays, b.expectedWays) : 0), 0);
    return {
      perBoard,
      zeroRowSchedulePages,
      summary: {
        boards: scopedBoards.length,
        boardsWithRows: scopedBoards.filter((b) => b.rowsCaptured > 0).length,
        expectedWays: expectedTotal,
        capturedWays: capturedTotal,
        pctComplete: expectedTotal ? Math.round((100 * capturedTotal) / expectedTotal) : null,
        unaccountedBoards: scopedBoards.filter((b) => (b.unaccountedWays || 0) > 0).length,
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

  /* ===== Analysis health — honest completeness states =====
   * An analysis may only present itself as "Analysed" when these invariants
   * hold. Anything else is 'incomplete' (some evidence was not captured) or
   * 'failed' (the result is unusable), each with STABLE reason codes the UI,
   * diagnostics export, and tests all share. This exists because a real
   * project once showed "7 boards / 0 devices" as a successful analysis. */
  const HEALTH_REASONS = {
    ZERO_DEVICES_WITH_BOARDS: 'Boards were identified but no device rows were captured anywhere',
    BOARD_ROWS_MISSING: 'Board has schedule evidence but zero captured device rows',
    WAYS_UNACCOUNTED: 'Board header promises more ways than were captured',
    SCHEDULE_PAGE_UNPARSED: 'Page looks like a schedule but produced no rows',
    SCHEDULE_DOC_NO_BOARDS: 'Schedule-type pages exist but no board reference was identified',
    PAGE_TEXT_UNRELIABLE: 'Page text is unreliable and OCR has not replaced it',
    OCR_PENDING: 'Page is still waiting for OCR',
    DOCUMENT_UNREADABLE: 'Document could not be read',
    NO_CONTENT: 'No readable pages were available to analyse',
  };

  /* Multi-signal schedule-candidate score. A page is a candidate because of
   * what is ON it, never because a single classifier label said so. Returns
   * {score 0..1, signals[]} — callers treat score ≥ 0.45 with ≥ 2 signal
   * families as a candidate. */
  function scoreScheduleCandidate(lines) {
    const texts = (lines || []).map((l) => (typeof l === 'string' ? l : (l && l.text) || ''));
    const all = texts.join('\n');
    const signals = [];
    let wayLines = 0;
    for (const t of texts) {
      if (/^\s*\d{1,3}\s*[\/ ]\s*L[123]\b/i.test(t) || /^\s*(?:way|cct|ckt|circuit)\s*\d{1,3}\b/i.test(t)
        || /^\s*\d{1,3}\s{2,}\S/.test(t)) wayLines += 1;
    }
    if (wayLines >= 4) signals.push('way-sequence');
    const deviceHits = (all.match(/\b(?:MCB|MCCB|RCBO|RCC?B|ACB|SPD|AFDD|RCD|isolator|contactor|switch\s*fuse|fuse\s*switch|time\s*clock|photocell|relay|meter)\b/gi) || []).length;
    if (deviceHits >= 3) signals.push('device-tokens');
    const ratingHits = (all.match(/\b\d{1,4}\s*A(?:mps?)?\b/gi) || []).length;
    if (ratingHits >= 4) signals.push('rating-tokens');
    if (/\b(?:type\s*[BCD]\b|[BCD]\d{2,3}\b)/i.test(all) && /\bL[123]\b|\bTP&?N\b|\bSP&?N\b|\b[13]PH?\b/i.test(all)) signals.push('curve-phase');
    if (texts.some((t) => (t.match(/\b(?:way|cct|circuit|description|device|rating|poles?|curve|phase|protective|breaking)\b/gi) || []).length >= 3)) {
      signals.push('column-header');
    }
    if (/\bDB\s*REFERENCE\b|\b(?:DISTRIBUTION\s+)?BOARD\s*(?:REFERENCE|REF|IDENTITY)\b/i.test(all)) signals.push('board-header');
    if (expectedWaysFromText(all)) signals.push('way-count-header');
    const score = Math.min(1, signals.length * 0.2 + (wayLines >= 8 ? 0.15 : 0) + (deviceHits >= 8 ? 0.1 : 0));
    return { score: Number(score.toFixed(2)), signals };
  }

  /**
   * Compute the honest health of one analysis run.
   * @param coverage output of buildCoverage (may be null)
   * @param boards   analysis boards map
   * @param rows     analysis rows
   * @param pages    [{fileId, page, type, textLines, needsOcr, source, scheduleScore, rowsParsed}]
   * @param files    [{id, name, status}] all files that were in scope
   * @returns {state:'complete'|'incomplete'|'failed', reasons:[{code,message,count,refs}], counters}
   */
  function buildAnalysisHealth({ coverage, boards, rows, pages, files }) {
    const reasons = new Map();
    const addReason = (code, ref) => {
      if (!reasons.has(code)) reasons.set(code, { code, message: HEALTH_REASONS[code] || code, count: 0, refs: [] });
      const entry = reasons.get(code);
      entry.count += 1;
      if (ref && entry.refs.length < 25) entry.refs.push(ref);
    };

    const allRows = (rows || []).filter((r) => r && r.status !== 'rejected');
    const deviceRows = allRows.filter((r) => r.device && !r.space);
    const deviceCount = deviceRows.reduce((sum, r) => sum + (Number(r.qty) || 1), 0);
    const boardCount = Object.keys(boards || {}).length;
    const pageList = pages || [];
    const schedulePages = pageList.filter((pg) => (pg.scheduleScore || 0) >= 0.45 || COVERAGE_SCHEDULE_TYPES.has(pg.type));

    for (const file of files || []) {
      if (file.status === 'error') addReason('DOCUMENT_UNREADABLE', { fileId: file.id });
    }
    for (const pg of pageList) {
      if (pg.source === 'ocr_pending' || (pg.needsOcr && pg.source !== 'ocr')) {
        addReason('OCR_PENDING', { fileId: pg.fileId, page: pg.page });
      } else if (pg.textQualityUnreliable) {
        addReason('PAGE_TEXT_UNRELIABLE', { fileId: pg.fileId, page: pg.page });
      }
    }
    for (const pg of schedulePages) {
      if ((pg.rowsParsed || 0) === 0 && (pg.textLines || 0) > 0) {
        addReason('SCHEDULE_PAGE_UNPARSED', { fileId: pg.fileId, page: pg.page, score: pg.scheduleScore || null });
      }
    }
    if (coverage) {
      for (const board of coverage.perBoard || []) {
        if (!board.inScope) continue;
        if (board.rowsCaptured === 0) addReason('BOARD_ROWS_MISSING', { board: board.norm });
        else if ((board.unaccountedWays || 0) > 0) {
          addReason('WAYS_UNACCOUNTED', { board: board.norm, expected: board.expectedWays, captured: board.capturedWays });
        }
      }
    }
    if (boardCount === 0 && schedulePages.length > 0) addReason('SCHEDULE_DOC_NO_BOARDS', null);
    if (pageList.length === 0) addReason('NO_CONTENT', null);
    if (boardCount > 0 && deviceCount === 0) addReason('ZERO_DEVICES_WITH_BOARDS', null);

    let state = 'complete';
    if (reasons.size > 0) state = 'incomplete';
    if (reasons.has('ZERO_DEVICES_WITH_BOARDS') || reasons.has('NO_CONTENT')
      || (deviceCount === 0 && schedulePages.length > 0)) state = 'failed';

    return {
      state,
      reasons: Array.from(reasons.values()),
      counters: {
        pagesAnalysed: pageList.length,
        schedulePages: schedulePages.length,
        schedulePagesParsed: schedulePages.filter((pg) => (pg.rowsParsed || 0) > 0).length,
        boards: boardCount,
        boardsWithRows: coverage ? (coverage.perBoard || []).filter((b) => b.rowsCaptured > 0).length : null,
        deviceCount,
        expectedWays: coverage ? coverage.summary.expectedWays : null,
        capturedWays: coverage ? coverage.summary.capturedWays : null,
      },
    };
  }

  /* Private-safe diagnostic export: counters, reason codes and page shapes
   * only — NEVER document text, board names, file names, or any customer
   * content. Safe to email to support. */
  function buildDiagnosticExport({ health, coverage, files, pages, appVersion }) {
    const anon = new Map();
    const fileTag = (id) => {
      if (!anon.has(id)) anon.set(id, `doc-${anon.size + 1}`);
      return anon.get(id);
    };
    return {
      diagnosticVersion: 1,
      appVersion: appVersion || null,
      generatedAt: new Date().toISOString(),
      health: health ? {
        state: health.state,
        counters: health.counters,
        reasons: (health.reasons || []).map((r) => ({
          code: r.code,
          count: r.count,
          refs: (r.refs || []).map((ref) => ({
            ...(ref && ref.fileId ? { file: fileTag(ref.fileId) } : {}),
            ...(ref && ref.page ? { page: ref.page } : {}),
            ...(ref && ref.expected != null ? { expected: ref.expected, captured: ref.captured } : {}),
          })),
        })),
      } : null,
      coverageSummary: coverage ? coverage.summary : null,
      files: (files || []).map((f) => ({
        file: fileTag(f.id),
        ext: f.ext || null,
        status: f.status || null,
        pages: (f.pages || []).length,
      })),
      pages: (pages || []).map((pg) => ({
        file: fileTag(pg.fileId),
        page: pg.page,
        type: pg.type || null,
        textLines: pg.textLines || 0,
        source: pg.source || null,
        scheduleScore: pg.scheduleScore ?? null,
        scheduleSignals: pg.scheduleSignals || [],
        rowsParsed: pg.rowsParsed || 0,
      })),
    };
  }

  global.EstimationExtractorCore = {
    expectedWaysFromText,
    pageLooksTabular,
    buildCoverage,
    HEALTH_REASONS,
    scoreScheduleCandidate,
    buildAnalysisHealth,
    buildDiagnosticExport,
    THREE_TYPES,
    toThreeType,
    DEFAULT_PROTECTION_LEGEND,
    parseProtectionLegend,
    parseTrailingCable,
    normaliseBoardReference,
    canonicalBoardReference,
    extractBoardReferences,
    classifyPageText,
    parseBamScheduleLine,
    parseTbaProtectionLine,
    parseTbaSchedulePage,
    parseKnownScheduleLine,
    extractAssociatedEquipment,
    aggregateDevices,
    finalizeScheduleContext,
    normaliseAssistedDevice,
    assistedSeedFromText,
    matchAssistedRows,
    assessPageText,
    buildOcrCandidatePlan,
    scoreOcrCandidate,
    selectBestOcrCandidate,
    correctElectricalOcrText,
    extractTrippingCurve,
    extractBreakingCapacity,
    reconstructSpatialRows,
    stitchSchedulePages,
    deduplicateExtractionRows,
    ocrWordsToLines,
  };
})(globalThis);
