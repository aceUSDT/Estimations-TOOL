(function attachSpatialScheduleCore(global) {
  'use strict';

  const Core = global.EstimationExtractorCore;
  if (!Core) throw new Error('EstimationExtractorCore must load before spatial-schedule-core.js');

  const DEFAULT_BOARD_CLASSIFICATION_POLICY = Object.freeze({
    id: 'hager-uk-v1',
    panelboardMinAmps: 400,
    distributionBoardMinAmps: 100,
    distributionBoardMaxAmps: 250,
    consumerUnitMaxAmps: 100,
  });

  const COLUMN_DEFINITIONS = [
    { role: 'way', patterns: [/\bWAY\b/, /^CCT$/, /^CKT$/, /^CIRCUIT\s*(?:NO|NUMBER)?$/] },
    { role: 'phase', patterns: [/\bPHASE\b/, /L1.*L2.*L3/, /LINE.*PHASE/] },
    { role: 'device_standard', patterns: [/DEVICE.*BS/, /BS.*(?:EN|STANDARD)/, /PROTECTION.*STANDARD/] },
    { role: 'device_class', patterns: [/DEVICE.*(?:CLASS|FAMILY)/, /PROTECTIVE.*DEVICE.*TYPE/, /^MCB\s*\/\s*RCBO$/] },
    { role: 'trip_unit', patterns: [/^TYPE$/, /TRIP.*UNIT/, /RELEASE.*TYPE/] },
    { role: 'product_range', patterns: [/PRODUCT.*RANGE/, /FRAME.*(?:SIZE|RANGE)/, /DEVICE.*RANGE/] },
    { role: 'rating', patterns: [/\bRATING\b.*(?:A|AMP)/, /CURRENT.*RATING/, /^IN\s*\(?A\)?$/] },
    { role: 'trip_curve', patterns: [/TRIP.*CURVE/, /CHARACTERISTIC/, /^CURVE$/] },
    { role: 'pole_configuration', patterns: [/POLE.*(?:CONFIG|NUMBER|NO)/, /NO.*OF.*POLES/, /^POLES?$/] },
    { role: 'breaking_capacity', patterns: [/SHORT.*CIRCUIT.*CAPACITY/, /(?=.*\bSHORT\b)(?=.*\bCIRCUIT\b)(?=.*\bCAPACITY\b)/, /BREAKING.*CAPACITY/, /FAULT.*RATING/, /^KA$/] },
    { role: 'afdd', patterns: [/\bAFDD\b/, /\bAFFD\b/, /ARC.*FAULT/] },
    { role: 'rcd', patterns: [/^RCD$/, /RCD.*(?:YES|NO|PROTECT)/] },
    { role: 'rcd_ma', patterns: [/RCD.*OPERATING.*CURRENT/, /RCD.*\bMA\b/, /EARTH.*FAULT.*(?:DEVICE|CURRENT|\bMA\b)/, /^\(?MA\)?$/] },
    { role: 'rcd_type', patterns: [/RCD.*TYPE/, /RESIDUAL.*CURRENT.*TYPE/] },
    { role: 'rcd_arrangement', patterns: [/RCD.*ARRANGEMENT/, /RCD.*(?:INTEGRAL|SEPARATE|SHARED|UPSTREAM)/] },
    { role: 'occupancy', patterns: [/SPARE.*SPACE/, /WAY.*STATUS/, /OCCUPANCY/] },
    { role: 'circuit_reference', patterns: [/CIRCUIT.*REFERENCE/, /LOAD.*REFERENCE/] },
    { role: 'description', patterns: [/CIRCUIT.*DESCRIPTION/, /^DUTY$/, /^DESCRIPTION$/, /^SERVING$/, /LOAD.*DESCRIPTION/] },
    { role: 'circuit_type', patterns: [/CIRCUIT.*TYPE/, /CIRCUIT.*CONFIG/, /^CONFIG(?:URATION)?$/] },
    { role: 'line_csa', patterns: [/(?:LIVE|LINE|PHASE).*\bMM/, /CONDUCTOR.*SIZE/] },
    { role: 'cpc_csa', patterns: [/\bCPC\b/, /EARTH.*(?:SIZE|CSA)/] },
    { role: 'cable_type', patterns: [/CABLE.*TYPE/, /CABLE.*CODE/] },
    { role: 'install_method', patterns: [/INSTALL.*METHOD/, /REFERENCE.*METHOD/] },
    { role: 'max_disconnect', patterns: [/DIS.*CONN.*TIME/, /DISCONNECTION.*TIME/] },
    { role: 'max_zs', patterns: [/MAX.*ZS/, /ZS.*MAX/] },
    { role: 'earth_fault_device', patterns: [/EARTH.*FAULT.*PROTECTIVE.*DEVICE/] },
    { role: 'arc_flash_device', patterns: [/ARC.*FLASH.*PROTECTIVE.*DEVICE/] },
    { role: 'contactor', patterns: [/\bCONTACTOR\b/, /CONTROL.*CONTACTOR/] },
    { role: 'epo', patterns: [/\bEPO\b/, /EMERGENCY.*(?:POWER\s+OFF|STOP)/] },
    { role: 'spd', patterns: [/\bSPD\b/, /SURGE.*PROTECTION/] },
  ];

  const CALIBRATION_ROLE_DEFINITIONS = Object.freeze([
    { role: 'board_ref', kind: 'header', group: 'Board details', label: 'Board reference' },
    { role: 'board_type', kind: 'header', group: 'Board details', label: 'Board type' },
    { role: 'ways_total', kind: 'header', group: 'Board details', label: 'Number of ways' },
    { role: 'board_rating', kind: 'header', group: 'Board details', label: 'Board rating' },
    { role: 'phase_config', kind: 'header', group: 'Board details', label: 'Board phase configuration' },
    { role: 'supply_source', kind: 'header', group: 'Board details', label: 'Supplied from board' },
    { role: 'fault_rating', kind: 'header', group: 'Board details', label: 'Board fault rating' },
    { role: 'incomer_class', kind: 'header', group: 'Incoming device', label: 'Incoming device type' },
    { role: 'incomer_rating', kind: 'header', group: 'Incoming device', label: 'Incoming device rating' },
    { role: 'way', kind: 'column', group: 'Outgoing circuit', label: 'Way / circuit number' },
    { role: 'circuit_reference', kind: 'column', group: 'Outgoing circuit', label: 'Circuit reference' },
    { role: 'description', kind: 'column', group: 'Outgoing circuit', label: 'Load description' },
    { role: 'occupancy', kind: 'column', group: 'Outgoing circuit', label: 'Spare / blank way status' },
    { role: 'phase', kind: 'column', group: 'Outgoing device', label: 'Circuit phase' },
    { role: 'device_class', kind: 'column', group: 'Outgoing device', label: 'Device type' },
    { role: 'rating', kind: 'column', group: 'Outgoing device', label: 'Device rating' },
    { role: 'pole_configuration', kind: 'column', group: 'Outgoing device', label: 'Number of poles' },
    { role: 'device_standard', kind: 'column', group: 'Outgoing device', label: 'BS / EN protection standard' },
    { role: 'trip_curve', kind: 'column', group: 'Outgoing device', label: 'Trip curve' },
    { role: 'trip_unit', kind: 'column', group: 'Outgoing device', label: 'Trip unit / release' },
    { role: 'product_range', kind: 'column', group: 'Outgoing device', label: 'Product range / frame' },
    { role: 'breaking_capacity', kind: 'column', group: 'Outgoing device', label: 'Breaking capacity' },
    { role: 'rcd', kind: 'column', group: 'Additional protection', label: 'RCD protection' },
    { role: 'rcd_ma', kind: 'column', group: 'Additional protection', label: 'RCD sensitivity' },
    { role: 'rcd_type', kind: 'column', group: 'Additional protection', label: 'RCD type' },
    { role: 'rcd_arrangement', kind: 'column', group: 'Additional protection', label: 'RCD arrangement' },
    { role: 'afdd', kind: 'column', group: 'Additional protection', label: 'AFDD protection' },
    { role: 'contactor', kind: 'column', group: 'Associated equipment', label: 'Contactor' },
    { role: 'epo', kind: 'column', group: 'Associated equipment', label: 'EPO / emergency stop' },
    { role: 'spd', kind: 'column', group: 'Associated equipment', label: 'Surge protection device' },

    // Legacy geometry and non-report fields remain valid parser inputs for saved projects,
    // but they are intentionally hidden from new calibration menus.
    { role: 'board_header', kind: 'region', label: 'Board details section', userVisible: false },
    { role: 'incomer_section', kind: 'region', label: 'Incoming device section', userVisible: false },
    { role: 'outgoing_table', kind: 'region', label: 'Outgoing circuit table', userVisible: false },
    { role: 'outgoing_row_group', kind: 'region', label: 'One complete outgoing way / row group', userVisible: false },
    { role: 'single_phase_rows', kind: 'layout', label: 'Single-phase rows', userVisible: false },
    { role: 'three_phase_rows', kind: 'layout', label: 'Three-phase split rows', userVisible: false },
    { role: 'three_phase_merged', kind: 'layout', label: 'Three-phase merged row', userVisible: false },
    { role: 'circuit_type', kind: 'column', label: 'Circuit type', userVisible: false },
    { role: 'line_csa', kind: 'column', label: 'Live conductor size', userVisible: false },
    { role: 'cpc_csa', kind: 'column', label: 'CPC size', userVisible: false },
    { role: 'cable_type', kind: 'column', label: 'Cable type', userVisible: false },
    { role: 'install_method', kind: 'column', label: 'Installation method', userVisible: false },
    { role: 'earth_fault_device', kind: 'column', label: 'Earth-fault protective device', userVisible: false },
    { role: 'arc_flash_device', kind: 'column', label: 'Arc-flash protective device', userVisible: false },
    { role: 'supply_cable', kind: 'header', label: 'Supply cable', userVisible: false },
    { role: 'location', kind: 'header', label: 'Board location', userVisible: false },
    { role: 'purpose', kind: 'header', label: 'Board purpose', userVisible: false },
    { role: 'metering', kind: 'header', label: 'Metering', userVisible: false },
    { role: 'board_model', kind: 'header', label: 'Board model', userVisible: false },
  ]);

  const CALIBRATION_COLUMN_ROLES = new Set(CALIBRATION_ROLE_DEFINITIONS
    .filter((definition) => definition.kind === 'column').map((definition) => definition.role));
  const CALIBRATION_HEADER_ROLES = new Set(CALIBRATION_ROLE_DEFINITIONS
    .filter((definition) => definition.kind === 'header').map((definition) => definition.role));
  const CALIBRATION_LAYOUT_ROLES = new Set(CALIBRATION_ROLE_DEFINITIONS
    .filter((definition) => definition.kind === 'layout').map((definition) => definition.role));

  const CRITICAL_COLUMNS = ['way', 'rating', 'device_standard'];

  function finite(value) {
    return Number.isFinite(Number(value));
  }

  function bboxObject(value) {
    const box = value?.bbox || value?.boundingBox || value || {};
    let x0; let y0; let x1; let y1;
    if (Array.isArray(box)) {
      x0 = Number(box[0]); y0 = Number(box[1]);
      x1 = x0 + Number(box[2]); y1 = y0 + Number(box[3]);
    } else {
      x0 = Number(box.x0 ?? box.left ?? box.x);
      y0 = Number(box.y0 ?? box.top ?? box.y);
      x1 = Number(box.x1 ?? box.right ?? (finite(box.width) ? x0 + Number(box.width) : NaN));
      y1 = Number(box.y1 ?? box.bottom ?? (finite(box.height) ? y0 + Number(box.height) : NaN));
    }
    if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
    return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
  }

  function normaliseWord(word, index = 0) {
    const box = bboxObject(word);
    const text = String(word?.text ?? word?.str ?? '').replace(/\s+/g, ' ').trim();
    if (!box || !text) return null;
    let confidence = Number(word?.confidence ?? word?.conf);
    if (confidence > 1) confidence /= 100;
    if (!Number.isFinite(confidence)) confidence = 1;
    const rotation = Number(word?.rotation ?? word?.angle ?? 0);
    return {
      id: String(word?.id || `word-${index}`), text, rotation,
      confidence: Math.max(0, Math.min(1, confidence)),
      ...box,
      cx: (box.x0 + box.x1) / 2,
      cy: (box.y0 + box.y1) / 2,
      width: box.x1 - box.x0,
      height: box.y1 - box.y0,
    };
  }

  function collectSpatialWords(input = {}) {
    let candidates = Array.isArray(input.words) ? input.words : [];
    if (!candidates.length) {
      candidates = (input.lines || []).flatMap((line) => Array.isArray(line?.words) ? line.words : []);
    }
    if (!candidates.length) {
      candidates = (input.tableRows || []).flatMap((row) => (row?.cells || []).flatMap((cell) => cell?.words?.length ? cell.words : [cell]));
    }
    return candidates.map(normaliseWord).filter(Boolean);
  }

  function unionBox(items) {
    const boxes = (items || []).map(bboxObject).filter(Boolean);
    if (!boxes.length) return null;
    const x0 = Math.min(...boxes.map((box) => box.x0));
    const y0 = Math.min(...boxes.map((box) => box.y0));
    const x1 = Math.max(...boxes.map((box) => box.x1));
    const y1 = Math.max(...boxes.map((box) => box.y1));
    return [x0, y0, x1 - x0, y1 - y0];
  }

  function sourceCell(words, role = null) {
    const list = (words || []).map(normaliseWord).filter(Boolean).sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
    if (!list.length) return null;
    return {
      role,
      text: list.map((word) => word.text).join(' ').replace(/\s+/g, ' ').trim(),
      originalText: list.map((word) => word.text).join(' ').replace(/\s+/g, ' ').trim(),
      bbox: unionBox(list),
      confidence: list.reduce((sum, word) => sum + word.confidence, 0) / list.length,
      extractionMethod: 'Spatial table parser',
      words: list.map((word) => ({ text: word.text, bbox: [word.x0, word.y0, word.width, word.height], confidence: word.confidence })),
    };
  }

  function normaliseLabel(value) {
    return String(value || '').toUpperCase()
      .replace(/MM[\u00B2\u00B3]?/g, 'MM')
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function reversedLabel(value) {
    return normaliseLabel(Array.from(String(value || '')).reverse().join(''));
  }

  function horizontalWords(words) {
    return words.filter((word) => {
      const angle = ((Number(word.rotation) % 360) + 360) % 360;
      return angle <= 25 || angle >= 335 || (angle >= 155 && angle <= 205) || !Number.isFinite(angle);
    });
  }

  function spatialRows(words, yTolerance = null) {
    const clean = horizontalWords(words).slice().sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
    const medianHeight = clean.length ? clean.map((word) => word.height).sort((a, b) => a - b)[Math.floor(clean.length / 2)] : 8;
    const tolerance = Number(yTolerance) || Math.max(3, Math.min(8, medianHeight * 0.7));
    const rows = [];
    for (const word of clean) {
      let row = rows.find((candidate) => Math.abs(candidate.cy - word.cy) <= tolerance);
      if (!row) { row = { words: [], cy: word.cy }; rows.push(row); }
      row.words.push(word);
      row.cy = row.words.reduce((sum, item) => sum + item.cy, 0) / row.words.length;
    }
    return rows.sort((a, b) => a.cy - b.cy).map((row) => {
      row.words.sort((a, b) => a.x0 - b.x0);
      const cells = [];
      const rowHeight = Math.max(...row.words.map((word) => word.height), 1);
      for (const word of row.words) {
        const prior = cells[cells.length - 1];
        const gap = prior ? word.x0 - prior.x1 : 0;
        if (!prior || gap > Math.max(14, rowHeight * 2.1)) {
          cells.push({ words: [word], x0: word.x0, x1: word.x1 });
        } else {
          prior.words.push(word); prior.x1 = Math.max(prior.x1, word.x1);
        }
      }
      return { cy: row.cy, words: row.words, cells: cells.map((cell) => sourceCell(cell.words)) };
    });
  }

  function extractWayIdentifier(value) {
    const source = String(value || '').trim().toUpperCase();
    const explicitlyLabelled = /^(?:WAY|CCT|CKT|CIRCUIT)\b/i.test(source);
    const labelled = source.replace(/^(?:WAY|CCT|CKT|CIRCUIT)\s*[:#-]?\s*/i, '').replace(/\s+/g, '');
    const numericPhase = labelled.match(/^(\d{1,3})(?:[\/-]?L[123])?$/i);
    if (numericPhase) {
      const way = Number(numericPhase[1]);
      return way >= 1 && way <= 200 ? way : null;
    }
    const hasOpaqueSeparator = /^[A-Z]{1,3}[-/]\d{1,3}$/.test(labelled);
    const normalisedOpaque = labelled.replace(/^([A-Z]{1,3})[-/](\d{1,3})$/, '$1$2');
    const opaque = normalisedOpaque.match(/^([A-Z]{1,3}\d{1,3})$/)?.[1] || null;
    if (!explicitlyLabelled && !hasOpaqueSeparator && /^L[123]$/.test(opaque || '')) return null;
    if (!opaque || Number(opaque.match(/\d+$/)?.[0]) > 200) return null;
    return hasOpaqueSeparator ? labelled.replace('/', '-') : opaque;
  }

  function extractPhase(value) {
    return String(value || '').trim().match(/^(?:\d{1,3})?(L[123])$/i)?.[1]?.toUpperCase() || null;
  }

  function clusterByX(words, tolerance) {
    const clusters = [];
    for (const word of words.slice().sort((a, b) => a.cx - b.cx)) {
      let cluster = clusters.find((item) => Math.abs(item.cx - word.cx) <= tolerance);
      if (!cluster) { cluster = { words: [], cx: word.cx }; clusters.push(cluster); }
      cluster.words.push(word);
      cluster.cx = cluster.words.reduce((sum, item) => sum + item.cx, 0) / cluster.words.length;
    }
    return clusters;
  }

  function findWayAnchors(words, pageWidth, options = {}) {
    // A way column is commonly on the left, but mirrored and right-to-left
    // schedules place it elsewhere. Score every repeated candidate column and
    // let phase/sequence evidence decide instead of imposing a page-side rule.
    const candidates = horizontalWords(words).filter((word) => extractWayIdentifier(word.text) != null);
    const clusters = clusterByX(candidates, Math.max(5, pageWidth * 0.012));
    const scored = clusters.map((cluster) => {
      const sorted = cluster.words.slice().sort((a, b) => a.cy - b.cy);
      const values = sorted.map((word) => extractWayIdentifier(word.text));
      const unique = new Set(values).size;
      let consecutive = 0;
      const sequencePart = (value) => {
        const match = String(value).replace(/[-/]/g, '').match(/^([A-Z]*)(\d+)$/);
        return match ? { prefix: match[1], number: Number(match[2]) } : null;
      };
      for (let i = 1; i < values.length; i += 1) {
        const prior = sequencePart(values[i - 1]); const current = sequencePart(values[i]);
        if (prior && current && prior.prefix === current.prefix && current.number === prior.number + 1) consecutive += 1;
      }
      const phaseSupport = sorted.filter((word) => words.some((other) => extractPhase(other.text)
        && Math.abs(other.cx - word.cx) > Math.max(2, pageWidth * 0.003)
        && Math.abs(other.cx - word.cx) < pageWidth * 0.16
        && Math.abs(other.cy - word.cy) < Math.max(18, word.height * 2))).length;
      const expectedBoost = Number.isFinite(options.expectedX)
        ? Math.max(-4, 7 - Math.abs(cluster.cx - Number(options.expectedX)) / Math.max(3, pageWidth * 0.01))
        : 0;
      const edgeDistance = Math.min(cluster.cx, Math.max(0, pageWidth - cluster.cx)) / Math.max(1, pageWidth);
      return { ...cluster, sorted, score: unique * 2 + consecutive * 2 + phaseSupport + expectedBoost - edgeDistance * 1.25 };
    }).filter((cluster) => cluster.sorted.length >= (options.allowSingle ? 1 : 2));
    scored.sort((a, b) => b.score - a.score);
    const anchors = scored[0]?.sorted || [];
    const byWay = new Map();
    for (const anchor of anchors) {
      const way = extractWayIdentifier(anchor.text);
      if (!byWay.has(way)) byWay.set(way, []);
      byWay.get(way).push(anchor);
    }
    return Array.from(byWay.values()).map((group) => group.find((word) => extractPhase(word.text) === 'L2') || group[0])
      .sort((a, b) => a.cy - b.cy);
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function phraseCandidates(headerWords, pageWidth) {
    const candidates = [];
    const add = (text, words, source, score) => {
      const clean = String(text || '').replace(/\s+/g, ' ').trim();
      if (!clean || !words?.length) return;
      const box = bboxObject({ bbox: unionBox(words) });
      if (!box) return;
      candidates.push({ text: clean, words, source, score, x: (box.x0 + box.x1) / 2 });
    };
    for (const row of spatialRows(headerWords)) {
      for (const cell of row.cells) {
        const words = cell.words.map(normaliseWord).filter(Boolean);
        add(cell.text, words, 'row_cell', 1);
      }
    }
    const stripTolerance = Math.max(6, pageWidth * 0.012);
    const strips = clusterByX(headerWords, stripTolerance).map((cluster) => {
      const ordered = cluster.words.slice().sort((a, b) => a.cy - b.cy);
      const text = ordered.map((word) => word.text).join(' ');
      add(text, ordered, 'vertical_strip', 0.92);
      return { x: cluster.cx, text, words: ordered };
    });
    for (let index = 0; index < strips.length - 1; index += 1) {
      const grouped = [strips[index]];
      for (let next = index + 1; next < strips.length && next <= index + 2; next += 1) {
        if (strips[next].x - grouped[grouped.length - 1].x > stripTolerance * 2.4) break;
        grouped.push(strips[next]);
        const groupedWords = grouped.flatMap((strip) => strip.words);
        add(grouped.map((strip) => strip.text).join(' '), groupedWords, 'vertical_group', 1.04);
        add(grouped.slice().reverse().map((strip) => strip.text).join(' '), groupedWords, 'vertical_group_reverse', 1.01);
      }
    }
    headerWords.forEach((word) => add(word.text, [word], 'word', 0.7));
    return candidates;
  }

  function candidateMatches(candidate, definition) {
    const forms = [normaliseLabel(candidate.text), reversedLabel(candidate.text)];
    if (definition.role === 'device_standard'
      && forms.some((form) => /\bBS\s*7671\b|INSTALLATION\s+METHOD|REFERENCE\s+METHOD/.test(form))) return false;
    return definition.patterns.some((pattern) => forms.some((form) => pattern.test(form)));
  }

  function repeatedX(words, predicate, tolerance) {
    const clusters = clusterByX(words.filter(predicate), tolerance).filter((cluster) => cluster.words.length >= 2);
    clusters.sort((a, b) => b.words.length - a.words.length);
    return clusters[0]?.cx ?? null;
  }

  function inferScheduleColumns(words, wayAnchors, pageWidth, pageHeight) {
    if (wayAnchors.length < 2) return { columns: [], confidence: 0, headerBand: null, dataBand: null };
    const ys = wayAnchors.map((word) => word.cy);
    const rowSpacing = median(ys.slice(1).map((value, index) => value - ys[index]).filter((value) => value > 2)) || 22;
    const dataTop = Math.max(0, ys[0] - rowSpacing * 0.55);
    const dataBottom = Math.min(pageHeight, ys[ys.length - 1] + rowSpacing * 0.6);
    const headerTop = Math.max(0, dataTop - Math.max(60, Math.min(pageHeight * 0.25, rowSpacing * 5.2)));
    const headerWords = words.filter((word) => word.cy >= headerTop && word.cy < dataTop);
    const dataWords = words.filter((word) => word.cy >= dataTop && word.cy <= dataBottom);
    const candidates = phraseCandidates(headerWords, pageWidth);
    const selected = new Map();
    for (const definition of COLUMN_DEFINITIONS) {
      const matches = candidates.filter((candidate) => candidateMatches(candidate, definition));
      const adjustedScore = (candidate) => {
        const roleCount = COLUMN_DEFINITIONS.filter((item) => candidateMatches(candidate, item)).length;
        const box = bboxObject({ bbox: unionBox(candidate.words) });
        const widthRatio = box ? (box.x1 - box.x0) / pageWidth : 0;
        return candidate.score
          - Math.max(0, roleCount - 1) * 0.14
          - Math.max(0, candidate.words.length - 3) * 0.04
          - Math.max(0, widthRatio - 0.1) * 0.8;
      };
      matches.sort((a, b) => adjustedScore(b) - adjustedScore(a) || a.words.length - b.words.length);
      if (matches[0]) selected.set(definition.role, { role: definition.role, x: matches[0].x, evidence: matches[0], source: 'header' });
    }

    const tolerance = Math.max(5, pageWidth * 0.012);
    const standardX = repeatedX(dataWords, (word) => /^(?:BS\s*(?:EN\s*)?)?(?:60898|61009|61008|60947(?:[-/]?[23])?)$/i.test(word.text.replace(/\s/g, '')), tolerance);
    const headerRatingX = selected.get('rating')?.x ?? null;
    const ratingDataX = repeatedX(dataWords, (word) => /^\d+(?:\.\d+)?\s*A$/i.test(word.text), tolerance);
    const ratingX = Number.isFinite(headerRatingX) ? headerRatingX : ratingDataX;
    const curveX = repeatedX(dataWords, (word) => {
      if (Number.isFinite(standardX) && word.cx <= standardX) return false;
      if (Number.isFinite(ratingX) && word.cx >= ratingX) return false;
      return /^[BCD]$/i.test(word.text);
    }, tolerance);
    const tripUnitX = repeatedX(dataWords, (word) => {
      if (Number.isFinite(standardX) && word.cx <= standardX) return false;
      if (Number.isFinite(ratingX) && word.cx >= ratingX) return false;
      return /^(?:TMD|TM-D|LSI|LSIG|MICROLOGIC|\d{1,2}\.\d+)$/i.test(word.text);
    }, tolerance);
    const indicatorClusters = clusterByX(dataWords.filter((word) => indicatorValue(word.text) != null), tolerance)
      .filter((cluster) => cluster.words.length >= 2);
    const afddX = selected.get('afdd')?.x ?? null;
    const rcdHeaderX = selected.get('rcd')?.x ?? null;
    const rcdIndicatorCandidates = indicatorClusters.filter((cluster) => !Number.isFinite(afddX)
      || cluster.cx > afddX + tolerance * 0.35);
    rcdIndicatorCandidates.sort((left, right) => {
      if (!Number.isFinite(rcdHeaderX)) return left.cx - right.cx;
      return Math.abs(left.cx - rcdHeaderX) - Math.abs(right.cx - rcdHeaderX);
    });
    const rcdIndicatorX = Number.isFinite(rcdHeaderX) ? (rcdIndicatorCandidates[0]?.cx ?? null) : null;
    const rcdMaHeaderX = selected.get('rcd_ma')?.x ?? null;
    const breakingHeaderX = selected.get('breaking_capacity')?.x ?? null;
    const circuitReferenceX = selected.get('circuit_reference')?.x ?? pageWidth;
    const descriptionX = selected.get('description')?.x ?? null;
    const numericClusters = clusterByX(dataWords.filter((word) => {
      const value = Number(String(word.text || '').match(/^\s*(\d+(?:\.\d+)?)\s*$/)?.[1]);
      return Number.isFinite(value);
    }), tolerance).filter((cluster) => cluster.words.length >= 2);
    const rcdMaAnchorX = Number.isFinite(rcdMaHeaderX) ? rcdMaHeaderX : rcdIndicatorX;
    const rcdMaClusters = (!Number.isFinite(rcdMaAnchorX) ? [] : numericClusters).filter((cluster) => cluster.words.some((word) => {
      if (Number.isFinite(rcdIndicatorX) && word.cx <= rcdIndicatorX + tolerance * 0.25) return false;
      if (Number.isFinite(ratingX) && word.cx <= ratingX + tolerance * 0.75) return false;
      if (word.cx >= circuitReferenceX) return false;
      const value = Number(String(word.text || '').match(/^\s*(\d+(?:\.\d+)?)\s*$/)?.[1]);
      return Number.isFinite(value) && value > 0 && value <= 1000;
    })).filter((cluster) => {
      // Blank RCD cells frequently sit beside populated kA cells. Do not
      // borrow the adjacent breaking-capacity cluster as RCD sensitivity.
      if (Number.isFinite(breakingHeaderX)
        && Math.abs(cluster.cx - breakingHeaderX) + tolerance * 0.2 <= Math.abs(cluster.cx - rcdMaAnchorX)) return false;
      if (!Number.isFinite(rcdMaHeaderX)) return cluster.words.length >= 2;
      return Math.abs(cluster.cx - rcdMaHeaderX) <= Math.max(24, pageWidth * 0.06);
    });
    rcdMaClusters.sort((left, right) => {
      if (!Number.isFinite(rcdMaHeaderX)) return left.cx - right.cx;
      return Math.abs(left.cx - rcdMaHeaderX) - Math.abs(right.cx - rcdMaHeaderX);
    });
    const rcdMaX = rcdMaClusters[0]?.cx ?? null;
    const protectionRight = Number.isFinite(descriptionX) ? descriptionX : circuitReferenceX;
    const breakingCapacityClusters = numericClusters.filter((cluster) => {
      const values = cluster.words.map((word) => Number(String(word.text || '').match(/^\s*(\d+(?:\.\d+)?)\s*$/)?.[1]));
      if (!values.some((value) => Number.isFinite(value) && value > 0 && value <= 150)) return false;
      if (!Number.isFinite(breakingHeaderX)) {
        const nearestHeader = [...selected.values()].filter((column) => column.source === 'header' && Number.isFinite(column.x))
          .sort((left, right) => Math.abs(left.x - cluster.cx) - Math.abs(right.x - cluster.cx))[0];
        if (nearestHeader && nearestHeader.role !== 'breaking_capacity'
          && Math.abs(nearestHeader.x - cluster.cx) <= Math.max(18, pageWidth * 0.04)) return false;
      }
      if (Number.isFinite(ratingX) && cluster.cx <= ratingX + tolerance * 0.35) return false;
      if (Number.isFinite(rcdMaX) && cluster.cx <= rcdMaX + tolerance * 0.35) return false;
      return cluster.cx < protectionRight;
    });
    breakingCapacityClusters.sort((left, right) => {
      if (!Number.isFinite(breakingHeaderX)) return left.cx - right.cx;
      return Math.abs(left.cx - breakingHeaderX) - Math.abs(right.cx - breakingHeaderX);
    });
    const breakingCapacityX = breakingCapacityClusters[0]?.cx ?? null;
    const wayX = median(wayAnchors.map((word) => word.cx));
    const phasePatternX = repeatedX(dataWords, (word) => extractPhase(word.text) != null, tolerance);
    const inferredDeviceClassX = repeatedX(dataWords, (word) => /^(?:MCB|RCBO|MCCB|ACB|RCD|FUSE|ISOLATOR)$/i.test(word.text), tolerance);
    const deviceClassX = Number.isFinite(descriptionX) && Number.isFinite(inferredDeviceClassX)
      && Math.abs(descriptionX - inferredDeviceClassX) < pageWidth * 0.08
      ? null
      : inferredDeviceClassX;
    const guesses = {
      way: wayX,
      phase: Number.isFinite(phasePatternX) && Math.abs(phasePatternX - wayX) > tolerance ? phasePatternX : null,
      device_standard: standardX,
      device_class: deviceClassX,
      trip_unit: tripUnitX,
      trip_curve: curveX,
      rating: ratingDataX,
      rcd: rcdIndicatorX,
      rcd_ma: rcdMaX,
      breaking_capacity: breakingCapacityX,
      circuit_reference: repeatedX(dataWords, (word) => Core.extractBoardReferences(word.text).length > 0, tolerance),
      circuit_type: repeatedX(dataWords, (word) => /^(?:RD|RG|RADIAL|RING)$/i.test(word.text), tolerance),
    };
    for (const [role, x] of Object.entries(guesses)) {
      if (!Number.isFinite(x)) continue;
      const existing = selected.get(role);
      const disagrees = existing && Math.abs(existing.x - x) > Math.max(tolerance * 1.5, pageWidth * 0.018);
      const authoritativeDataPattern = role === 'device_class' || role === 'trip_curve' || role === 'rcd'
        || role === 'rcd_ma' || role === 'breaking_capacity';
      if (!existing || role === 'way' || authoritativeDataPattern || disagrees) {
        selected.set(role, {
          role,
          x,
          evidence: existing?.evidence || null,
          source: existing ? 'header_data_reconciled' : (role === 'way' ? 'way_sequence' : 'data_pattern'),
        });
      }
    }

    const deviceClassColumn = selected.get('device_class');
    const tripUnitColumn = selected.get('trip_unit');
    if (deviceClassColumn && tripUnitColumn && !Number.isFinite(tripUnitX)
      && Math.abs(deviceClassColumn.x - tripUnitColumn.x) <= tolerance * 1.5) {
      selected.delete('trip_unit');
    }
    const standardColumn = selected.get('device_standard');
    if (standardColumn && !Number.isFinite(standardX)
      && /\bBS\s*7671\b|INSTALLATION\s+METHOD|REFERENCE\s+METHOD/i.test(String(standardColumn.evidence?.text || ''))) {
      selected.delete('device_standard');
    }

    const columns = Array.from(selected.values()).filter((column) => Number.isFinite(column.x)).sort((a, b) => a.x - b.x);
    for (let i = 0; i < columns.length; i += 1) {
      columns[i].left = i ? (columns[i - 1].x + columns[i].x) / 2 : 0;
      columns[i].right = i < columns.length - 1 ? (columns[i].x + columns[i + 1].x) / 2 : pageWidth;
    }
    const critical = CRITICAL_COLUMNS.filter((role) => selected.has(role)).length;
    const semantic = ['phase', 'circuit_reference', 'description', 'device_class', 'breaking_capacity', 'trip_curve']
      .filter((role) => selected.has(role)).length;
    const confidence = Math.min(0.99, 0.35 + critical * 0.14 + semantic * 0.045 + Math.min(0.12, wayAnchors.length * 0.015));
    return {
      columns, confidence,
      headerBand: [0, headerTop, pageWidth, dataTop - headerTop],
      dataBand: [0, dataTop, pageWidth, dataBottom - dataTop],
      rowSpacing,
    };
  }

  function continuationSchema(words, wayAnchors, pageWidth, pageHeight, hint) {
    const hintedColumns = Array.isArray(hint?.columns) ? hint.columns : [];
    if (!hintedColumns.length || !wayAnchors.length) return null;
    const columns = hintedColumns.map((column) => ({
      role: column.role,
      x: Number(column.x),
      evidence: column.evidence || null,
      source: 'continuation_schema',
    })).filter((column) => Number.isFinite(column.x)).sort((a, b) => a.x - b.x);
    for (let index = 0; index < columns.length; index += 1) {
      columns[index].left = index ? (columns[index - 1].x + columns[index].x) / 2 : 0;
      columns[index].right = index < columns.length - 1 ? (columns[index].x + columns[index + 1].x) / 2 : pageWidth;
    }
    const phaseColumn = columns.find((column) => column.role === 'phase');
    const phaseWords = words.filter((word) => extractPhase(word.text)
      && (!phaseColumn || (word.cx >= phaseColumn.left && word.cx < phaseColumn.right)));
    const ys = wayAnchors.map((word) => word.cy);
    const phaseYs = phaseWords.map((word) => word.cy);
    const phaseSpacing = median(phaseYs.slice().sort((a, b) => a - b).slice(1)
      .map((value, index) => value - phaseYs.slice().sort((a, b) => a - b)[index]).filter((value) => value > 2 && value < 30)) || 12;
    const rowSpacing = ys.length >= 2
      ? median(ys.slice(1).map((value, index) => value - ys[index]).filter((value) => value > 2)) || Number(hint.rowSpacing) || phaseSpacing * 3
      : Number(hint.rowSpacing) || phaseSpacing * 3;
    const topEvidence = Math.min(...ys, ...(phaseYs.length ? phaseYs : ys));
    const bottomEvidence = Math.max(...ys, ...(phaseYs.length ? phaseYs : ys));
    const dataTop = Math.max(0, topEvidence - Math.max(phaseSpacing, rowSpacing * 0.42));
    const dataBottom = Math.min(pageHeight, bottomEvidence + Math.max(phaseSpacing, rowSpacing * 0.42));
    return {
      columns,
      confidence: Math.min(0.94, Number(hint.confidence) || 0.88),
      headerBand: [0, 0, pageWidth, dataTop],
      dataBand: [0, dataTop, pageWidth, Math.max(1, dataBottom - dataTop)],
      rowSpacing,
      continuation: true,
    };
  }

  const CALIBRATION_HEADER_PATTERNS = Object.freeze({
    board_ref: [/BOARD.*(?:REF|ID)/, /ID.*(?:NO|NUMBER)/],
    board_type: [/BOARD.*TYPE/, /BOARD.*DESCRIPTION/, /BOARD.*NAME/],
    ways_total: [/NO.*OF.*WAYS/, /NUMBER.*OF.*WAYS/, /^WAYS$/],
    board_rating: [/BOARD.*RATING/],
    phase_config: [/BOARD.*PHASE/, /PHASE.*CONFIG/],
    supply_source: [/SUPPLIED.*FROM/, /FED.*FROM/, /SOURCE.*BOARD/],
    fault_rating: [/FAULT.*RATING/, /SHORT.*CIRCUIT.*RATING/],
    incomer_class: [/INCOMER.*(?:DEVICE|TYPE)/, /INCOMING.*(?:DEVICE|TYPE)/],
    incomer_rating: [/INCOMER.*RATING/, /INCOMING.*RATING/, /DEVICE.*RATING/],
  });

  function clampUnit(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function normalisedCalibrationBox(value) {
    if (!Array.isArray(value) || value.length < 4) return null;
    const x = clampUnit(value[0]); const y = clampUnit(value[1]);
    const width = Math.min(clampUnit(value[2]), 1 - x);
    const height = Math.min(clampUnit(value[3]), 1 - y);
    if (width <= 0 || height <= 0) return null;
    return [x, y, width, height];
  }

  function transformNormalisedBox(box, transform) {
    const [x, y, width, height] = box;
    if (transform === 'clockwise') return [1 - y - height, x, height, width];
    if (transform === 'counterclockwise') return [y, 1 - x - width, height, width];
    return [x, y, width, height];
  }

  function transformNormalisedPoint(point, transform) {
    const [x, y] = point;
    if (transform === 'clockwise') return [1 - y, x];
    if (transform === 'counterclockwise') return [y, 1 - x];
    return [x, y];
  }

  function calibrationRolePatterns(role) {
    return COLUMN_DEFINITIONS.find((definition) => definition.role === role)?.patterns
      || CALIBRATION_HEADER_PATTERNS[role] || [];
  }

  function calibrationTokenList(value) {
    const stop = new Set(['A', 'AN', 'AND', 'COLUMN', 'FIELD', 'NO', 'NUMBER', 'OF', 'THE', 'TYPE', 'VALUE']);
    return [...new Set(normaliseLabel(value).split(' ')
      .filter((token) => token.length >= 2 && !/^\d+(?:\.\d+)?$/.test(token) && !stop.has(token)))].slice(0, 12);
  }

  function calibrationCellScore(role, cell, signature = null) {
    const text = String(cell?.text || '');
    const normal = normaliseLabel(text);
    if (!normal) return 0;
    const patterns = calibrationRolePatterns(role);
    let score = patterns.some((pattern) => pattern.test(normal)) ? 6 : 0;
    const tokens = signature?.tokens || [];
    if (tokens.length) {
      const present = new Set(normal.split(' '));
      score += (tokens.filter((token) => present.has(token)).length / tokens.length) * 8;
    }
    if (role === 'way' && extractWayIdentifier(text) != null) score += 3;
    if (role === 'phase' && phaseValues(text).length) score += 3;
    if (role === 'device_class' && /\b(?:AFDD|RCBO|MCCB|MCB|ACB|RCCB|RCD|FUSE|ISOLATOR)\b/i.test(text)) score += 4;
    if (role === 'rating' && /\b\d+(?:\.\d+)?\s*A(?:MPS?)?\b/i.test(text)) score += 4;
    if (role === 'pole_configuration' && /\b(?:1P\s*\+\s*N|[1-4]P|SPN?|TPN?|3PH)\b/i.test(text)) score += 4;
    if (role === 'trip_curve' && /\b(?:TYPE|CURVE|CHARACTERISTIC)?\s*[BCD]\b/i.test(text)) score += 4;
    if (role === 'trip_unit' && canonicalTripUnit(text)) score += 5;
    if (role === 'product_range' && protectionProductRange(text)) score += 5;
    if (role === 'breaking_capacity' && /\b\d+(?:\.\d+)?\s*KA\b/i.test(text)) score += 4;
    if (role === 'rcd_ma' && /\b\d+(?:\.\d+)?\s*MA\b/i.test(text)) score += 4;
    if (role === 'rcd_type' && /\bTYPE\s+(?:AC|A|B|F)\b/i.test(text)) score += 4;
    if (role === 'rcd_arrangement' && /\b(?:INTEGRAL|SEPARATE|SHARED|UPSTREAM)\b/i.test(text)) score += 4;
    if (role === 'afdd' && /\bAFDD\b/i.test(text)) score += 4;
    if (role === 'occupancy' && /\b(?:SPARE|SPACE|BLANK|UNUSED)\b/i.test(text)) score += 4;
    return score;
  }

  function buildCalibrationSignature(input = {}, region = {}) {
    const width = Math.max(1, Number(input.pageWidth || input.width) || 1);
    const height = Math.max(1, Number(input.pageHeight || input.height) || 1);
    const box = bboxObject({ bbox: region.bbox });
    const words = collectSpatialWords(input);
    if (!box || !words.length) return null;
    const selected = wordsInsideCalibration(words, { box }, 1);
    if (!selected.length) return null;
    const cells = spatialRows(selected).flatMap((row) => row.cells || []);
    const role = String(region.role || '');
    const anchor = cells.slice().sort((left, right) => calibrationCellScore(role, right) - calibrationCellScore(role, left))[0]
      || sourceCell(selected, role);
    const anchorBox = bboxObject({ bbox: anchor?.bbox }) || box;
    const text = anchor?.text || selected.map((word) => word.text).join(' ');
    const aspect = (box.x1 - box.x0) / Math.max(1, box.y1 - box.y0);
    return {
      text: String(text).replace(/\s+/g, ' ').trim().slice(0, 240),
      tokens: calibrationTokenList(text),
      anchorNorm: [((anchorBox.x0 + anchorBox.x1) / 2) / width, ((anchorBox.y0 + anchorBox.y1) / 2) / height],
      axis: aspect >= 1.6 ? 'row' : (aspect <= 0.65 ? 'column' : 'auto'),
    };
  }

  function resolveCalibrationRegion(record = {}, input = {}) {
    const width = Math.max(1, Number(input.pageWidth || input.width) || 1);
    const height = Math.max(1, Number(input.pageHeight || input.height) || 1);
    const base = normalisedCalibrationBox(record.bboxNorm);
    if (!base) return null;
    const sourceOrientation = record.orientation
      || (Number(record.sourceWidth) >= Number(record.sourceHeight) ? 'landscape' : 'portrait');
    const targetOrientation = width >= height ? 'landscape' : 'portrait';
    const transforms = sourceOrientation && sourceOrientation !== targetOrientation
      ? ['clockwise', 'counterclockwise', 'identity'] : ['identity'];
    const candidates = transforms.map((transform, index) => ({
      norm: normalisedCalibrationBox(transformNormalisedBox(base, transform)),
      transform,
      preference: transforms.length - index,
      relocated: false,
    })).filter((candidate) => candidate.norm);
    const words = collectSpatialWords(input);
    if (words.length && Number(record.sourcePage) !== Number(input.documentPage || input.page)) {
      const cells = spatialRows(words).flatMap((row) => row.cells || []);
      const rankedCells = cells.map((cell) => ({ cell, box: bboxObject({ bbox: cell.bbox }),
        score: calibrationCellScore(record.role, cell, record.signature) }))
        .filter((candidate) => candidate.box && candidate.score >= 3)
        .sort((left, right) => right.score - left.score);
      const anchor = rankedCells[0];
      if (anchor) {
        const targetBox = anchor.box;
        const targetPoint = [((targetBox.x0 + targetBox.x1) / 2) / width, ((targetBox.y0 + targetBox.y1) / 2) / height];
        transforms.forEach((transform, index) => {
          const transformed = normalisedCalibrationBox(transformNormalisedBox(base, transform));
          const sourceAnchor = transformNormalisedPoint(record.signature?.anchorNorm || [base[0] + base[2] / 2, base[1] + base[3] / 2], transform);
          let relocated = normalisedCalibrationBox([
            targetPoint[0] - (sourceAnchor[0] - transformed[0]),
            targetPoint[1] - (sourceAnchor[1] - transformed[1]),
            transformed[2], transformed[3],
          ]);
          const definition = CALIBRATION_ROLE_DEFINITIONS.find((item) => item.role === record.role);
          if (relocated && definition?.kind === 'column') {
            const xTolerance = Math.max(relocated[2], 0.08);
            const columnEvidence = rankedCells.filter((candidate) => {
              const cx = ((candidate.box.x0 + candidate.box.x1) / 2) / width;
              return Math.abs(cx - targetPoint[0]) <= xTolerance;
            });
            if (columnEvidence.length) {
              const top = Math.min(relocated[1], ...columnEvidence.map((candidate) => candidate.box.y0 / height));
              const bottom = Math.max(relocated[1] + relocated[3], ...columnEvidence.map((candidate) => candidate.box.y1 / height));
              relocated = normalisedCalibrationBox([relocated[0], Math.max(0, top - 0.005), relocated[2], Math.min(1, bottom + 0.005) - Math.max(0, top - 0.005)]);
            }
          }
          if (relocated) candidates.push({ norm: relocated, transform, preference: transforms.length - index, relocated: true, anchorScore: anchor.score });
        });
      }
    }
    const scored = candidates.map((candidate) => {
      const bbox = [candidate.norm[0] * width, candidate.norm[1] * height, candidate.norm[2] * width, candidate.norm[3] * height];
      const box = bboxObject({ bbox });
      const inside = wordsInsideCalibration(words, { box }, 1);
      const cells = spatialRows(inside).flatMap((row) => row.cells || []);
      const semantic = Math.max(0, ...cells.map((cell) => calibrationCellScore(record.role, cell, record.signature)));
      const density = Math.min(3, inside.length / 4);
      return { ...candidate, bbox, score: semantic + density + (candidate.anchorScore || 0) + candidate.preference * 0.01 };
    }).sort((left, right) => right.score - left.score);
    const selected = scored[0];
    return selected ? {
      bbox: selected.bbox,
      projection: selected.relocated ? `semantic-${selected.transform}` : selected.transform,
      score: selected.score,
    } : null;
  }

  function calibrationRegions(input = {}) {
    return (input.calibrationHint?.regions || []).map((region) => {
      const box = bboxObject({ bbox: region?.bbox });
      const role = String(region?.role || '');
      const definition = CALIBRATION_ROLE_DEFINITIONS.find((item) => item.role === role);
      if (!box || !definition) return null;
      return { ...region, role, kind: definition.kind, axis: region.axis || 'auto', box };
    }).filter(Boolean);
  }

  function wordsInsideCalibration(words, region, padding = 0) {
    if (!region?.box) return [];
    const { x0, y0, x1, y1 } = region.box;
    return (words || []).filter((word) => word.cx >= x0 - padding && word.cx <= x1 + padding
      && word.cy >= y0 - padding && word.cy <= y1 + padding);
  }

  function wordsInsideCalibratedColumn(words, region, padding = 0) {
    if (!region?.box) return [];
    return (words || []).filter((word) => word.cx >= region.box.x0 - padding && word.cx <= region.box.x1 + padding);
  }

  function calibratedSchema(schema, input, words, wayAnchors, pageWidth, pageHeight) {
    const regions = calibrationRegions(input);
    const columnRegions = regions.filter((region) => CALIBRATION_COLUMN_ROLES.has(region.role) && region.axis !== 'row');
    const tableRegion = regions.find((region) => region.role === 'outgoing_table');
    const rowGroupRegion = regions.find((region) => region.role === 'outgoing_row_group');
    const layoutRegions = regions.filter((region) => CALIBRATION_LAYOUT_ROLES.has(region.role));
    if (!columnRegions.length && !tableRegion && !rowGroupRegion && !layoutRegions.length) return schema;
    const byRole = new Map((schema?.columns || []).map((column) => [column.role, { ...column }]));
    columnRegions.forEach((region) => {
      byRole.set(region.role, {
        role: region.role,
        x: (region.box.x0 + region.box.x1) / 2,
        left: region.box.x0,
        right: region.box.x1,
        evidence: null,
        source: 'user_calibration',
        calibrated: true,
      });
    });
    const columns = [...byRole.values()].filter((column) => Number.isFinite(column.x)).sort((left, right) => left.x - right.x);
    for (let index = 0; index < columns.length; index += 1) {
      if (columns[index].calibrated) continue;
      columns[index].left = index ? (columns[index - 1].x + columns[index].x) / 2 : 0;
      columns[index].right = index < columns.length - 1 ? (columns[index].x + columns[index + 1].x) / 2 : pageWidth;
    }
    const anchorYs = wayAnchors.map((word) => word.cy);
    const rowSpacing = rowGroupRegion ? Math.max(4, rowGroupRegion.box.y1 - rowGroupRegion.box.y0)
      : schema?.rowSpacing || median(anchorYs.slice(1).map((value, index) => value - anchorYs[index]).filter((value) => value > 2)) || 22;
    const dataTop = tableRegion?.box.y0 ?? schema?.dataBand?.[1]
      ?? (anchorYs.length ? Math.max(0, Math.min(...anchorYs) - rowSpacing * 0.55) : 0);
    const dataBottom = tableRegion?.box.y1 ?? (schema?.dataBand ? schema.dataBand[1] + schema.dataBand[3]
      : (anchorYs.length ? Math.min(pageHeight, Math.max(...anchorYs) + rowSpacing * 0.6) : pageHeight));
    const calibratedRoles = columnRegions.map((region) => region.role);
    const structuralRoles = new Set(columns.map((column) => column.role));
    const critical = structuralRoles.has('way') && structuralRoles.has('rating')
      && (structuralRoles.has('circuit_reference') || structuralRoles.has('description'));
    return {
      ...(schema || {}),
      columns,
      confidence: Math.max(Number(schema?.confidence) || 0, critical ? 0.94 : 0.78),
      headerBand: [0, 0, pageWidth, Math.max(0, dataTop)],
      dataBand: [tableRegion?.box.x0 ?? 0, dataTop,
        tableRegion ? Math.max(1, tableRegion.box.x1 - tableRegion.box.x0) : pageWidth,
        Math.max(1, dataBottom - dataTop)],
      rowSpacing,
      calibrationRoles: [...new Set([
        ...calibratedRoles,
        ...(tableRegion ? ['outgoing_table'] : []),
        ...(rowGroupRegion ? ['outgoing_row_group'] : []),
        ...layoutRegions.map((region) => region.role),
      ])],
      calibratedPhaseLayout: layoutRegions[layoutRegions.length - 1]?.role || null,
      calibrated: true,
    };
  }

  function cleanBoardReferenceField(value) {
    const source = String(value || '').replace(/\s+/g, ' ').trim();
    return source.replace(
      /^(?:(?:BOARD\s+DATA)\s*)?(?:(?:(?:DIST\s*\/\s*BD|DISTRIBUTION\s+BOARD|DB|BOARD)\s*(?:REF(?:ERENCE)?|IDENTITY))|(?:ID|IDENTIFICATION)\s*(?:NO\.?|NUMBER|REF(?:ERENCE)?)?)\s*[:#=\-]?\s*/i,
      '',
    ).trim();
  }

  function calibratedHeaderValue(role, text) {
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    if (!source) return null;
    const number = Number(source.match(/\d+(?:\.\d+)?/)?.[0]);
    if (role === 'board_ref') {
      const cleaned = cleanBoardReferenceField(source);
      if (!cleaned) return null;
      return Core.canonicalBoardReference(cleaned).display;
    }
    if (role === 'ways_total') return Number.isInteger(number) && number > 0 && number <= 200 ? number : null;
    if (role === 'board_rating' || role === 'incomer_rating' || role === 'fault_rating') {
      return Number.isFinite(number) && number > 0 ? number : null;
    }
    if (role === 'phase_config') {
      const token = source.toUpperCase().replace(/\s+/g, '');
      if (/TP&?N|TPN|3PH|THREEPHASE|L1.*L2.*L3/.test(token)) return 'TPN';
      if (/SP&?N|SPN|1PH|SINGLEPHASE/.test(token)) return 'SPN';
      return null;
    }
    if (role === 'incomer_class') return parseProtectionDescriptor(source).explicitDevice || source;
    return source;
  }

  function applyHeaderCalibrations(parsed, input, words) {
    const result = parsed || { header: {}, evidence: {} };
    result.header = result.header || {};
    result.evidence = result.evidence || {};
    const regions = calibrationRegions(input);
    const sectionRegions = regions.filter((region) => region.role === 'board_header' || region.role === 'incomer_section');
    for (const region of sectionRegions) {
      const regionWords = wordsInsideCalibration(words, region, Math.max(1, region.box.y1 - region.box.y0) * 0.02);
      const regionLines = spatialRows(regionWords).map((row) => sourceCell(row.words)).filter(Boolean);
      const section = Core.extractBoardHeader(regionLines);
      Object.entries(section.header || {}).forEach(([field, value]) => {
        if (value == null || value === '') return;
        result.header[field] = value;
        const source = section.evidence?.[field] || sourceCell(regionWords, field);
        if (source) result.evidence[field] = { ...source, extractionMethod: 'User layout calibration + spatial parser' };
      });
    }
    const phaseLayout = regions.filter((region) => CALIBRATION_LAYOUT_ROLES.has(region.role)).at(-1)?.role || null;
    if (phaseLayout) {
      const threePhase = phaseLayout === 'three_phase_rows' || phaseLayout === 'three_phase_merged';
      result.header.phase_config = threePhase ? 'TPN' : 'SPN';
      result.header.phase_count = threePhase ? 3 : 1;
      result.header.phase_layout_calibration = phaseLayout;
      const region = regions.filter((item) => item.role === phaseLayout).at(-1);
      const source = region ? sourceCell(wordsInsideCalibration(words, region, 1), 'phase_config') : null;
      result.evidence.phase_config = source
        ? { ...source, extractionMethod: 'User phase-layout calibration + spatial parser' }
        : { text: phaseLayout, originalText: phaseLayout, bbox: null, confidence: 1, extractionMethod: 'User phase-layout calibration', words: [] };
      result.evidence.phase_count = result.evidence.phase_config;
    }
    const fieldMap = {
      board_ref: 'board_ref', board_type: 'board_type_text', ways_total: 'ways_total', board_rating: 'board_rating_a', phase_config: 'phase_config',
      incomer_class: 'incomer_class', incomer_rating: 'incomer_rating_a', supply_source: 'fed_from_ref',
      supply_cable: 'supply_cable_details', fault_rating: 'fault_ka', location: 'location', purpose: 'purpose',
      metering: 'metering', board_model: 'board_model',
    };
    regions.filter((region) => CALIBRATION_HEADER_ROLES.has(region.role)).forEach((region) => {
      const cell = sourceCell(wordsInsideCalibration(words, region, Math.max(1, region.box.y1 - region.box.y0) * 0.03), region.role);
      if (!cell) return;
      const value = calibratedHeaderValue(region.role, cell.text);
      const field = fieldMap[region.role];
      if (!field || value == null || value === '') return;
      result.header[field] = value;
      result.evidence[field] = { ...cell, extractionMethod: 'User layout calibration + spatial parser' };
      if (region.role === 'phase_config') result.header.phase_count = value === 'TPN' ? 3 : 1;
      if (region.role === 'supply_source') result.header.supplied_from_text = value;
    });
    return result;
  }

  function columnCells(words, schema) {
    const assigned = Object.fromEntries(schema.columns.map((column) => [column.role, []]));
    for (const word of words) {
      const calibrated = schema.columns.filter((item) => item.calibrated && word.cx >= item.left && word.cx < item.right);
      if (calibrated.length) {
        calibrated.forEach((column) => assigned[column.role].push(word));
        continue;
      }
      const column = schema.columns.find((item) => !item.calibrated && word.cx >= item.left && word.cx < item.right)
        || schema.columns.slice().sort((a, b) => Math.abs(a.x - word.cx) - Math.abs(b.x - word.cx))[0];
      if (column) assigned[column.role].push(word);
    }
    return Object.fromEntries(Object.entries(assigned).map(([role, list]) => [role, sourceCell(list, role)]));
  }

  function numberValue(cell, { min = -Infinity, max = Infinity } = {}) {
    const match = String(cell?.text || '').match(/-?\d+(?:\.\d+)?/);
    const value = match ? Number(match[0]) : null;
    return Number.isFinite(value) && value >= min && Math.abs(value) <= max ? value : null;
  }

  function indicatorValue(cell) {
    const token = String(typeof cell === 'object' ? cell?.text || '' : cell ?? '').trim();
    if (!token) return null;
    if (/^(?:YES|Y|TRUE|1|CHECKED|TICK)$/i.test(token) || /[\u2713\u2714\u2611\uF0FC]/.test(token)) return true;
    if (/^(?:NO|N|FALSE|0|X|-|--)$/i.test(token) || /[\u00D7\u2715\u2716\u2610\uF0FB]/.test(token)) return false;
    return null;
  }

  function highlightBox(source, context = {}) {
    if (!source?.bbox) return null;
    const [x, y, width, height] = source.bbox.map(Number);
    if (!context.phaseLane || !Number.isFinite(context.laneTop) || !Number.isFinite(context.laneBottom)) {
      return [x, y, width, height];
    }
    const top = Math.max(y, context.laneTop);
    const bottom = Math.min(y + height, context.laneBottom);
    return bottom > top ? [x, top, width, bottom - top] : [x, y, width, height];
  }

  function protectionStandard(value) {
    const source = String(value || '').toUpperCase().replace(/\s+/g, ' ');
    const match = source.match(/\b(?:BS\s*(?:EN\s*)?)?(60898(?:-1)?|61009(?:-1)?|61008(?:-1)?|60947(?:\s*[-/]\s*[23])?|60974)\b/);
    if (!match) return { code: null, label: null };
    let code = match[1].replace(/\s+/g, '').replace('/', '-').replace(/-(?:1)$/, '');
    const correctedFrom = code === '60974' ? '60974' : null;
    if (correctedFrom) code = '60947';
    if (code === '60898-1') code = '60898';
    if (code === '61009-1') code = '61009';
    if (code === '61008-1') code = '61008';
    return { code, label: `BS EN ${code}`, correctedFrom };
  }

  function canonicalTripUnit(value) {
    const source = String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
    const compact = source.replace(/[^A-Z0-9]+/g, '');
    if (/\bLSIG\b/.test(source) || compact === 'LSIG') return 'LSIG';
    if (/\bLSNI\b/.test(source) || compact === 'LSNI') return 'LSNI';
    if (/\bLSI\b/.test(source) || compact === 'LSI') return 'LSI';
    if (/\bATFM\b/.test(source) || compact === 'ATFM') return 'ATFM';
    if (/\bATAM\b/.test(source) || compact === 'ATAM') return 'ATAM';
    if (/\bTM(?:\s*[-/]?\s*D)?\b/.test(source) || /THERMAL\s*[- ]?\s*MAGNETIC/.test(source)
      || compact === 'TM' || compact === 'TMD') return 'TM';
    if (/\bLI\b/.test(source) || compact === 'LI') return 'LI';
    return null;
  }

  function protectionProductRange(value) {
    const source = String(value || '').toUpperCase().replace(/\s+/g, ' ');
    const tokens = [];
    const add = (token) => { if (token && !tokens.includes(token)) tokens.push(token); };
    if (/\bH\s*3\s*\+(?!\w)/i.test(source)) add('H3+');
    for (const match of source.matchAll(/\b([XP])\s*(\d{2,4})\b/gi)) add(`${match[1].toUpperCase()}${match[2]}`);
    return tokens.length ? tokens.join(' / ') : null;
  }

  function parseProtectionDescriptor(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const standard = protectionStandard(text);
    const explicit = text.match(/\b(AFDD\s*\+\s*RCBO|RCBO|MCCB|MCB|ACB|RCCB|RCD|HRC\s+FUSE|FUSE|SWITCH\s+DISCONNECTOR|ISOLATOR)\b/i)?.[1] || null;
    const rating = Number(text.match(/\b(\d+(?:\.\d+)?)\s*A(?:MPS?)?\b/i)?.[1]) || null;
    const tripUnit = canonicalTripUnit(text)
      || text.match(/\bMICROLOGIC\s*([0-9]+(?:\.[0-9]+)?)\b/i)?.[1]
      || text.match(/\b(ELECTRONIC\s+TRIP(?:\s+UNIT)?)\b/i)?.[1]
      || null;
    const productRange = protectionProductRange(text);
    const curve = (text.match(/\b(?:TYPE|CURVE|CHARACTERISTIC)\s*([BCD])\b/i)?.[1]
      || text.match(/\b([BCD])\s*CURVE\b/i)?.[1] || '').toUpperCase() || null;
    const breakingCapacityKa = Number(text.match(/\b(\d+(?:\.\d+)?)\s*KA\b/i)?.[1]) || null;
    const sensitivityMa = Number(text.match(/\b(\d+(?:\.\d+)?)\s*MA\b/i)?.[1]) || null;
    const rcdType = text.match(/\bTYPE\s+(AC|A|B|F)\b/i)?.[1]?.toUpperCase() || null;
    const poleToken = text.match(/\b(1P\s*\+\s*N|3\s*[-/]\s*4P|4P|3P|2P|1P|TPN|TP|SPN|SP)\b/i)?.[1]
      ?.toUpperCase().replace(/\s+/g, '') || null;
    const poles = poleToken && /^(?:3-4P|4P|3P|TPN|TP)$/.test(poleToken) ? 3
      : (poleToken && /^(?:2P)$/.test(poleToken) ? 2
        : (poleToken && /^(?:1P\+N|1P|SPN|SP)$/.test(poleToken) ? 1 : null));
    const poleConfiguration = poles === 3 ? 'TP' : (poles === 2 ? 'DP' : (poles === 1 ? 'SP' : null));
    return {
      text, standardCode: standard.code, protectionStandard: standard.label, explicitDevice: explicit,
      rating, tripUnit, productRange, curve, breakingCapacityKa, sensitivityMa, rcdType, poleToken, poles, poleConfiguration,
    };
  }

  function resolveProtectionDevice(fields = {}, context = {}) {
    const standard = protectionStandard(fields.standard || fields.protectionStandard);
    const explicitText = String(fields.deviceClass || '');
    const explicit = explicitText.match(/\b(AFDD\s*\+\s*RCBO|RCBO|MCCB|MCB|ACB|RCCB|RCD|FUSE|SWITCH\s+DISCONNECTOR|ISOLATOR)\b/i)?.[1]?.toUpperCase() || null;
    const tripUnit = String(fields.tripUnit || '').trim();
    const standardDevice = {
      '60898': 'MCB',
      '61009': 'RCBO',
      '61008': 'RCD',
      '60947-2': 'MCCB',
      '60947-3': 'Isolator',
    }[standard.code] || null;
    let device = null; let confidence = 0.55; let classBasis = null; let classConflict = null; const reasons = [];
    if (standard.correctedFrom) reasons.push(`Normalised ${standard.correctedFrom} to ${standard.code}`);
    if (explicit) {
      device = explicit === 'RCCB' ? 'RCD' : explicit.replace(/\s+/g, ' ');
      classBasis = 'explicit';
      confidence = 0.96; reasons.push('Explicit device class');
      const compatibleIndustrialMcb = device === 'MCB' && standard.code === '60947-2';
      if (standardDevice && String(device).toUpperCase() !== String(standardDevice).toUpperCase()
        && !compatibleIndustrialMcb) {
        classConflict = {
          explicit: device,
          standardCode: standard.code,
          standardDevice,
          reason: `Explicit ${device} conflicts with ${standard.label}, which normally identifies ${standardDevice}`,
        };
        confidence = Math.min(confidence, 0.72);
        reasons.push(classConflict.reason);
      }
    } else if (standard.code === '60898') {
      classBasis = 'bs_en';
      device = 'MCB'; confidence = 0.97; reasons.push('BS EN 60898');
    } else if (standard.code === '61009') {
      classBasis = 'bs_en';
      device = 'RCBO'; confidence = 0.97; reasons.push('BS EN 61009');
    } else if (standard.code === '61008') {
      classBasis = 'bs_en';
      device = 'RCD'; confidence = 0.97; reasons.push('BS EN 61008');
    } else if (standard.code === '60947-2') {
      classBasis = 'bs_en';
      device = 'MCCB'; confidence = 0.97; reasons.push('BS EN 60947-2');
    } else if (standard.code === '60947-3') {
      classBasis = 'bs_en';
      device = 'Isolator'; confidence = 0.97; reasons.push('BS EN 60947-3');
    } else if (standard.code === '60947' && (/^(?:\d+(?:\.\d+)?)$/i.test(tripUnit)
      || /^(?:TM|LSI|LSIG|LSNI|ATFM|ATAM|LI)$/i.test(canonicalTripUnit(tripUnit) || '')
      || /MICROLOGIC|MCCB/i.test(context.boardProtectionText || ''))) {
      classBasis = 'bs_en_context';
      device = 'MCCB'; confidence = 0.91; reasons.push('BS 60947 with MCCB trip-unit evidence');
    } else if (fields.rcdProtected === true && Number(fields.rating) > 0
      && !explicit && !['separate', 'shared', 'upstream'].includes(fields.rcdArrangement)) {
      classBasis = 'derived_rcd';
      device = fields.afdd === true ? 'AFDD+RCBO' : 'RCBO';
      confidence = 0.9;
      reasons.push('Rated outgoing CPD with explicit row-level RCD protection');
    }
    if (/^AFDD\s*\+\s*RCBO$/i.test(device || '')) device = 'AFDD+RCBO';
    if (device === 'RCBO' && fields.afdd === true && fields.afddArrangement !== 'separate') {
      device = 'AFDD+RCBO';
      classBasis = 'derived_afdd';
      reasons.push('RCBO with row-level AFDD protection');
    }
    return {
      device, classBasis, confidence, reasons, classConflict,
      standardCode: standard.code, protectionStandard: standard.label,
    };
  }

  function classifyBoardFamily(header = {}, options = {}) {
    const policy = { ...DEFAULT_BOARD_CLASSIFICATION_POLICY, ...(options.policy || {}) };
    const devices = options.devices || [];
    const text = [header.board_type_text, header.description, header.purpose, header.board_model, header.size_text]
      .filter(Boolean).join(' ').toUpperCase();
    const rating = Number(header.internal_isolator_rating_a ?? header.board_rating_a ?? header.incomer_rating_a ?? header.supply_cpd_rating_a);
    const phaseConfig = String(header.phase_config || '').toUpperCase();
    const reasons = []; let family = 'unknown'; let confidence = 0.45; let requiresReview = false;
    if (/CONSUMER\s+UNIT|\bCU\b/.test(text)) {
      family = 'consumer_unit'; confidence = 0.99; reasons.push('Explicit consumer-unit identity');
    } else if (/PANEL\s*BOARD|PANELBOARD|MCCB\s+PANEL/.test(text)) {
      family = 'panelboard'; confidence = 0.99; reasons.push('Explicit panelboard identity');
    } else if (/SWITCH\s*BOARD|\bMSB\b|MAIN\s+LV\s+PANEL/.test(text)) {
      family = 'switchboard'; confidence = 0.98; reasons.push('Explicit switchboard identity');
    } else if (Number.isFinite(rating) && rating >= policy.panelboardMinAmps) {
      family = 'panelboard'; confidence = 0.92;
      reasons.push(`${policy.id}: ${rating}A meets panelboard threshold`);
      if (/DISTRIBUTION\s+BOARD/.test(text)) requiresReview = true;
    } else {
      const active = devices.filter((row) => Core.isPopulatedProtectionRow
        ? Core.isPopulatedProtectionRow(row) : row && !row.space && !row.spare);
      const finalCircuitRatio = active.length ? active.filter((row) => !row.circuitReference && Number(row.rating) <= 63).length / active.length : 0;
      if (Number.isFinite(rating) && rating <= policy.consumerUnitMaxAmps && phaseConfig === 'SPN' && finalCircuitRatio >= 0.65) {
        family = 'consumer_unit'; confidence = 0.78; reasons.push('Single-phase final-circuit context within consumer-unit policy');
      } else if (Number.isFinite(rating) && rating >= policy.distributionBoardMinAmps && rating <= policy.distributionBoardMaxAmps) {
        family = 'distribution_board'; confidence = 0.86; reasons.push(`${policy.id}: rating within distribution-board range`);
      } else if (/\bDB\b|DISTRIBUTION\s+BOARD|LIGHTING\s*(?:&|AND)\s*POWER\s+(?:BOARD|PANEL)/.test(text)
        || /^DB/i.test(header.board_ref || '') || /(?:^|[-_/])L\s*&\s*P(?:[-_/]|$)/i.test(header.board_ref || '')) {
        family = 'distribution_board'; confidence = 0.68; reasons.push('Distribution-board identity without decisive rating evidence');
      }
    }
    return { family, confidence, reasons, policyId: policy.id, ratingA: Number.isFinite(rating) ? rating : null, requiresReview };
  }

  function familyTypeCode(family) {
    return { panelboard: 'PB', switchboard: 'SB', consumer_unit: 'CU', distribution_board: 'DB' }[family] || 'UNK';
  }

  function extractContextualBoardReferences(lines, options = {}) {
    const sourceLines = (lines || []).map((line, index) => ({ index, text: String(line?.text ?? line ?? '').replace(/\s+/g, ' ').trim() })).filter((line) => line.text);
    const combined = sourceLines.map((line) => line.text).join('\n');
    const pageType = String(options.pageType || '').toLowerCase();
    const isSchedule = options.isSchedule ?? /schedule/.test(pageType);
    const isSchematic = /^(?:sld|schematic)$/.test(pageType);
    const isIndex = /\b(?:SUMMARY|BOARD|DISTRIBUTION\s+BOARD)\s+INDEX\b/i.test(combined);
    const primaryMatch = combined.match(/\b(?:DIST\s*\/\s*BD|DISTRIBUTION\s+BOARD|DB|BOARD)\s*(?:REF(?:ERENCE)?|IDENTITY)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/._-]{2,30})/i);
    const primaryNorm = primaryMatch ? Core.normaliseBoardReference(primaryMatch[1]) : null;
    const found = [];
    for (const line of sourceLines) {
      for (const ref of Core.extractBoardReferences(line.text)) {
        let role = 'mention';
        if (ref.normalised === primaryNorm) role = 'primary_board';
        else if (isIndex) role = 'index_board';
        else if (isSchematic) role = 'schematic_node';
        else if (isSchedule) role = 'circuit_reference';
        const key = `${ref.normalised}:${role}`;
        if (!found.some((item) => item.key === key)) found.push({ key, role, original: ref.original, normalised: ref.normalised, line: line.index });
      }
    }
    if (primaryMatch && !found.some((item) => item.role === 'primary_board')) {
      found.unshift({ key: `${primaryNorm}:primary_board`, role: 'primary_board', original: primaryMatch[1], normalised: primaryNorm, line: null });
    }
    return found.map(({ key, ...item }) => item);
  }

  function headerLines(input, words, dataTop) {
    const supplied = (input.lines || []).map((line) => ({
      text: String(line?.text ?? line ?? '').replace(/\s+/g, ' ').trim(),
      bbox: line?.bbox || null,
      confidence: Number(line?.confidence ?? 1),
      extractionMethod: line?.extractionMethod || (line?.ocr ? 'OCR' : 'Embedded text'),
    })).filter((line) => line.text);
    if (supplied.length) return supplied;
    return spatialRows(words.filter((word) => word.cy < dataTop)).map((row) => sourceCell(row.words)).filter(Boolean);
  }

  function extractSpatialBoardHeader(input, words, schema) {
    const lines = headerLines(input, words, schema?.dataBand?.[1] ?? Infinity);
    const parsed = applyHeaderCalibrations(Core.extractBoardHeader(lines), input, words);
    const references = extractContextualBoardReferences(lines, { pageType: input.pageType, isSchedule: true });
    const primary = references.find((reference) => reference.role === 'primary_board');
    if (!parsed.header.board_ref && primary) parsed.header.board_ref = primary.original;
    const descriptor = parseProtectionDescriptor(parsed.header.supply_cpd_details || '');
    if (descriptor.explicitDevice && !parsed.header.supply_cpd_class) parsed.header.supply_cpd_class = descriptor.explicitDevice;
    if (descriptor.rating && parsed.header.supply_cpd_rating_a == null) parsed.header.supply_cpd_rating_a = descriptor.rating;
    if (descriptor.protectionStandard && !parsed.header.supply_cpd_standard) parsed.header.supply_cpd_standard = descriptor.protectionStandard;
    if (descriptor.tripUnit && !parsed.header.supply_cpd_trip_unit) parsed.header.supply_cpd_trip_unit = descriptor.tripUnit;
    return { ...parsed, lines, references };
  }

  function cellText(cells, role) {
    return String(cells[role]?.text || '').trim();
  }

  function phaseValues(value) {
    const explicit = Core.explicitPhaseEvidence?.(value);
    if (explicit?.phases?.length === 3) return explicit.phases.slice();
    const source = String(value || '').toUpperCase().replace(/\s+/g, '');
    if (/L1(?:-|–|—|TO)L3|L1\/L2\/L3|3PH|THREEPHASE|TP&?N/.test(source)) return ['L1', 'L2', 'L3'];
    return [...new Set((source.match(/L[123]/g) || []).map((phase) => phase.toUpperCase()))];
  }

  function parseSpatialRow(cells, schemaConfidence, context = {}) {
    const way = extractWayIdentifier(cellText(cells, 'way'));
    if (way == null) return null;
    const allText = Object.values(cells).filter(Boolean).map((cell) => cell.text).join(' ');
    const uniquePhases = phaseValues(cellText(cells, 'phase'));
    const standardText = cellText(cells, 'device_standard');
    const deviceClassText = cellText(cells, 'device_class');
    const typeText = cellText(cells, 'trip_unit');
    const typeDevice = typeText.match(/^\s*(AFDD\s*\+\s*RCBO|RCBO|MCCB|MCB|ACB|RCCB|RCD|FUSE|ISOLATOR)\s*$/i)?.[1] || null;
    const resolvedDeviceClassText = deviceClassText || typeDevice || '';
    const typeCurve = typeDevice ? null : typeText.match(/^\s*([BCD])\s*$/i)?.[1]?.toUpperCase() || null;
    const tripUnit = typeCurve || typeDevice ? null
      : (parseProtectionDescriptor(typeText).tripUnit || (/^\d+(?:\.\d+)?$/.test(typeText) ? typeText : null));
    const productRange = protectionProductRange([standardText, deviceClassText, typeText, cellText(cells, 'product_range'), allText].join(' '));
    let curve = (cellText(cells, 'trip_curve').match(/\b[BCD]\b/i)?.[0] || typeCurve || '').toUpperCase() || null;
    const rating = numberValue(cells.rating, { max: 6300 });
    const ka = numberValue(cells.breaking_capacity, { max: 150 });
    const circuitBaseText = cellText(cells, 'circuit_reference');
    const spdCellText = cellText(cells, 'spd');
    const spdDescriptionOverflow = spdCellText && indicatorValue(cells.spd) == null
      && !/\b(?:SPD|SURGE\s+PROTECTION|TYPE\s*[12]|T[12])\b/i.test(spdCellText)
      ? spdCellText : '';
    const circuitText = [circuitBaseText, spdDescriptionOverflow].filter(Boolean).join(' ').trim();
    const detectedReference = Core.extractBoardReferences(circuitText)[0] || null;
    const circuitReference = detectedReference?.original || null;
    const descriptionCellText = cellText(cells, 'description');
    const description = descriptionCellText || circuitText || '';
    const occupancyLabels = new Set([
      descriptionCellText, circuitText, deviceClassText, standardText, typeText, cellText(cells, 'occupancy'),
    ].map((value) => Core.occupancyLabel?.(value)).filter(Boolean));
    const spareText = occupancyLabels.has('spare');
    const explicitSpace = occupancyLabels.has('space');
    const rcdRaw = numberValue(cells.rcd_ma, { min: 0.001, max: 1000 });
    const rcdMa = rcdRaw != null && rcdRaw < 1 ? Math.round(rcdRaw * 1000) : rcdRaw;
    const rcdIndicator = indicatorValue(cells.rcd);
    const textualRcdProtection = /\b(?:C\s*\/\s*W|WITH)\s+RCD\b/i.test(allText);
    const dedicatedRcdTypeText = [cellText(cells, 'rcd_type'), cellText(cells, 'rcd')].filter(Boolean).join(' ');
    const rcdType = dedicatedRcdTypeText.match(/\b(?:RCD\s*)?(?:TYPE\s*)?(AC|A|B|F)\b/i)?.[1]?.toUpperCase() || null;
    const rcdArrangementText = cellText(cells, 'rcd_arrangement').toLowerCase();
    const rcdArrangement = rcdArrangementText.match(/\b(integral|separate|shared|upstream)\b/)?.[1] || null;
    const rcdProtected = rcdIndicator === true || rcdMa != null || textualRcdProtection || Boolean(rcdType || rcdArrangement) ? true : rcdIndicator;
    const afddIndicator = indicatorValue(cells.afdd);
    const earthFaultText = cellText(cells, 'earth_fault_device');
    const arcFlashText = cellText(cells, 'arc_flash_device');
    const resolution = resolveProtectionDevice({
      standard: standardText,
      deviceClass: resolvedDeviceClassText,
      tripUnit,
      rating,
      description,
      rcdProtected,
      sensitivityMa: rcdMa,
      afdd: afddIndicator === true,
    }, context);
    const inferredCurve = inferredDistributionCurve(context.boardHeader, resolution.device, curve);
    if (inferredCurve) curve = inferredCurve.curve;
    const hasDeviceEvidence = Boolean(resolution.device || rating != null || standardText || resolvedDeviceClassText);
    const occupancyConflict = occupancyLabels.size > 1;
    const spare = spareText;
    const space = explicitSpace || (!spare && !hasDeviceEvidence && !description);
    const calibratedPole = parseProtectionDescriptor(cellText(cells, 'pole_configuration'));
    const poles = calibratedPole.poles != null ? calibratedPole.poles
      : (uniquePhases.length >= 3 && hasDeviceEvidence ? 3
        : (uniquePhases.length === 1 && hasDeviceEvidence ? 1 : null));
    const phase = poles === 3 ? '3PH' : (uniquePhases.length === 1 ? uniquePhases[0] : null);
    const circuitTypeRaw = cellText(cells, 'circuit_type').toUpperCase();
    const circuitConfig = /^(?:RD|RAD|RADIAL)$/.test(circuitTypeRaw) ? 'RADIAL' : (/^(?:RG|RING)$/.test(circuitTypeRaw) ? 'RING' : null);
    const liveCsa = numberValue(cells.line_csa, { max: 1000 });
    const cpcCsa = numberValue(cells.cpc_csa, { max: 1000 });
    const cableType = cellText(cells, 'cable_type') || null;
    const referenceMethod = cellText(cells, 'install_method') || null;
    const installMethod = cableType || referenceMethod;
    const confidence = Math.min(resolution.confidence || 0.55, schemaConfidence || 0.55,
      ...Object.values(cells).filter(Boolean).map((cell) => Number(cell.confidence) || 0.6));
    const requiresReview = Boolean(inferredCurve) || space || occupancyConflict || (!spare && (!resolution.device || rating == null
      || ((resolution.device === 'RCBO' || resolution.device === 'AFDD+RCBO') && rcdMa == null))) || confidence < 0.78;
    const rowCells = Object.entries(cells)
      .filter(([role, cell]) => Boolean(cell) && !(context.phaseLane && role === 'way'))
      .map(([, cell]) => cell);
    const source = sourceCell(rowCells.flatMap((cell) => cell.words || []), 'row');
    const protectionReasons = [];
    if (rcdIndicator === true) protectionReasons.push('Explicit RCD protection indicator');
    if (rcdMa != null) protectionReasons.push('RCD operating-current value present');
    if (rcdIndicator === false && rcdMa == null) protectionReasons.push('Explicit no-RCD indicator');
    if (afddIndicator === true) protectionReasons.push('Explicit AFDD indicator');
    if (spareText && hasDeviceEvidence) protectionReasons.push('Explicit fitted-spare label with populated device cells');
    if (occupancyConflict) protectionReasons.push('Conflicting SPARE and SPACE occupancy cells');
    if (inferredCurve) protectionReasons.push(inferredCurve.reason);
    const row = {
      way, phase, rating, device: resolution.device, class_basis: resolution.classBasis, curve, tripUnit, productRange,
      curveInferred: Boolean(inferredCurve),
      poleConfiguration: poles === 3 ? 'TP' : (poles === 2 ? 'DP' : (poles === 1 ? 'SP' : null)),
      protectionStandard: resolution.protectionStandard, protectionStandardCode: resolution.standardCode,
      sens: rcdMa, rcdProtected, rcdType, rcdArrangement,
      afdd: afddIndicator === true, afddIndicated: afddIndicator, poles, ka,
      earthFaultDevice: earthFaultText && !/^(?:NO|NONE|N\/A|NA|-|--)$/i.test(earthFaultText)
        ? { descriptor: earthFaultText } : null,
      arcFlashDevice: arcFlashText && !/^(?:NO|NONE|N\/A|NA|-|--)$/i.test(arcFlashText) ? arcFlashText : null,
      desc: description, circuitReference, circuitReferenceText: circuitText || null, circuitConfig,
      associatedDevices: (() => {
        const equipment = Core.extractAssociatedEquipment(description);
        const addCalibratedEquipment = (role, device) => {
          const text = cellText(cells, role);
          const indicator = indicatorValue(cells[role]);
          if (indicator === false || !text || /^(?:NO|NONE|N\/A|NA|-|--)$/i.test(text)) return;
          if (!equipment.some((item) => item.device === device)) equipment.push({ device, qty: 1 });
        };
        addCalibratedEquipment('contactor', 'Contactor');
        addCalibratedEquipment('epo', 'Emergency power off');
        addCalibratedEquipment('spd', 'Surge protection device');
        return equipment;
      })(),
      cable: (liveCsa != null || cpcCsa != null || cableType || installMethod) ? {
        orig: [liveCsa != null ? `${liveCsa}mm2` : null, cpcCsa != null ? `CPC ${cpcCsa}mm2` : null, cableType].filter(Boolean).join(' '),
        size: liveCsa, cpc: cpcCsa, typeCode: cableType,
        install_method: installMethod, reference_method: referenceMethod,
      } : null,
      spare, space, incomer: false, qty: space ? 0 : (hasDeviceEvidence ? 1 : 0),
      occupies_ways: poles === 3 ? 3 : (poles === 2 ? 2 : 1),
      sharedPhaseSpan: poles === 3 && !context.phaseLane,
      phaseSlotIndependent: poles === 1 && Boolean(context.phaseLane),
      poleEvidenceBasis: poles === 3 && !context.phaseLane
        ? 'explicit_or_merged_phase_span'
        : (poles === 1 && context.phaseLane ? 'bounded_phase_lane' : null),
      inferredDevice: resolution.confidence < 0.9,
      requiresReview,
      resolutionSource: 'spatial_column_schema',
      resolutionReasons: [...resolution.reasons, ...protectionReasons],
      srcText: source?.text || allText,
      sourceCell: source,
      highlightBbox: highlightBox(source, context),
      fieldSources: {
        way: cells.way || source,
        phase: cells.phase || source,
        device: cells.device_class || cells.device_standard || source,
        protectionStandard: cells.device_standard || source,
        tripUnit: cells.trip_unit || source,
        productRange: cells.product_range || cells.device_class || cells.trip_unit || source,
        rating: cells.rating || source,
        curve: cells.trip_curve || cells.trip_unit || source,
        breakingCapacity: cells.breaking_capacity || source,
        poles: cells.pole_configuration || cells.phase || cells.way || source,
        rcdProtection: cells.rcd || cells.rcd_ma || source,
        rcdSensitivity: cells.rcd_ma || cells.rcd || source,
        rcdType: cells.rcd_type || cells.rcd || source,
        rcdArrangement: cells.rcd_arrangement || cells.rcd || source,
        afdd: cells.afdd || source,
        earthFaultDevice: cells.earth_fault_device || source,
        arcFlashDevice: cells.arc_flash_device || source,
        circuitReference: cells.circuit_reference || cells.description || source,
        description: cells.description || cells.circuit_reference || source,
        installMethod: cells.install_method || source,
      },
      conf: confidence,
    };
    return Core.reconcileRowOccupancy ? Core.reconcileRowOccupancy(row) : row;
  }

  function physicalPhaseLanes(words, schema) {
    const phaseColumn = schema.columns.find((column) => column.role === 'phase');
    const candidates = words.filter((word) => extractPhase(word.text)
      && (!phaseColumn || (word.cx >= phaseColumn.left && word.cx < phaseColumn.right)))
      .sort((a, b) => a.cy - b.cy || b.confidence - a.confidence);
    const medianHeight = median(candidates.map((word) => word.height)) || 8;
    const tolerance = Math.max(2, Math.min(6, medianHeight * 0.42));
    const lanes = [];
    for (const word of candidates) {
      const lane = lanes.find((item) => Math.abs(item.cy - word.cy) <= tolerance);
      if (!lane) {
        lanes.push({ cy: word.cy, words: [word], word, printedPhase: extractPhase(word.text) });
        continue;
      }
      lane.words.push(word);
      lane.cy = lane.words.reduce((sum, item) => sum + item.cy, 0) / lane.words.length;
      if (word.confidence > lane.word.confidence) {
        lane.word = word;
        lane.printedPhase = extractPhase(word.text);
      }
    }
    return lanes.sort((a, b) => a.cy - b.cy);
  }

  function inferPhaseLaneModel(words, wayAnchors, schema, boardHeader = {}) {
    const ys = wayAnchors.map((word) => word.cy);
    const sequences = new Map();
    for (let index = 0; index < wayAnchors.length; index += 1) {
      const top = index ? (ys[index - 1] + ys[index]) / 2 : schema.dataBand[1];
      const bottom = index < wayAnchors.length - 1
        ? (ys[index] + ys[index + 1]) / 2
        : schema.dataBand[1] + schema.dataBand[3];
      const lanes = physicalPhaseLanes(words.filter((word) => word.cy >= top && word.cy < bottom), schema);
      const labels = lanes.map((lane) => lane.printedPhase);
      if (labels.length !== 3 || new Set(labels).size !== 3 || labels.some((label) => !/^L[123]$/.test(label || ''))) continue;
      const key = labels.join('|');
      sequences.set(key, (sequences.get(key) || 0) + 1);
    }
    const dominant = [...sequences.entries()].sort((left, right) => right[1] - left[1])[0] || null;
    const phaseColumnEvidence = schema.columns.find((column) => column.role === 'phase')?.evidence?.text || '';
    const explicitColumnSequence = phaseValues(phaseColumnEvidence);
    const headerText = Object.values(boardHeader || {}).filter((value) => typeof value === 'string').join(' ');
    const headerSupportsThreePhase = boardHeader.phase_count === 3 || boardHeader.phase_config === 'TPN'
      || /\b(?:TPN|TP\s*&\s*N|3\s*PHASE|THREE\s*PHASE)\b/i.test(headerText);
    return {
      expectedSequence: dominant ? dominant[0].split('|')
        : (explicitColumnSequence.length === 3 ? explicitColumnSequence : ['L1', 'L2', 'L3']),
      sequenceSupport: dominant ? dominant[1] : 0,
      explicitColumnSequence: explicitColumnSequence.length === 3,
      headerSupportsThreePhase,
    };
  }

  function reconcilePhaseLanes(lanes, context = {}) {
    const model = context.phaseLaneModel || {};
    const expected = Array.isArray(model.expectedSequence) && model.expectedSequence.length === 3
      ? model.expectedSequence : ['L1', 'L2', 'L3'];
    const printed = lanes.map((lane) => lane.printedPhase);
    const repeatedLabels = new Set(printed).size < printed.length;
    const supported = Number(model.sequenceSupport || 0) > 0 || Boolean(model.explicitColumnSequence);
    const repair = lanes.length === 3 && repeatedLabels && supported
      && printed.some((label, index) => label !== expected[index]);
    const unresolvedConflict = lanes.length === 3 && repeatedLabels && !repair;
    return lanes.map((lane, index) => ({
      ...lane,
      phase: repair ? expected[index] : lane.printedPhase,
      phaseRepair: repair && lane.printedPhase !== expected[index] ? {
        original: lane.printedPhase,
        inferred: expected[index],
        reason: model.sequenceSupport
          ? `Three physical phase lanes conflict with the repeated printed labels; ${expected.join('/')} is the dominant sequence elsewhere on this page`
          : `Three physical phase lanes conflict with the repeated printed labels; the phase-column header explicitly defines ${expected.join('/')}`,
        confidence: model.sequenceSupport ? 0.84 : 0.76,
      } : null,
      phaseConflict: unresolvedConflict ? {
        original: printed.join('/'),
        reason: `Three physical phase lanes contain conflicting repeated labels (${printed.join('/')}); no same-document evidence proves a replacement sequence`,
        confidence: 0.55,
      } : null,
    }));
  }

  function interpretedPhaseCell(lanes) {
    const cell = sourceCell(lanes.flatMap((lane) => lane.words || [lane.word]), 'phase');
    if (!cell) return null;
    const repairs = lanes.map((lane) => lane.phaseRepair).filter(Boolean);
    if (!repairs.length) return cell;
    cell.originalText = lanes.map((lane) => lane.printedPhase).join(' ');
    cell.text = lanes.map((lane) => lane.phase).join(' ');
    cell.extractionMethod = 'Spatial table parser + structural phase reconciliation';
    cell.correction = {
      original: cell.originalText,
      corrected: cell.text,
      reason: repairs[0].reason,
      confidence: Math.min(...repairs.map((repair) => repair.confidence)),
    };
    cell.confidence = Math.min(Number(cell.confidence) || cell.correction.confidence, cell.correction.confidence);
    return cell;
  }

  function applyPhaseReconciliation(row, repair, conflict, phaseCell) {
    if (!row || (!repair && !conflict)) return row;
    if (repair) row.phaseRepair = { ...repair };
    if (conflict) row.phaseConflict = { ...conflict };
    const issue = repair || conflict;
    row.requiresReview = true;
    row.conf = Math.min(Number(row.conf) || issue.confidence, issue.confidence);
    row.resolutionReasons = [...(row.resolutionReasons || []), issue.reason];
    row.fieldSources = { ...(row.fieldSources || {}), phase: phaseCell || row.fieldSources?.phase };
    return row;
  }

  function parseSpatialWayRows(rowWords, wayAnchor, top, bottom, schema, context) {
    const physicalLanes = physicalPhaseLanes(rowWords, schema);
    const phases = reconcilePhaseLanes(physicalLanes, context);
    const phaseWords = phases.flatMap((item) => item.words || [item.word]);
    const phaseGaps = phases.slice(1).map((item, index) => item.cy - phases[index].cy).filter((gap) => gap > 2);
    const phaseSpacing = median(phaseGaps)
      || Math.max(8, Number(schema.rowSpacing || 0) / 3)
      || Math.max(...phases.map((item) => item.word.height || 0), 8);
    const evidenceTop = phases.length >= 2 ? Math.max(top, phases[0].cy - phaseSpacing / 2) : top;
    const evidenceBottom = phases.length >= 2 ? Math.min(bottom, phases[phases.length - 1].cy + phaseSpacing / 2) : bottom;
    const evidenceWords = phases.length >= 2
      ? rowWords.filter((word) => word.cy >= evidenceTop && word.cy < evidenceBottom)
      : rowWords;
    const aggregateCells = columnCells(evidenceWords, schema);
    aggregateCells.way = sourceCell([wayAnchor], 'way');
    if (phaseWords.length) {
      const printedPhaseCell = aggregateCells.phase;
      const interpreted = interpretedPhaseCell(phases);
      // Narrow phase cells often wrap L1-L3 as separate "L1-" and "L3"
      // text fragments. Preserve that complete bounded cell instead of
      // replacing it with the one fragment recognised as a physical lane.
      const printedValues = phaseValues(printedPhaseCell?.text);
      const interpretedValues = phaseValues(interpreted?.text);
      aggregateCells.phase = printedValues.length >= 3 && interpretedValues.length < 3
        ? printedPhaseCell
        : interpreted;
    }
    const aggregate = parseSpatialRow(aggregateCells, schema.confidence, context);
    const aggregateCorrection = aggregateCells.phase?.correction;
    const aggregateRepair = aggregateCorrection ? {
      original: aggregateCorrection.original,
      inferred: aggregateCorrection.corrected,
      reason: aggregateCorrection.reason,
      confidence: aggregateCorrection.confidence,
    } : null;
    const aggregateConflict = phases.find((item) => item.phaseConflict)?.phaseConflict || null;
    applyPhaseReconciliation(aggregate, aggregateRepair, aggregateConflict, aggregateCells.phase);
    if (!aggregate || phases.length < 2) return aggregate ? [aggregate] : [];

    const phaseRows = phases.map((item, index) => {
      const laneTop = index ? (phases[index - 1].cy + item.cy) / 2 : evidenceTop;
      const laneBottom = index < phases.length - 1 ? (item.cy + phases[index + 1].cy) / 2 : evidenceBottom;
      const laneWords = evidenceWords.filter((word) => word.cy >= laneTop && word.cy < laneBottom);
      const cells = columnCells(laneWords, schema);
      cells.way = sourceCell([wayAnchor], 'way');
      cells.phase = interpretedPhaseCell([item]);
      const occupancyCell = Object.values(cells).find((cell) => Core.occupancyLabel?.(cell?.text));
      const explicitOccupancy = Core.occupancyLabel?.(occupancyCell?.text) || null;
      let row = parseSpatialRow(cells, schema.confidence, { ...context, phaseLane: true, laneTop, laneBottom });
      row = applyPhaseReconciliation(row, item.phaseRepair, item.phaseConflict, cells.phase);
      if (!row) return null;
      row.phaseSlotIndependent = true;
      row.sharedPhaseSpan = false;
      row.poleEvidenceBasis = 'bounded_phase_lane';
      if (explicitOccupancy) {
        row.explicitOccupancy = explicitOccupancy;
        row.occupancySourceCell = occupancyCell;
        if (explicitOccupancy === 'spare') row.spare = true;
        if (explicitOccupancy === 'space') row.space = true;
        if (!row.desc) row.desc = explicitOccupancy === 'spare' ? 'Spare' : 'Fitted blank';
        row = Core.reconcileRowOccupancy ? Core.reconcileRowOccupancy(row) : row;
      }
      return row;
    }).filter(Boolean);
    const meaningful = phaseRows.filter((row) => !row.space || row.spare);
    const technical = phaseRows.filter((row) => row.device || row.rating != null || row.protectionStandard
      || row.circuitReference || row.cable || row.sens != null || row.afdd);
    const explicitOccupancies = phaseRows.filter((row) => row.explicitOccupancy || row.spare);
    const calibratedLayout = context.calibratedPhaseLayout || schema.calibratedPhaseLayout || null;
    if (calibratedLayout === 'three_phase_merged' && aggregate && phases.length >= 2) {
      aggregate.phase = '3PH';
      aggregate.poles = 3;
      aggregate.poleConfiguration = 'TP';
      aggregate.occupies_ways = 3;
      aggregate.sharedPhaseSpan = true;
      aggregate.phaseSlotIndependent = false;
      aggregate.poleEvidenceBasis = 'user_calibrated_merged_three_phase_geometry';
      aggregate.calibratedPhaseLayout = calibratedLayout;
      aggregate.requiresReview = true;
      aggregate.conf = Math.min(Number(aggregate.conf) || 0.9, 0.9);
      aggregate.resolutionReasons = [...(aggregate.resolutionReasons || []), 'User calibrated this row group as one device spanning L1/L2/L3'];
      return [aggregate];
    }
    if (calibratedLayout === 'three_phase_rows' && phaseRows.length >= 2) {
      phaseRows.forEach((row) => {
        row.calibratedPhaseLayout = calibratedLayout;
        row.resolutionReasons = [...(row.resolutionReasons || []), 'User calibrated this way as independent L1/L2/L3 phase rows'];
      });
      return phaseRows;
    }
    if (!meaningful.length) return [aggregate];
    // A bounded SPARE/SPACE cell belongs to its own physical phase lane. It is
    // decisive evidence against treating a lone populated middle lane as a
    // merged three-pole device.
    if (technical.length >= 2 || explicitOccupancies.length) return phaseRows;
    if (technical.length === 1 && technical[0].phase !== 'L2') return phaseRows;
    if ((technical.length === 1 && technical[0].phase === 'L2')
      || (technical.length === 0 && meaningful.length === 1 && meaningful[0].phase === 'L2')) {
      aggregate.inferredPoleGrouping = true;
      aggregate.sharedPhaseSpan = true;
      aggregate.phaseSlotIndependent = false;
      aggregate.poleEvidenceBasis = 'merged_three_phase_geometry';
      aggregate.resolutionReasons = [...(aggregate.resolutionReasons || []), 'Single merged evidence row spans L1/L2/L3'];
      return [aggregate];
    }
    return technical.length ? phaseRows : [aggregate];
  }

  function inferredHeaderWay(way, header) {
    const evidence = header.evidence?.ways_total || header.evidence?.size_text || null;
    const source = evidence ? {
      role: 'way',
      text: String(evidence.text || `Header promises way ${way}`),
      originalText: String(evidence.originalText || evidence.text || `Header promises way ${way}`),
      bbox: evidence.bbox || null,
      confidence: Number(evidence.confidence ?? 0.6),
      extractionMethod: evidence.extractionMethod || 'Header reconciliation',
      words: [],
    } : null;
    return {
      way,
      phase: null,
      rating: null,
      device: null,
      curve: null,
      tripUnit: null,
      protectionStandard: null,
      protectionStandardCode: null,
      sens: null,
      rcdProtected: null,
      afdd: false,
      poles: null,
      ka: null,
      desc: 'Way promised by the board header but not printed in the schedule table',
      circuitReference: null,
      circuitConfig: null,
      cable: null,
      spare: false,
      space: true,
      incomer: false,
      qty: 0,
      inferredWay: true,
      requiresReview: true,
      resolutionSource: 'header_way_reconciliation',
      resolutionReasons: ['Board header way count exceeds printed table rows'],
      srcText: `Way ${way} inferred from board header; no printed row evidence`,
      sourceCell: source,
      fieldSources: { way: source },
      conf: 0.45,
    };
  }

  function pointInsideBox(word, value, padding = 1) {
    const box = bboxObject(value);
    return Boolean(box && word.cx >= box.x0 - padding && word.cx <= box.x1 + padding
      && word.cy >= box.y0 - padding && word.cy <= box.y1 + padding);
  }

  function reconcileProtectionStandardRows(words, wayAnchors, rows, schema, context) {
    const standardColumn = schema.columns.find((column) => column.role === 'device_standard');
    const phaseColumn = schema.columns.find((column) => column.role === 'phase');
    if (!standardColumn) return [];
    const standardWords = words.filter((word) => protectionStandard(word.text).code
      && Math.abs(word.cx - standardColumn.x) <= Math.max(18, (standardColumn.right - standardColumn.left) * 0.75));
    const phaseWords = words.filter((word) => extractPhase(word.text)
      && (!phaseColumn || (word.cx >= phaseColumn.left && word.cx < phaseColumn.right)))
      .sort((a, b) => a.cy - b.cy);
    const matchedStandardIds = new Set();
    for (const row of rows.filter((item) => item.protectionStandard)) {
      const evidence = row.fieldSources?.device?.bbox || row.sourceCell?.bbox;
      const box = bboxObject(evidence);
      if (!box) continue;
      const candidates = standardWords.filter((word) => !matchedStandardIds.has(word.id) && pointInsideBox(word, box));
      candidates.sort((a, b) => Math.abs(a.cy - (box.y0 + box.y1) / 2) - Math.abs(b.cy - (box.y0 + box.y1) / 2));
      if (candidates[0]) matchedStandardIds.add(candidates[0].id);
    }
    const recovered = [];
    for (const standardWord of standardWords) {
      if (matchedStandardIds.has(standardWord.id)) continue;
      const phaseWord = phaseWords.slice().sort((a, b) => Math.abs(a.cy - standardWord.cy) - Math.abs(b.cy - standardWord.cy))[0];
      if (!phaseWord || Math.abs(phaseWord.cy - standardWord.cy) > Math.max(10, standardWord.height * 2.2)) continue;
      const phaseIndex = phaseWords.indexOf(phaseWord);
      const laneTop = phaseIndex > 0 ? (phaseWords[phaseIndex - 1].cy + phaseWord.cy) / 2 : phaseWord.cy - Math.max(8, standardWord.height * 1.5);
      const laneBottom = phaseIndex < phaseWords.length - 1
        ? (phaseWord.cy + phaseWords[phaseIndex + 1].cy) / 2
        : phaseWord.cy + Math.max(8, standardWord.height * 1.5);
      const nearestAnchor = wayAnchors.slice().sort((a, b) => Math.abs(a.cy - standardWord.cy) - Math.abs(b.cy - standardWord.cy))[0];
      if (!nearestAnchor) continue;
      let way = extractWayIdentifier(nearestAnchor.text);
      let inferredWay = false;
      const lastAnchor = wayAnchors[wayAnchors.length - 1];
      const lastWay = lastAnchor ? extractWayIdentifier(lastAnchor.text) : null;
      if (lastAnchor && nearestAnchor === lastAnchor && Number.isInteger(lastWay)
        && /^L1$/i.test(phaseWord.text) && standardWord.cy > lastAnchor.cy + 2) {
        way = lastWay + 1;
        inferredWay = true;
      }
      if (way == null || (Number.isInteger(way) && (way < 1 || way > 200))) continue;
      const laneWords = words.filter((word) => word.cy >= laneTop && word.cy < laneBottom);
      const cells = columnCells(laneWords, schema);
      const wayWord = inferredWay
        ? normaliseWord({ text: String(way), bbox: [schema.columns.find((column) => column.role === 'way')?.x || 0, phaseWord.y0, 1, phaseWord.height], confidence: 0.55 })
        : nearestAnchor;
      cells.way = sourceCell([wayWord], 'way');
      cells.phase = sourceCell([phaseWord], 'phase');
      const parsed = parseSpatialRow(cells, schema.confidence, context);
      if (!parsed?.device) continue;
      parsed.inferredWay = inferredWay;
      parsed.wayNumberInferred = inferredWay;
      parsed.requiresReview = true;
      parsed.conf = Math.min(Number(parsed.conf) || 0.68, inferredWay ? 0.68 : 0.76);
      parsed.resolutionSource = 'source_standard_reconciliation';
      parsed.resolutionReasons = [...(parsed.resolutionReasons || []), 'Recovered unmatched protection-standard source cell'];
      recovered.push(parsed);
      rows.push(parsed);
    }
    return recovered;
  }

  function assessScheduleGrid(schema, rows, wayAnchors, minimumWays) {
    const roles = new Set((schema?.columns || []).map((column) => column.role));
    const distinctWays = new Set((rows || []).map((row) => row.way).filter((way) => way != null));
    const populatedRows = (rows || []).filter((row) => row.way != null
      && (row.device || row.rating != null || row.protectionStandard || row.circuitReference || row.desc || row.spare || row.space));
    const blockingReasons = [];
    const reviewReasons = [];
    if (!roles.has('way') || wayAnchors.length < minimumWays || distinctWays.size < minimumWays) blockingReasons.push('way_sequence_missing');
    if (!roles.has('rating')) blockingReasons.push('rating_column_missing');
    if (!roles.has('circuit_reference') && !roles.has('description')) blockingReasons.push('circuit_column_missing');
    if (!populatedRows.length) blockingReasons.push('no_bounded_schedule_rows');
    if (Number(schema?.confidence || 0) < 0.62) blockingReasons.push('column_schema_low_confidence');
    if (!roles.has('device_standard') && !roles.has('device_class')) reviewReasons.push('device_column_missing');
    const reasons = [...blockingReasons, ...reviewReasons];
    return {
      accepted: blockingReasons.length === 0,
      reasons,
      blockingReasons,
      reviewReasons,
      roles: [...roles],
      wayAnchors: wayAnchors.length,
      distinctWays: distinctWays.size,
      populatedRows: populatedRows.length,
    };
  }

  function hasProfileTokens(words, patterns) {
    const labels = (words || []).map((item) => normaliseLabel(item.text));
    return patterns.every((pattern) => labels.some((label) => pattern.test(label)));
  }

  function trimbleDialectProfile(words) {
    const rows = spatialRows(words, 3.2);
    const text = rows.map((row) => row.words.map((item) => item.text).join(' ')).join('\n');
    const signatures = [
      /DISTRIBUTION\s+BOARD\s+SCHEDULE/i,
      /BOARD\s+DATA/i,
      /INCOMER\s+DETAILS/i,
      /OVER\s*CURRENT\s+PROTECTIVE\s+DEVICE/i,
      /EARTH\s+FAULT\s+PROTECTIVE\s+DEVICE/i,
      /ARC\s+FLASH\s+PROTECTIVE\s+DEVICE/i,
      /CONNECTED\s+TO/i,
      /CREATED\s+USING|TRIMBLE\s+INC/i,
    ];
    const tokenSignals = [
      hasProfileTokens(words, [/DISTRIBUTION/, /^BOARD(?:\s|$)/, /SCHEDULE/]),
      hasProfileTokens(words, [/^BOARD(?:\s+DATA)?$/, /DATA/]),
      hasProfileTokens(words, [/INCOMER/, /DETAILS/]),
      hasProfileTokens(words, [/OVER\s*CURRENT|OVERCURRENT/, /PROTECTIVE/, /DEVICE/]),
      hasProfileTokens(words, [/^EARTH(?:\s|$)/, /FAULT/, /PROTECTIVE/, /DEVICE/]),
      hasProfileTokens(words, [/^ARC(?:\s|$)/, /FLASH/, /PROTECTIVE/, /DEVICE/]),
      hasProfileTokens(words, [/CONNECTED/, /\bTO\b/]),
      hasProfileTokens(words, [/CREATED/, /USING/]) || hasProfileTokens(words, [/TRIMBLE/, /INC/]),
    ];
    const signals = signatures.map((pattern, index) => (pattern.test(text) || tokenSignals[index]) ? index : null)
      .filter((value) => value != null);
    const required = signals.includes(1) && signals.includes(3) && signals.includes(4);
    return {
      matched: required && signals.length >= 5,
      confidence: Math.min(0.99, 0.45 + signals.length * 0.065),
      signals,
      rows,
      words,
      text,
    };
  }

  function rowText(row) {
    return (row?.words || []).map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
  }

  function firstProfileRow(profile, pattern, minimumY = -Infinity, maximumY = Infinity) {
    return profile.rows.find((row) => row.cy >= minimumY && row.cy <= maximumY && pattern.test(rowText(row))) || null;
  }

  function flexibleProfileRow(profile, exactPattern, anchorPattern, minimumY = -Infinity, maximumY = Infinity,
    minimumX = -Infinity, maximumX = Infinity) {
    const exact = firstProfileRow(profile, exactPattern, minimumY, maximumY);
    if (exact) return exact;
    const anchor = (profile.words || []).filter((item) => item.cy >= minimumY && item.cy <= maximumY
      && item.cx >= minimumX && item.cx < maximumX && anchorPattern.test(normaliseLabel(item.text)))
      .sort((left, right) => left.cy - right.cy || left.cx - right.cx)[0];
    if (!anchor) return null;
    const tolerance = Math.max(5.5, Math.min(9, anchor.height * 1.05));
    const bandWords = (profile.words || []).filter((item) => Math.abs(item.cy - anchor.cy) <= tolerance)
      .sort((left, right) => left.x0 - right.x0);
    if (!bandWords.length) return null;
    return { cy: anchor.cy, words: bandWords, cells: spatialRows(bandWords, tolerance)[0]?.cells || [] };
  }

  function wordsInRegion(words, left, right, top = -Infinity, bottom = Infinity) {
    return (words || []).filter((item) => item.cx >= left && item.cx < right && item.cy >= top && item.cy < bottom);
  }

  function regionCell(words, left, right, top, bottom, role) {
    return sourceCell(wordsInRegion(words, left, right, top, bottom), role);
  }

  function numericCellInRegion(row, left, right, role, options = {}) {
    const candidates = (row?.words || []).filter((item) => item.cx >= left && item.cx < right
      && /^-?\d+(?:\.\d+)?$/.test(item.text));
    if (!candidates.length) return { value: null, cell: null };
    const cell = sourceCell([candidates[0]], role);
    return { value: numberValue(cell, options), cell };
  }

  function profileHeaderAnchor(row, pattern, minimumX = -Infinity, maximumX = Infinity, profile = null) {
    const direct = (row?.words || []).find((item) => item.cx >= minimumX && item.cx < maximumX
      && pattern.test(normaliseLabel(item.text)));
    if (direct || !profile || !Number.isFinite(row?.cy)) return direct || null;
    return (profile.words || []).filter((item) => item.cx >= minimumX && item.cx < maximumX
      && Math.abs(item.cy - row.cy) <= Math.max(6, item.height * 1.1)
      && pattern.test(normaliseLabel(item.text)))
      .sort((left, right) => Math.abs(left.cy - row.cy) - Math.abs(right.cy - row.cy) || left.cx - right.cx)[0] || null;
  }

  function trimbleColumnSchema(profile, pageWidth, pageHeight) {
    const overcurrentRow = flexibleProfileRow(profile, /OVER\s*CURRENT\s+PROTECTIVE\s+DEVICE/i,
      /OVER\s*CURRENT|OVERCURRENT/, 0, pageHeight, pageWidth * 0.5, pageWidth * 0.92);
    const earthRow = flexibleProfileRow(profile, /EARTH\s+FAULT\s+PROTECTIVE\s+DEVICE/i,
      /^EARTH(?:\s|$)/, overcurrentRow?.cy || 0, pageHeight, pageWidth * 0.5, pageWidth * 0.92);
    const arcRow = flexibleProfileRow(profile, /ARC\s+FLASH\s+PROTECTIVE\s+DEVICE/i,
      /^ARC(?:\s|$)/, earthRow?.cy || 0, pageHeight, pageWidth * 0.5, pageWidth * 0.92);
    if (!overcurrentRow || !earthRow || !arcRow) return null;

    const way = profileHeaderAnchor(overcurrentRow, /^WAY(?:\s|$)/, 0, pageWidth * 0.12, profile);
    const id = profileHeaderAnchor(overcurrentRow, /^ID(?:\s+(?:NO|NUMBER))?(?:\s|$)/, way?.x1 || 0, pageWidth * 0.24, profile);
    const cable = profileHeaderAnchor(overcurrentRow, /^CABLE(?:\s|$)/, pageWidth * 0.12, pageWidth * 0.42, profile);
    const connected = profileHeaderAnchor(overcurrentRow, /^CONNECTED(?:\s|$)/, pageWidth * 0.42, pageWidth * 0.72, profile);
    const protection = profileHeaderAnchor(overcurrentRow, /^OVER\s*CURRENT(?:\s|$)|^OVERCURRENT(?:\s|$)/,
      pageWidth * 0.58, pageWidth * 0.9, profile);
    const rating = profileHeaderAnchor(overcurrentRow, /^RATING(?:\s|$)/, pageWidth * 0.82, pageWidth, profile);
    if (!way || !id || !cable || !connected || !protection || !rating) return null;

    const bounds = {
      wayPhaseLeft: 0,
      wayPhaseRight: Math.max(way.x1 + 3, id.x0 - 4),
      idLeft: Math.max(0, id.x0 - 4),
      idRight: Math.max(id.x1 + 6, cable.x0 - 5),
      cableLeft: Math.max(0, cable.x0 - 5),
      cableRight: Math.max(cable.x1 + 10, connected.x0 - 5),
      connectedLeft: Math.max(0, connected.x0 - 5),
      connectedRight: Math.max(connected.x1 + 10, protection.x0 - 5),
      protectionLeft: Math.max(0, protection.x0 - 5),
      protectionRight: Math.max(protection.x1 + 10, rating.x0 - 7),
      ratingLeft: Math.max(0, rating.x0 - 7),
      ratingRight: pageWidth,
    };
    const footer = profile.rows.find((row) => row.cy > arcRow.cy + 30
      && row.cy > pageHeight * 0.72 && /^(?:PROJECT\s*:|CREATED\s+USING)/i.test(rowText(row)));
    const dataTop = Math.min(pageHeight, arcRow.cy + Math.max(7, median(arcRow.words.map((item) => item.height)) || 8));
    const dataBottom = Math.max(dataTop + 1, footer?.cy || pageHeight);
    const columns = [
      { role: 'way_phase', x: way.cx, left: bounds.wayPhaseLeft, right: bounds.wayPhaseRight, source: 'trimble_header_stack' },
      { role: 'circuit_id', x: id.cx, left: bounds.idLeft, right: bounds.idRight, source: 'trimble_header_stack' },
      { role: 'cable', x: cable.cx, left: bounds.cableLeft, right: bounds.cableRight, source: 'trimble_header_stack' },
      { role: 'connected_to', x: connected.cx, left: bounds.connectedLeft, right: bounds.connectedRight, source: 'trimble_header_stack' },
      { role: 'protection_records', x: protection.cx, left: bounds.protectionLeft, right: bounds.protectionRight, source: 'trimble_header_stack' },
      { role: 'protection_ratings', x: rating.cx, left: bounds.ratingLeft, right: bounds.ratingRight, source: 'trimble_header_stack' },
    ];
    return {
      dialect: 'trimble_stacked_protection',
      columns,
      bounds,
      confidence: profile.confidence,
      headerBand: [0, 0, pageWidth, dataTop],
      dataBand: [0, dataTop, pageWidth, dataBottom - dataTop],
      rowSpacing: null,
      protectionRows: {
        overcurrent: overcurrentRow.cy,
        earthFault: earthRow.cy,
        arcFlash: arcRow.cy,
      },
    };
  }

  function trimbleBoardHeader(profile, words, schema, pageWidth) {
    const boardDataRow = flexibleProfileRow(profile, /BOARD\s+DATA/i, /DATA/,
      0, schema.dataBand[1], 0, pageWidth * 0.3);
    const incomerHeaderRow = flexibleProfileRow(profile, /INCOMER\s+DETAILS/i, /INCOMER/,
      boardDataRow?.cy || 0, schema.dataBand[1], 0, pageWidth * 0.3);
    const headerBottom = incomerHeaderRow?.cy || schema.dataBand[1];
    const identityRow = flexibleProfileRow(profile, /\bID\s*(?:NO|NUMBER)\b/i,
      /^ID(?:\s+(?:NO|NUMBER))?(?:\s|$)/, (boardDataRow?.cy || 0) + 1, headerBottom,
      0, pageWidth * 0.16);
    const identityAnchor = profileHeaderAnchor(identityRow, /^ID(?:\s+(?:NO|NUMBER))?(?:\s|$)/,
      0, pageWidth * 0.16, profile);
    const modelAnchor = profileHeaderAnchor(identityRow, /MODEL\s*NO/, pageWidth * 0.2, pageWidth * 0.55, profile);
    const identityWords = (identityRow?.words || []).filter((item) => item.x0 >= (identityAnchor?.x0 || pageWidth * 0.02)
      && item.x0 < (modelAnchor?.x0 || pageWidth * 0.43));
    const identityCell = sourceCell(identityWords, 'board_ref');
    const boardRef = calibratedHeaderValue('board_ref', identityCell?.text) || null;

    const waysRow = flexibleProfileRow(profile, /\bNO\.?\s+OF\s+WAYS\b/i, /WAYS/,
      identityRow?.cy || 0, headerBottom, pageWidth * 0.2, pageWidth * 0.46);
    const ratingRow = flexibleProfileRow(profile, /BOARD\s+RATING/i, /^RATING(?:\s|$)|BOARD\s+RATING/,
      waysRow?.cy || identityRow?.cy || 0, headerBottom, 0, pageWidth * 0.23);
    const incomerRow = flexibleProfileRow(profile, /DEVICE\s+MANUFACTURER.*DEVICE\s+RATING/i, /MANUFACTURER/,
      incomerHeaderRow?.cy || 0, schema.dataBand[1], 0, pageWidth * 0.3);

    const ways = numericCellInRegion(waysRow, pageWidth * 0.35, pageWidth * 0.46, 'ways_total', { min: 1, max: 200 });
    const spare = numericCellInRegion(waysRow, pageWidth * 0.49, pageWidth * 0.61, 'spare_capacity_pct', { min: 0, max: 100 });
    const boardRating = numericCellInRegion(ratingRow, pageWidth * 0.1, pageWidth * 0.23, 'board_rating_a', { min: 1, max: 6300 });
    const fault = numericCellInRegion(ratingRow, pageWidth * 0.35, pageWidth * 0.46, 'fault_ka', { min: 1, max: 250 });
    const ze = numericCellInRegion(ratingRow, pageWidth * 0.49, pageWidth * 0.61, 'ze_ohm', { min: 0, max: 100 });
    const incomerRating = numericCellInRegion(incomerRow, pageWidth * 0.76, pageWidth, 'incomer_rating_a', { min: 1, max: 6300 });
    const incomerTypeCell = sourceCell((incomerRow?.words || []).filter((item) => item.cx >= pageWidth * 0.455
      && item.cx < pageWidth * 0.67 && !/^DEVICE$|^TYPE$/i.test(normaliseLabel(item.text))), 'incomer_class');
    const incomerType = String(incomerTypeCell?.text || '').replace(/\s+/g, ' ').trim() || null;
    const nameAnchor = profileHeaderAnchor(waysRow, /^NAME(?:\s|$)/, 0, pageWidth * 0.12, profile);
    const waysAnchor = profileHeaderAnchor(waysRow, /^(?:NO|WAYS)(?:\s|$)/, pageWidth * 0.2, pageWidth * 0.46, profile);
    const nameCell = sourceCell((waysRow?.words || []).filter((item) => item.x0 > (nameAnchor?.x1 || pageWidth * 0.04)
      && item.x1 < (waysAnchor?.x0 || pageWidth * 0.31)), 'description');
    const boardName = String(nameCell?.text || '').replace(/\s+/g, ' ').trim() || null;
    const modelCell = sourceCell((identityRow?.words || []).filter((item) => item.x0 > (modelAnchor?.x1 || pageWidth)
      && item.x1 < pageWidth * 0.68 && !/^L[123]$/i.test(item.text)), 'board_model');
    const boardModel = String(modelCell?.text || '').replace(/\s+/g, ' ').trim() || null;

    const header = {
      board_ref: boardRef,
      description: boardName || boardRef,
      purpose: boardName || undefined,
      board_type_text: [boardRef, boardName].filter(Boolean).join(' - '),
      board_model: boardModel || undefined,
      ways_total: ways.value,
      size_text: ways.value ? `${ways.value} WAY TPN` : null,
      spare_capacity_pct: spare.value,
      board_rating_a: boardRating.value,
      fault_ka: fault.value,
      ze_ohm: ze.value,
      phase_config: 'TPN',
      phase_count: 3,
      incomer_class: incomerType,
      incomer_rating_a: incomerRating.value,
      internal_isolator_class: /ISOLAT/i.test(incomerType || '') ? 'Isolator' : null,
      internal_isolator_rating_a: /ISOLAT/i.test(incomerType || '') ? incomerRating.value : null,
      internal_isolator_details: [incomerType, incomerRating.value != null ? `${incomerRating.value}A` : null].filter(Boolean).join(' ') || null,
    };
    const evidence = {
      board_ref: identityCell,
      description: nameCell || identityCell,
      purpose: nameCell || undefined,
      board_type_text: nameCell || identityCell,
      board_model: modelCell || undefined,
      ways_total: ways.cell,
      size_text: ways.cell,
      spare_capacity_pct: spare.cell,
      board_rating_a: boardRating.cell,
      fault_ka: fault.cell,
      ze_ohm: ze.cell,
      phase_config: identityCell,
      phase_count: identityCell,
      incomer_class: incomerTypeCell,
      incomer_rating_a: incomerRating.cell,
      internal_isolator_class: incomerTypeCell,
      internal_isolator_rating_a: incomerRating.cell,
      internal_isolator_details: sourceCell([...(incomerTypeCell?.words || []), ...(incomerRating.cell?.words || [])], 'internal_isolator_details'),
    };
    Object.keys(header).forEach((key) => { if (header[key] == null || header[key] === '') delete header[key]; });
    Object.keys(evidence).forEach((key) => { if (!evidence[key]) delete evidence[key]; });
    return { header, evidence, boardRef, identityCell };
  }

  function tripAmpsToMa(cell) {
    const value = numberValue(cell, { min: 0.001, max: 1000 });
    if (value == null) return null;
    return value < 1 ? Math.round(value * 1000) : value;
  }

  function recordIsEmpty(value) {
    return !String(value || '').trim() || /^(?:NONE|N\/?A|NOT\s+APPLICABLE|-+)$/i.test(String(value || '').trim());
  }

  function trimbleProtectionRecords(groupWords, schema, top, bottom) {
    const { bounds } = schema;
    const ratingWords = wordsInRegion(groupWords, bounds.ratingLeft, bounds.ratingRight, top, bottom);
    const ratingRows = spatialRows(ratingWords, 2.8).filter((row) => row.words.length).sort((left, right) => left.cy - right.cy);
    const centers = ratingRows.map((row) => row.cy);
    const topCenter = centers[0] ?? top;
    const earthCenter = centers[1] ?? topCenter + (bottom - top) * 0.48;
    const arcCenter = centers[2] ?? earthCenter + (bottom - top) * 0.28;
    const overEarthBoundary = (topCenter + earthCenter) / 2;
    const earthArcBoundary = (earthCenter + arcCenter) / 2;
    const protectionCell = (from, to, role) => regionCell(groupWords, bounds.protectionLeft, bounds.protectionRight, from, to, role);
    const ratingCell = (from, to, role) => regionCell(groupWords, bounds.ratingLeft, bounds.ratingRight, from, to, role);
    return {
      overcurrent: protectionCell(top, overEarthBoundary, 'overcurrent_device'),
      overcurrentRating: ratingCell(top, overEarthBoundary, 'overcurrent_rating_a'),
      earthFault: protectionCell(overEarthBoundary, earthArcBoundary, 'earth_fault_device'),
      earthFaultRating: ratingCell(overEarthBoundary, earthArcBoundary, 'earth_fault_trip_a'),
      arcFlash: protectionCell(earthArcBoundary, bottom, 'arc_flash_device'),
      arcFlashRating: ratingCell(earthArcBoundary, bottom, 'arc_flash_rating_a'),
      centers: { top: topCenter, earthFault: earthCenter, arcFlash: arcCenter },
    };
  }

  function trimbleRow(groupWords, anchor, top, bottom, schema, boardRef, boardHeader = {}) {
    const { bounds } = schema;
    const records = trimbleProtectionRecords(groupWords, schema, top, bottom);
    const descriptor = parseProtectionDescriptor(records.overcurrent?.text || '');
    const rating = numberValue(records.overcurrentRating, { min: 0.1, max: 6300 });
    const earthDescriptor = parseProtectionDescriptor(records.earthFault?.text || '');
    const earthPresent = !recordIsEmpty(records.earthFault?.text);
    const arcPresent = !recordIsEmpty(records.arcFlash?.text);
    const tripSensitivity = tripAmpsToMa(records.earthFaultRating);
    const integralRcd = /^(?:RCBO|AFDD\s*\+\s*RCBO|RCD|RCCB)$/i.test(descriptor.explicitDevice || '')
      || descriptor.standardCode === '61009' || descriptor.standardCode === '61008';
    const rcdArrangement = integralRcd ? 'integral' : (earthPresent ? 'separate' : null);
    const rcdProtected = integralRcd || earthPresent || descriptor.sensitivityMa != null || tripSensitivity != null;
    const sensitivity = descriptor.sensitivityMa ?? tripSensitivity;
    const arcDescriptor = parseProtectionDescriptor(records.arcFlash?.text || '');
    const explicitAfdd = arcPresent && (/\bAFDD\b|\bAFFD\b|\bBS\s*(?:EN\s*)?62606\b/i.test(records.arcFlash?.text || ''));
    const resolution = resolveProtectionDevice({
      standard: records.overcurrent?.text || descriptor.protectionStandard,
      deviceClass: descriptor.explicitDevice,
      tripUnit: descriptor.tripUnit,
      productRange: descriptor.productRange,
      rating,
      rcdProtected,
      rcdArrangement,
      sensitivityMa: sensitivity,
      afdd: explicitAfdd,
      afddArrangement: arcPresent ? 'separate' : null,
    });

    const phaseWords = wordsInRegion(groupWords, bounds.wayPhaseLeft, bounds.wayPhaseRight, top, bottom)
      .filter((item) => item !== anchor && phaseValues(item.text).length > 0);
    const phaseCell = sourceCell(phaseWords, 'phase');
    const phases = phaseValues(phaseCell?.text);
    let poles = phases.length >= 3 ? 3 : (phases.length === 1 ? 1 : descriptor.poles);
    let poleConfiguration = poles === 3 ? 'TP' : (poles === 2 ? 'DP' : (poles === 1 ? 'SP' : descriptor.poleConfiguration));
    const poleConflict = descriptor.poles && poles && descriptor.poles !== poles ? {
      printedPhase: phaseCell?.text || null,
      descriptor: descriptor.poleToken,
      reason: `Phase cell ${phaseCell?.text || 'blank'} conflicts with device pole descriptor ${descriptor.poleToken}`,
    } : null;
    if (!poles && descriptor.poles) {
      poles = descriptor.poles;
      poleConfiguration = descriptor.poleConfiguration;
    }
    const phase = poles === 3 ? '3PH' : (phases.length === 1 ? phases[0] : null);
    const circuitIdCell = regionCell(groupWords, bounds.idLeft, bounds.idRight, top, bottom, 'circuit_id');
    const cableCell = regionCell(groupWords, bounds.cableLeft, bounds.cableRight, top, bottom, 'cable');
    const connectedCell = regionCell(groupWords, bounds.connectedLeft, bounds.connectedRight, top, bottom, 'connected_to');
    const connectedText = String(connectedCell?.text || '').replace(/\s+/g, ' ').trim();
    const circuitReference = Core.extractBoardReferences(connectedText)[0]?.original || null;
    const source = sourceCell(groupWords, 'row');
    const occupancy = Core.occupancyLabel?.(connectedText || records.overcurrent?.text || '') || null;
    const spare = occupancy === 'spare';
    const space = occupancy === 'space' || (!resolution.device && !rating && !connectedText);
    const separateRcd = earthPresent ? {
      device: earthDescriptor.explicitDevice === 'RCCB' ? 'RCD' : (earthDescriptor.explicitDevice || 'RCD'),
      sensitivityMa: tripSensitivity ?? earthDescriptor.sensitivityMa,
      type: earthDescriptor.rcdType,
      poles: earthDescriptor.poles,
      descriptor: records.earthFault?.text || null,
      sourceCell: records.earthFault,
      ratingSourceCell: records.earthFaultRating,
    } : null;
    const invalidSensitivity = sensitivity != null && ![10, 30, 100, 300, 500].includes(Number(sensitivity));
    const invalidBreakingCapacity = descriptor.breakingCapacityKa != null
      && (descriptor.breakingCapacityKa < 3 || descriptor.breakingCapacityKa > 150);
    const inferredCurve = inferredDistributionCurve(boardHeader, resolution.device, descriptor.curve);
    const requiresReview = Boolean(inferredCurve || resolution.classConflict || poleConflict || invalidSensitivity || invalidBreakingCapacity
      || (!spare && !space && (!resolution.device || rating == null || !poles)));
    const reasons = [...resolution.reasons];
    if (earthPresent) reasons.push('Separate earth-fault protective-device record bound by vertical header position');
    else if (integralRcd) reasons.push('Integral residual protection is stated by the overcurrent device');
    if (poleConflict) reasons.push(poleConflict.reason);
    if (invalidSensitivity) reasons.push(`RCD sensitivity ${sensitivity}mA is outside the supported evidence domain`);
    if (invalidBreakingCapacity) reasons.push(`Breaking capacity ${descriptor.breakingCapacityKa}kA is outside the supported evidence domain`);
    if (inferredCurve) reasons.push(inferredCurve.reason);
    return {
      way: extractWayIdentifier(anchor.text),
      boardRef,
      phase,
      rating,
      device: resolution.device,
      class_basis: resolution.classBasis,
      classConflict: resolution.classConflict,
      curve: descriptor.curve || inferredCurve?.curve || null,
      curveInferred: Boolean(inferredCurve),
      tripUnit: descriptor.tripUnit,
      productRange: descriptor.productRange,
      poleConfiguration,
      protectionStandard: descriptor.protectionStandard || resolution.protectionStandard,
      protectionStandardCode: descriptor.standardCode || resolution.standardCode,
      sens: sensitivity,
      rcdProtected: rcdProtected ? true : false,
      rcdArrangement,
      rcdType: descriptor.rcdType || earthDescriptor.rcdType,
      separateRcd,
      earthFaultDevice: earthPresent ? separateRcd : null,
      afdd: explicitAfdd,
      afddIndicated: explicitAfdd ? true : (arcPresent ? null : false),
      arcFlashDevice: arcPresent ? (arcDescriptor.explicitDevice || records.arcFlash?.text || null) : null,
      arcFlashRatingA: numberValue(records.arcFlashRating, { min: 0, max: 6300 }),
      poles,
      poleConflict,
      ka: descriptor.breakingCapacityKa,
      desc: connectedText,
      circuitId: circuitIdCell?.text || null,
      circuitReference,
      circuitReferenceText: connectedText || null,
      circuitConfig: null,
      associatedDevices: Core.extractAssociatedEquipment(connectedText),
      cable: cableCell ? { orig: cableCell.text, description: cableCell.text } : null,
      spare,
      space,
      incomer: false,
      qty: space ? 0 : (resolution.device ? 1 : 0),
      occupies_ways: poles === 3 ? 3 : 1,
      sharedPhaseSpan: poles === 3,
      phaseSlotIndependent: poles === 1,
      poleEvidenceBasis: phases.length ? 'trimble_bounded_phase_record' : 'trimble_device_descriptor',
      inferredDevice: resolution.classBasis !== 'explicit' && resolution.classBasis !== 'bs_en',
      requiresReview,
      resolutionSource: 'trimble_stacked_geometry',
      resolutionReasons: reasons,
      srcText: source?.text || '',
      sourceCell: source,
      highlightBbox: source?.bbox || null,
      fieldSources: {
        way: sourceCell([anchor], 'way'),
        phase: phaseCell || source,
        device: records.overcurrent || source,
        protectionStandard: records.overcurrent || source,
        tripUnit: records.overcurrent || source,
        rating: records.overcurrentRating || source,
        curve: records.overcurrent || source,
        breakingCapacity: records.overcurrent || source,
        poles: phaseCell || records.overcurrent || source,
        rcdProtection: records.earthFault || records.overcurrent || source,
        rcdSensitivity: records.earthFaultRating || records.overcurrent || source,
        afdd: records.arcFlash || source,
        arcFlash: records.arcFlash || source,
        circuitReference: connectedCell || source,
        description: connectedCell || source,
        circuitId: circuitIdCell || source,
        installMethod: cableCell || source,
      },
      conf: requiresReview ? Math.min(0.76, resolution.confidence || 0.76) : Math.min(0.98, resolution.confidence || 0.92),
      validation: { invalidSensitivity, invalidBreakingCapacity },
    };
  }

  function parseCableScheduleIdentifier(value) {
    const original = String(value || '').replace(/\s+/g, '').trim();
    if (!original || original.length > 90) return null;
    const match = original.match(/^(.{2,48}?)\/(L|P)\/?(\d{1,3})[-/](L[123]|L1[-/]L2[-/]L3|TP(?:&?N)?|3PH)$/i);
    if (!match) return null;
    const wayNumber = Number(match[3]);
    if (!Number.isInteger(wayNumber) || wayNumber < 1 || wayNumber > 200) return null;
    const phaseToken = match[4].toUpperCase();
    const threePhase = /^(?:L1[-/]L2[-/]L3|TP(?:&?N)?|3PH)$/.test(phaseToken);
    return {
      original,
      boardRef: match[1],
      section: match[2].toUpperCase(),
      wayNumber,
      way: `${match[2].toUpperCase()}${wayNumber}`,
      phase: threePhase ? '3PH' : phaseToken,
      poles: threePhase ? 3 : 1,
      poleConfiguration: threePhase ? 'TP' : 'SP',
    };
  }

  function trimbleCableScheduleProfile(words, pageWidth) {
    const rows = spatialRows(words, 3.2);
    const text = rows.map((row) => rowText(row)).join('\n');
    const width = Number(pageWidth) || Math.max(1, ...words.map((word) => word.x1));
    const identifiers = [];
    const seen = new Set();
    for (const word of words) {
      const parsed = parseCableScheduleIdentifier(word.text);
      if (!parsed || seen.has(word.id)) continue;
      seen.add(word.id);
      identifiers.push({ ...word, parsed });
    }
    if (!identifiers.length) {
      for (const row of rows) {
        const cell = sourceCell(row.words.filter((word) => word.cx < width * 0.22), 'hierarchical_id');
        const parsed = parseCableScheduleIdentifier(cell?.text);
        if (!cell || !parsed) continue;
        const anchor = normaliseWord({ text: cell.text, bbox: cell.bbox, confidence: cell.confidence });
        if (anchor) identifiers.push({ ...anchor, parsed });
      }
    }
    identifiers.sort((left, right) => left.cy - right.cy || left.cx - right.cx);
    const signals = [
      /\bCABLE\s+SCHEDULE\b/i.test(text),
      /CONNECTED\s+FROM/i.test(text) && /CONNECTED\s+TO/i.test(text),
      /PROTECTIVE\s+DEVIC/i.test(text),
      /\bRCD\b/i.test(text),
      /\bAFDD\b|\bAFFD\b/i.test(text),
      /CREATED\s+USING|TRIMBLE\s+INC/i.test(text),
      identifiers.length > 0,
    ].filter(Boolean).length;
    return {
      matched: identifiers.length > 0 && /\bCABLE\s+SCHEDULE\b/i.test(text)
        && /PROTECTIVE\s+DEVIC/i.test(text) && signals >= 5,
      confidence: Math.min(0.98, 0.42 + signals * 0.07 + Math.min(0.12, identifiers.length * 0.02)),
      rows,
      text,
      identifiers,
    };
  }

  function lastHeaderWord(words, pattern, maximumY, minimumX = -Infinity, maximumX = Infinity) {
    return words.filter((word) => word.cy < maximumY && word.cx >= minimumX && word.cx < maximumX
      && pattern.test(normaliseLabel(word.text)))
      .sort((left, right) => right.cy - left.cy || left.cx - right.cx)[0] || null;
  }

  function trimbleCableSchema(input, words, profile, pageWidth, pageHeight) {
    const firstIdentifier = profile.identifiers[0];
    if (!firstIdentifier) return null;
    const headerBottom = firstIdentifier.cy;
    const id = lastHeaderWord(words, /^ID$/, headerBottom, 0, pageWidth * 0.18)
      || { cx: pageWidth * 0.07, x0: pageWidth * 0.05, x1: pageWidth * 0.09 };
    const connected = lastHeaderWord(words, /^CONNECTED$/, headerBottom, pageWidth * 0.08, pageWidth * 0.44);
    const cores = lastHeaderWord(words, /^CORES$/, headerBottom, pageWidth * 0.25, pageWidth * 0.52);
    const cable = lastHeaderWord(words, /^CABLE$/, headerBottom, pageWidth * 0.36, pageWidth * 0.72);
    const length = lastHeaderWord(words, /^LENGTH$/, headerBottom, pageWidth * 0.55, pageWidth * 0.78);
    const ir = lastHeaderWord(words, /^IR\s*A$/, headerBottom, pageWidth * 0.7, pageWidth);
    const rating = lastHeaderWord(words, /^IN\s*A$/, headerBottom, pageWidth * 0.72, pageWidth);
    const device = lastHeaderWord(words, /^TYPE$/, headerBottom, pageWidth * 0.76, pageWidth);
    const rcd = lastHeaderWord(words, /^RCD$/, headerBottom, pageWidth * 0.82, pageWidth);
    const afdd = lastHeaderWord(words, /^A(?:F|FF)DD$/, headerBottom, pageWidth * 0.88, pageWidth);
    if (!connected || !cores || !cable || !length || !rating || !device || !rcd || !afdd) return null;
    const midpoint = (left, right) => (Number(left.cx) + Number(right.cx)) / 2;
    const bounds = {
      idLeft: 0,
      idRight: midpoint(id, connected),
      connectedLeft: midpoint(id, connected),
      connectedRight: Math.max(connected.x1 + 4, cores.x0 - 5),
      cableLeft: Math.max(0, cores.x0 - 5),
      cableRight: Math.max(cable.x1 + 8, length.x0 - 5),
      irLeft: ir ? midpoint(length, ir) : Math.max(length.x1, pageWidth * 0.77),
      irRight: ir ? midpoint(ir, rating) : midpoint(length, rating),
      ratingLeft: ir ? midpoint(ir, rating) : midpoint(length, rating),
      ratingRight: midpoint(rating, device),
      deviceLeft: midpoint(rating, device),
      deviceRight: midpoint(device, rcd),
      rcdLeft: midpoint(device, rcd),
      rcdRight: midpoint(rcd, afdd),
      afddLeft: midpoint(rcd, afdd),
      afddRight: pageWidth,
    };
    const calibrations = calibrationRegions(input);
    const applyColumn = (roles, leftKey, rightKey) => {
      const region = calibrations.filter((item) => roles.includes(item.role) && item.axis !== 'row').at(-1);
      if (!region) return;
      bounds[leftKey] = region.box.x0;
      bounds[rightKey] = region.box.x1;
    };
    applyColumn(['way', 'phase'], 'idLeft', 'idRight');
    applyColumn(['description', 'circuit_reference'], 'connectedLeft', 'connectedRight');
    applyColumn(['cable_type'], 'cableLeft', 'cableRight');
    applyColumn(['trip_unit'], 'irLeft', 'irRight');
    applyColumn(['rating'], 'ratingLeft', 'ratingRight');
    applyColumn(['device_class', 'device_standard', 'trip_curve'], 'deviceLeft', 'deviceRight');
    applyColumn(['rcd', 'rcd_ma'], 'rcdLeft', 'rcdRight');
    applyColumn(['afdd'], 'afddLeft', 'afddRight');
    const footer = profile.rows.find((row) => row.cy > pageHeight * 0.72 && /^(?:PROJECT\s*:|CREATED\s+USING)/i.test(rowText(row)));
    const tableRegion = calibrations.find((region) => region.role === 'outgoing_table');
    const spacing = median(profile.identifiers.slice(1).map((anchor, index) => anchor.cy - profile.identifiers[index].cy).filter((value) => value > 3)) || 40;
    const dataTop = tableRegion?.box.y0 ?? Math.max(0, firstIdentifier.cy - spacing * 0.58);
    const dataBottom = tableRegion?.box.y1 ?? Math.max(dataTop + 1, footer?.cy || pageHeight);
    return {
      dialect: 'trimble_cable_schedule',
      bounds,
      confidence: profile.confidence,
      columns: [
        { role: 'hierarchical_id', x: id.cx, left: bounds.idLeft, right: bounds.idRight, source: 'trimble_cable_header' },
        { role: 'connected_to', x: connected.cx, left: bounds.connectedLeft, right: bounds.connectedRight, source: 'trimble_cable_header' },
        { role: 'cable', x: cable.cx, left: bounds.cableLeft, right: bounds.cableRight, source: 'trimble_cable_header' },
        { role: 'trip_unit', x: ir?.cx ?? bounds.irLeft, left: bounds.irLeft, right: bounds.irRight, source: 'trimble_cable_header' },
        { role: 'rating', x: rating.cx, left: bounds.ratingLeft, right: bounds.ratingRight, source: 'trimble_cable_header' },
        { role: 'device_class', x: device.cx, left: bounds.deviceLeft, right: bounds.deviceRight, source: 'trimble_cable_header' },
        { role: 'rcd', x: rcd.cx, left: bounds.rcdLeft, right: bounds.rcdRight, source: 'trimble_cable_header' },
        { role: 'afdd', x: afdd.cx, left: bounds.afddLeft, right: bounds.afddRight, source: 'trimble_cable_header' },
      ],
      headerBand: [0, 0, pageWidth, dataTop],
      dataBand: [0, dataTop, pageWidth, dataBottom - dataTop],
      rowSpacing: spacing,
      transferEligible: true,
    };
  }

  function cleanedSourceCell(words, role, prefixPattern = null) {
    const cell = sourceCell(words, role);
    if (!cell) return null;
    const originalText = cell.text;
    const text = prefixPattern ? originalText.replace(prefixPattern, '').replace(/\s+/g, ' ').trim() : originalText;
    return { ...cell, text, originalText };
  }

  function cableScheduleProtectionState(cell) {
    const text = String(cell?.text || '').trim();
    if (!text) return null;
    if (recordIsEmpty(text)) return false;
    const indicator = indicatorValue(text);
    if (indicator != null) return indicator;
    if (/\bRCD\b|\bAFDD\b|\bAFFD\b/i.test(text) || /\b\d+(?:\.\d+)?\s*(?:MA|A)\b/i.test(text)) return true;
    return null;
  }

  function inferredDistributionCurve(header, device, explicitCurve) {
    if (explicitCurve || !/^(?:MCB|RCBO|AFDD\+RCBO)$/i.test(device || '')) return null;
    const rating = Number(header?.board_rating_a ?? header?.incomer_rating_a ?? header?.internal_isolator_rating_a);
    if (!Number.isFinite(rating) || rating < 100 || rating > 250) return null;
    return { curve: 'C', reason: `${rating}A distribution-board policy default where the source omits a trip curve` };
  }

  function parseTrimbleCableSchedulePage(input, words, profile, pageWidth, pageHeight) {
    const schema = trimbleCableSchema(input, words, profile, pageWidth, pageHeight);
    if (!schema) {
      return {
        matched: false, confidence: Math.min(profile.confidence, 0.55), words: words.length, schema: null,
        rows: [], feeds: [], references: [], warnings: ['trimble_cable_columns_not_resolved'],
      };
    }
    const boardRefs = [...new Set(profile.identifiers.map((anchor) => anchor.parsed.boardRef))];
    const printedBoardRef = boardRefs.length === 1 ? boardRefs[0] : null;
    const ys = profile.identifiers.map((anchor) => anchor.cy);
    const groupCells = profile.identifiers.map((anchor, index) => {
      const rowOffset = Math.max(5, Number(schema.rowSpacing || 40) * 0.37);
      const top = Math.max(schema.dataBand[1], anchor.cy - rowOffset);
      const bottom = Math.min(schema.dataBand[1] + schema.dataBand[3],
        index < profile.identifiers.length - 1 ? profile.identifiers[index + 1].cy - rowOffset : anchor.cy + Number(schema.rowSpacing || 40) * 0.65);
      const groupWords = words.filter((word) => word.cy >= top && word.cy < bottom);
      const connectedWords = wordsInRegion(groupWords, schema.bounds.connectedLeft, schema.bounds.connectedRight, top, bottom);
      const connectedRows = spatialRows(connectedWords, 3.2);
      const fromRow = connectedRows.find((row) => /CONNECTED\s+FROM/i.test(rowText(row)));
      const toTop = anchor.cy + Math.max(4, Number(schema.rowSpacing || 40) * 0.1);
      const connectedTo = cleanedSourceCell(connectedWords.filter((word) => word.cy >= toTop), 'connected_to', /\bCONNECTED\s+TO\s*:?\s*(?:---\s*)?/i);
      const connectedFrom = cleanedSourceCell(connectedWords.filter((word) => word.cy >= (fromRow?.cy || top) - 4 && word.cy < toTop),
        'connected_from', /^CONNECTED\s+FROM\s*:?\s*/i);
      return { anchor, top, bottom, groupWords, connectedTo, connectedFrom };
    });
    const suppliedFromCell = groupCells.map((group) => group.connectedFrom).find((cell) => cell?.text) || null;
    const suppliedFromText = String(suppliedFromCell?.text || '').replace(/\s+(\d+)\/\d+\/L[123]\s*$/i, ' $1').trim() || null;
    const observedPhases = new Set(profile.identifiers.map((anchor) => anchor.parsed.phase).filter((phase) => /^L[123]$/.test(phase)));
    const phaseConfig = profile.identifiers.some((anchor) => anchor.parsed.poles === 3) || observedPhases.size >= 2 ? 'TPN' : 'SPN';
    const baseHeader = {
      board_ref: printedBoardRef,
      description: suppliedFromText || printedBoardRef,
      purpose: suppliedFromText || undefined,
      supplied_from_text: suppliedFromText || undefined,
      board_type_text: /L\s*&\s*P/i.test(printedBoardRef || '') || /LIGHTING\s*&\s*POWER/i.test(suppliedFromText || '')
        ? 'Lighting and power board' : 'Cable schedule board',
      phase_config: phaseConfig,
      phase_count: phaseConfig === 'TPN' ? 3 : 1,
      ways_observed: new Set(profile.identifiers.map((anchor) => anchor.parsed.way)).size,
    };
    const boardEvidence = printedBoardRef ? cleanedSourceCell([profile.identifiers[0]], 'board_ref') : null;
    if (boardEvidence) {
      boardEvidence.originalText = profile.identifiers[0].parsed.original;
      boardEvidence.text = printedBoardRef;
      boardEvidence.extractionMethod = 'Trimble cable-schedule hierarchical identifier';
    }
    const calibrated = applyHeaderCalibrations({
      header: baseHeader,
      evidence: {
        board_ref: boardEvidence,
        description: suppliedFromCell || boardEvidence,
        purpose: suppliedFromCell || boardEvidence,
        supplied_from_text: suppliedFromCell || undefined,
        phase_config: boardEvidence,
        phase_count: boardEvidence,
      },
    }, input, words);
    const boardRef = calibrated.header.board_ref || printedBoardRef;
    const rows = groupCells.map((group) => {
      const { anchor, top, bottom, groupWords, connectedTo } = group;
      const deviceCell = regionCell(groupWords, schema.bounds.deviceLeft, schema.bounds.deviceRight, top, bottom, 'device_class');
      const ratingCell = regionCell(groupWords, schema.bounds.ratingLeft, schema.bounds.ratingRight, top, bottom, 'rating');
      const tripCell = regionCell(groupWords, schema.bounds.irLeft, schema.bounds.irRight, top, bottom, 'trip_unit');
      const rcdCell = regionCell(groupWords, schema.bounds.rcdLeft, schema.bounds.rcdRight, top, bottom, 'rcd');
      const afddCell = regionCell(groupWords, schema.bounds.afddLeft, schema.bounds.afddRight, top, bottom, 'afdd');
      const cableCell = regionCell(groupWords, schema.bounds.cableLeft, schema.bounds.cableRight, top, bottom, 'cable');
      const descriptor = parseProtectionDescriptor(deviceCell?.text || '');
      const rating = numberValue(ratingCell, { min: 0.1, max: 6300 });
      const rcdProtected = cableScheduleProtectionState(rcdCell);
      const afdd = cableScheduleProtectionState(afddCell);
      const rcdRaw = numberValue(rcdCell, { min: 0.001, max: 1000 });
      const sensitivity = rcdRaw == null ? descriptor.sensitivityMa : (rcdRaw < 1 ? Math.round(rcdRaw * 1000) : rcdRaw);
      const integralRcd = descriptor.explicitDevice === 'RCBO' || descriptor.standardCode === '61009';
      const rcdArrangement = integralRcd ? 'integral' : (rcdProtected === true ? 'separate_or_unspecified' : null);
      const resolution = resolveProtectionDevice({
        standard: descriptor.protectionStandard,
        deviceClass: descriptor.explicitDevice || deviceCell?.text,
        tripUnit: tripCell?.text,
        rating,
        rcdProtected,
        rcdArrangement,
        sensitivityMa: sensitivity,
        afdd,
      });
      const inferredCurve = inferredDistributionCurve(calibrated.header, resolution.device, descriptor.curve);
      const source = sourceCell(groupWords, 'row');
      const description = String(connectedTo?.text || '').trim();
      const connectedIdentifiers = description.match(/\b[A-Z]{1,5}(?:-[A-Z0-9&]+){1,5}\b/g) || [];
      const circuitReferences = [...new Set([
        ...Core.extractBoardReferences(description).map((item) => item.original),
        ...connectedIdentifiers,
      ])].filter((reference) => Core.normaliseBoardReference(reference) !== Core.normaliseBoardReference(boardRef));
      const missingCurve = /^(?:MCB|RCBO|AFDD\+RCBO)$/i.test(resolution.device || '')
        && !descriptor.curve && !inferredCurve;
      const requiresReview = Boolean(resolution.classConflict || !resolution.device || rating == null
        || inferredCurve || missingCurve || rcdProtected == null || afdd == null || boardRefs.length !== 1);
      const reasons = [...resolution.reasons];
      if (rcdProtected === false) reasons.push('RCD column explicitly states N/A / not applicable');
      if (afdd === false) reasons.push('AFDD column explicitly states N/A / not applicable');
      if (inferredCurve) reasons.push(inferredCurve.reason);
      if (missingCurve) reasons.push('Trip curve is not printed and the board rating does not prove the 100A-250A distribution-board default');
      return {
        way: anchor.parsed.way,
        wayNumber: anchor.parsed.wayNumber,
        waySection: anchor.parsed.section,
        boardRef,
        phase: anchor.parsed.phase,
        rating,
        device: resolution.device,
        class_basis: resolution.classBasis,
        classConflict: resolution.classConflict,
        curve: descriptor.curve || inferredCurve?.curve || null,
        curveInferred: Boolean(inferredCurve),
        tripUnit: String(tripCell?.text || '').trim() && !recordIsEmpty(tripCell?.text) ? canonicalTripUnit(tripCell.text) : null,
        productRange: descriptor.productRange,
        poleConfiguration: anchor.parsed.poleConfiguration,
        protectionStandard: descriptor.protectionStandard || resolution.protectionStandard,
        protectionStandardCode: descriptor.standardCode || resolution.standardCode,
        sens: sensitivity,
        rcdProtected: rcdProtected == null ? null : rcdProtected,
        rcdArrangement,
        afdd: afdd == null ? null : afdd,
        afddIndicated: afdd == null ? null : afdd,
        poles: anchor.parsed.poles,
        ka: descriptor.breakingCapacityKa,
        desc: description,
        circuitId: anchor.parsed.original,
        circuitReference: circuitReferences[0] || null,
        circuitReferences,
        circuitReferenceText: description || null,
        circuitConfig: null,
        associatedDevices: Core.extractAssociatedEquipment(description),
        cable: cableCell ? { orig: cableCell.text, description: cableCell.text } : null,
        spare: false,
        space: false,
        incomer: false,
        qty: resolution.device ? 1 : 0,
        occupies_ways: anchor.parsed.poles === 3 ? 3 : 1,
        sharedPhaseSpan: anchor.parsed.poles === 3,
        phaseSlotIndependent: anchor.parsed.poles === 1,
        poleEvidenceBasis: 'trimble_cable_hierarchical_identifier',
        inferredDevice: resolution.classBasis !== 'explicit' && resolution.classBasis !== 'bs_en',
        requiresReview,
        resolutionSource: 'trimble_cable_schedule_geometry',
        resolutionReasons: reasons,
        srcText: source?.text || '',
        sourceCell: source,
        highlightBbox: source?.bbox || null,
        fieldSources: {
          way: cleanedSourceCell([anchor], 'way'),
          phase: cleanedSourceCell([anchor], 'phase'),
          device: deviceCell || source,
          rating: ratingCell || source,
          curve: deviceCell || source,
          tripUnit: tripCell || source,
          poles: cleanedSourceCell([anchor], 'phase'),
          rcdProtection: rcdCell || source,
          rcdSensitivity: rcdCell || source,
          afdd: afddCell || source,
          circuitReference: connectedTo || source,
          description: connectedTo || source,
          circuitId: cleanedSourceCell([anchor], 'circuit_id'),
          installMethod: cableCell || source,
        },
        conf: requiresReview ? Math.min(0.78, resolution.confidence || 0.78) : Math.min(0.97, resolution.confidence || 0.94),
      };
    });
    const blockingReasons = [];
    if (!boardRef || boardRefs.length !== 1) blockingReasons.push('primary_board_not_resolved');
    if (!rows.length) blockingReasons.push('hierarchical_rows_not_resolved');
    if (!rows.some((row) => row.device || row.rating != null)) blockingReasons.push('no_bounded_schedule_rows');
    const reviewReasons = [];
    if (rows.some((row) => row.requiresReview)) reviewReasons.push('row_review_required');
    const grid = {
      accepted: blockingReasons.length === 0,
      reasons: [...blockingReasons, ...reviewReasons],
      blockingReasons,
      reviewReasons,
      roles: schema.columns.map((column) => column.role),
      wayAnchors: profile.identifiers.length,
      distinctWays: new Set(rows.map((row) => row.way)).size,
      populatedRows: rows.filter((row) => row.device || row.rating != null).length,
    };
    const references = [];
    if (boardRef) references.push({ role: 'primary_board', original: boardRef, normalised: Core.normaliseBoardReference(boardRef), line: null });
    rows.flatMap((row) => row.circuitReferences || []).forEach((reference) => {
      const normalised = Core.normaliseBoardReference(reference);
      if (!normalised || references.some((item) => item.role === 'circuit_reference' && item.normalised === normalised)) return;
      references.push({ role: 'circuit_reference', original: reference, normalised, line: null });
    });
    const classification = classifyBoardFamily(calibrated.header, { devices: rows, policy: input.boardPolicy });
    const feeds = boardRef ? rows.flatMap((row) => (row.circuitReferences || []).map((reference) => ({
      fromRef: boardRef,
      toRef: reference,
      way: row.way,
      device: row.device,
      rating: row.rating,
      poles: row.poles,
      cable: row.cable,
      confidence: row.conf,
      sourceCell: row.fieldSources.circuitReference,
    }))) : [];
    return {
      matched: grid.accepted,
      confidence: grid.accepted ? profile.confidence : Math.min(profile.confidence, 0.58),
      words: words.length,
      dialect: schema.dialect,
      schema,
      calibration: {
        applied: calibrationRegions(input).length,
        roles: [...new Set(calibrationRegions(input).map((region) => region.role))],
      },
      grid,
      table: {
        bbox: unionBox(words.filter((word) => word.cy >= schema.dataBand[1] && word.cy <= schema.dataBand[1] + schema.dataBand[3])),
        rowCount: rows.length,
        observedRowCount: rows.length,
        inferredRowCount: 0,
      },
      board: boardRef ? {
        ref: boardRef,
        header: calibrated.header,
        evidence: calibrated.evidence,
        classification,
        type: familyTypeCode(classification.family),
      } : null,
      rows,
      feeds,
      references,
      warnings: [...blockingReasons, ...reviewReasons.map((reason) => `schedule_grid_review:${reason}`)],
    };
  }

  function parseTrimbleStackedSchedulePage(input, words, profile, pageWidth, pageHeight) {
    const schema = trimbleColumnSchema(profile, pageWidth, pageHeight);
    if (!schema) {
      return {
        matched: false, confidence: profile.confidence, words: words.length, schema: null, rows: [], feeds: [], references: [],
        warnings: ['trimble_header_stack_not_resolved'],
      };
    }
    const header = trimbleBoardHeader(profile, words, schema, pageWidth);
    const calibratedHeader = applyHeaderCalibrations({ header: header.header, evidence: header.evidence }, input, words);
    header.header = calibratedHeader.header;
    header.evidence = calibratedHeader.evidence;
    header.boardRef = calibratedHeader.header.board_ref || header.boardRef;
    const anchors = wordsInRegion(words, schema.bounds.wayPhaseLeft, schema.bounds.wayPhaseRight,
      schema.dataBand[1], schema.dataBand[1] + schema.dataBand[3])
      .filter((item) => extractWayIdentifier(item.text) != null)
      .sort((left, right) => left.cy - right.cy || left.cx - right.cx);
    const rows = [];
    for (let index = 0; index < anchors.length; index += 1) {
      const top = Math.max(schema.dataBand[1], anchors[index].y0 - Math.max(2, anchors[index].height * 0.35));
      const nextTop = anchors[index + 1]?.y0;
      const bottom = Math.min(schema.dataBand[1] + schema.dataBand[3],
        Number.isFinite(nextTop) ? nextTop - Math.max(1, anchors[index].height * 0.2) : schema.dataBand[1] + schema.dataBand[3]);
      const groupWords = words.filter((item) => item.cy >= top && item.cy < bottom
        && item.x0 < schema.bounds.ratingRight);
      const row = trimbleRow(groupWords, anchors[index], top, bottom, schema, header.boardRef, header.header);
      if (row) rows.push(row);
    }
    schema.rowSpacing = median(anchors.slice(1).map((anchor, index) => anchor.cy - anchors[index].cy).filter((value) => value > 2));

    const blockingReasons = [];
    if (!header.boardRef) blockingReasons.push('primary_board_not_resolved');
    if (!anchors.length) blockingReasons.push('way_rows_not_resolved');
    if (!rows.some((row) => row.device || row.spare || row.space)) blockingReasons.push('no_bounded_schedule_rows');
    const reviewReasons = [];
    if (rows.some((row) => row.classConflict)) reviewReasons.push('explicit_device_class_conflict');
    if (rows.some((row) => row.poleConflict)) reviewReasons.push('phase_pole_conflict');
    if (rows.some((row) => row.validation?.invalidSensitivity || row.validation?.invalidBreakingCapacity)) reviewReasons.push('invalid_protection_unit_domain');
    if (rows.some((row) => row.requiresReview)) reviewReasons.push('row_review_required');
    const grid = {
      accepted: blockingReasons.length === 0,
      reasons: [...blockingReasons, ...reviewReasons],
      blockingReasons,
      reviewReasons,
      roles: schema.columns.map((column) => column.role),
      wayAnchors: anchors.length,
      distinctWays: new Set(rows.map((row) => row.way)).size,
      populatedRows: rows.filter((row) => row.device || row.spare || row.space).length,
    };
    const references = [];
    if (header.boardRef) references.push({
      role: 'primary_board', original: header.boardRef,
      normalised: Core.normaliseBoardReference(header.boardRef), line: null,
    });
    rows.forEach((row) => {
      if (!row.circuitReference) return;
      const normalised = Core.normaliseBoardReference(row.circuitReference);
      if (!normalised || references.some((item) => item.role === 'circuit_reference' && item.normalised === normalised)) return;
      references.push({ role: 'circuit_reference', original: row.circuitReference, normalised, line: null });
    });
    const classification = classifyBoardFamily(header.header, { devices: rows, policy: input.boardPolicy });
    const feeds = header.boardRef ? rows.filter((row) => row.circuitReference).map((row) => ({
      fromRef: header.boardRef,
      toRef: row.circuitReference,
      way: row.way,
      device: row.device,
      rating: row.rating,
      poles: row.poles,
      cable: row.cable,
      confidence: row.conf,
      sourceCell: row.fieldSources.circuitReference,
    })) : [];
    const warnings = [];
    if (!header.boardRef) warnings.push('primary_board_not_resolved');
    blockingReasons.filter((reason) => reason !== 'primary_board_not_resolved').forEach((reason) => warnings.push(`unproven_schedule_grid:${reason}`));
    reviewReasons.forEach((reason) => warnings.push(`schedule_grid_review:${reason}`));
    schema.transferEligible = grid.accepted && !reviewReasons.includes('explicit_device_class_conflict')
      && !reviewReasons.includes('invalid_protection_unit_domain');
    return {
      matched: grid.accepted,
      confidence: grid.accepted ? Math.min(profile.confidence, 0.98) : Math.min(profile.confidence, 0.6),
      words: words.length,
      dialect: schema.dialect,
      schema,
      calibration: {
        applied: calibrationRegions(input).length,
        roles: [...new Set(calibrationRegions(input).map((region) => region.role))],
      },
      grid,
      table: {
        bbox: unionBox(words.filter((item) => item.cy >= schema.dataBand[1] && item.cy <= schema.dataBand[1] + schema.dataBand[3])),
        rowCount: rows.length,
        observedRowCount: rows.length,
        inferredRowCount: 0,
      },
      board: header.boardRef ? {
        ref: header.boardRef,
        header: header.header,
        evidence: header.evidence,
        classification,
        type: familyTypeCode(classification.family),
      } : null,
      rows,
      feeds,
      references,
      warnings,
    };
  }

  function parseSpatialSchedulePage(input = {}) {
    const words = collectSpatialWords(input);
    const pageWidth = Number(input.pageWidth || input.width || Math.max(1, ...words.map((word) => word.x1)));
    const pageHeight = Number(input.pageHeight || input.height || Math.max(1, ...words.map((word) => word.y1)));
    if (words.length < 8 || !Number.isFinite(pageWidth) || !Number.isFinite(pageHeight)) {
      return { matched: false, confidence: 0, words: words.length, rows: [], feeds: [], references: [], warnings: ['insufficient_spatial_words'] };
    }
    const calibrations = calibrationRegions(input);
    const cableProfile = trimbleCableScheduleProfile(words, pageWidth);
    if (cableProfile.matched) {
      return parseTrimbleCableSchedulePage(input, words, cableProfile, pageWidth, pageHeight);
    }
    const trimbleProfile = trimbleDialectProfile(words);
    if (trimbleProfile.matched) {
      const trimbleResult = parseTrimbleStackedSchedulePage(input, words, trimbleProfile, pageWidth, pageHeight);
      if (trimbleResult.schema) return trimbleResult;
    }
    const tableRegion = calibrations.find((region) => region.role === 'outgoing_table');
    const tableWords = tableRegion ? wordsInsideCalibration(words, tableRegion, 1) : words;
    const wayRegion = calibrations.find((region) => region.role === 'way');
    const wayWords = wayRegion ? wordsInsideCalibratedColumn(tableWords.length ? tableWords : words, wayRegion, 2) : tableWords;
    const hintedWayX = wayRegion ? (wayRegion.box.x0 + wayRegion.box.x1) / 2
      : input.schemaHint?.columns?.find((column) => column.role === 'way')?.x;
    const allowSingleWay = Boolean(input.allowSingleWay || wayRegion);
    const wayAnchors = findWayAnchors(wayWords, pageWidth, { allowSingle: allowSingleWay, expectedX: hintedWayX });
    const inferredSchema = input.schemaHint
      ? continuationSchema(tableWords, wayAnchors, pageWidth, pageHeight, input.schemaHint)
      : inferScheduleColumns(tableWords, wayAnchors, pageWidth, pageHeight);
    const schema = calibratedSchema(inferredSchema, input, words, wayAnchors, pageWidth, pageHeight);
    const minimumWays = allowSingleWay ? 1 : 2;
    if (wayAnchors.length < minimumWays || !schema?.columns?.some((column) => column.role === 'way')) {
      return { matched: false, confidence: schema?.confidence || 0, words: words.length, schema, rows: [], feeds: [], references: [], warnings: ['way_column_not_resolved'] };
    }
    const header = extractSpatialBoardHeader(input, words, schema);
    const phaseLaneModel = inferPhaseLaneModel(words, wayAnchors, schema, header.header);
    if (schema.calibratedPhaseLayout === 'three_phase_rows' || schema.calibratedPhaseLayout === 'three_phase_merged') {
      phaseLaneModel.expectedSequence = ['L1', 'L2', 'L3'];
      phaseLaneModel.explicitColumnSequence = true;
      phaseLaneModel.headerSupportsThreePhase = true;
    }
    const context = {
      boardProtectionText: header.header.supply_cpd_details || '',
      boardHeader: header.header,
      phaseLaneModel,
      calibratedPhaseLayout: schema.calibratedPhaseLayout || header.header.phase_layout_calibration || null,
    };
    const ys = wayAnchors.map((word) => word.cy);
    const rows = [];
    for (let index = 0; index < wayAnchors.length; index += 1) {
      const top = index ? (ys[index - 1] + ys[index]) / 2 : schema.dataBand[1];
      const bottom = index < wayAnchors.length - 1 ? (ys[index] + ys[index + 1]) / 2 : schema.dataBand[1] + schema.dataBand[3];
      const rowWords = tableWords.filter((word) => word.cy >= top && word.cy < bottom);
      rows.push(...parseSpatialWayRows(rowWords, wayAnchors[index], top, bottom, schema, context));
    }
    reconcileProtectionStandardRows(words, wayAnchors, rows, schema, context);
    const governingNotes = Core.parseGoverningNotes(input.lines || []);
    if (governingNotes.length) rows.forEach((row) => Object.assign(row, Core.applyGoverningNotes(row, governingNotes)));
    const observedRows = rows.slice();
    const observedRowCount = observedRows.length;
    const observedWays = new Set(rows.map((row) => row.way).filter((way) => way != null));
    if (!schema.continuation && header.header.ways_total == null && observedWays.size) {
      header.header.ways_total = observedWays.size;
      header.evidence.ways_total = {
        text: `${observedWays.size} distinct way identifiers in the schedule table`,
        extractionMethod: 'Spatial table reconciliation',
        confidence: 0.86,
      };
    }
    const expectedWays = Number(header.header.ways_total);
    const usesOpaqueWays = rows.some((row) => typeof row.way === 'string' && !/^\d+$/.test(row.way));
    if (input.materializeMissingWays !== false && !usesOpaqueWays && Number.isInteger(expectedWays) && expectedWays > 0 && expectedWays <= 200) {
      const present = new Set(rows.map((row) => Number(row.way)).filter(Number.isInteger));
      for (let way = 1; way <= expectedWays; way += 1) {
        if (!present.has(way)) rows.push(inferredHeaderWay(way, header));
      }
      rows.sort((a, b) => String(a.way).localeCompare(String(b.way), undefined, { numeric: true, sensitivity: 'base' })
        || String(a.phase || '').localeCompare(String(b.phase || '')));
    }
    const classification = classifyBoardFamily(header.header, { devices: rows, policy: input.boardPolicy });
    const ref = header.header.board_ref || header.references.find((reference) => reference.role === 'primary_board')?.original || null;
    const feeds = ref ? rows.filter((row) => row.circuitReference).map((row) => ({
      fromRef: ref, toRef: row.circuitReference, way: row.way, device: row.device,
      rating: row.rating, poles: row.poles, cable: row.cable, confidence: row.conf,
      sourceCell: row.fieldSources.circuitReference,
    })) : [];
    const warnings = [];
    const grid = assessScheduleGrid(schema, observedRows, wayAnchors, minimumWays);
    if (!ref) warnings.push('primary_board_not_resolved');
    if (schema.confidence < 0.72) warnings.push('column_schema_review_required');
    grid.blockingReasons.forEach((reason) => warnings.push(`unproven_schedule_grid:${reason}`));
    grid.reviewReasons.forEach((reason) => warnings.push(`schedule_grid_review:${reason}`));
    if (rows.some((row) => row.inferredWay)) warnings.push('header_way_without_printed_row');
    if (rows.some((row) => row.phaseRepair)) warnings.push('source_phase_labels_reconciled');
    if (rows.some((row) => row.phaseConflict)) warnings.push('source_phase_labels_unresolved');
    if (rows.some((row) => row.requiresReview)) warnings.push('row_review_required');
    return {
      matched: grid.accepted,
      confidence: Math.min(schema.confidence, ref ? 0.98 : 0.65),
      words: words.length,
      schema,
      calibration: {
        applied: calibrations.length,
        roles: [...new Set(calibrations.map((region) => region.role))],
      },
      grid,
      table: {
        bbox: unionBox(words.filter((word) => word.cy >= schema.headerBand[1] && word.cy <= schema.dataBand[1] + schema.dataBand[3])),
        rowCount: rows.length,
        observedRowCount,
        inferredRowCount: rows.length - observedRowCount,
      },
      board: ref ? { ref, header: header.header, evidence: header.evidence, classification, type: familyTypeCode(classification.family) } : null,
      rows,
      feeds,
      references: header.references,
      warnings,
    };
  }

  function buildSpatialLayoutHint(result, { maxRows = 80 } = {}) {
    if (!result?.schema?.columns) return null;
    return {
      version: 1,
      table: {
        bbox: result.table?.bbox || null,
        confidence: result.schema.confidence,
        columns: result.schema.columns.map((column) => ({ role: column.role, x: Number(column.x.toFixed(2)), source: column.source })),
        rows: (result.rows || []).slice(0, maxRows).map((row) => ({
          way: row.way, phase: row.phase, device: row.device, standard: row.protectionStandard,
          trip_unit: row.tripUnit, rating_a: row.rating, breaking_capacity_ka: row.ka,
          rcd_protected: row.rcdProtected, rcd_ma: row.sens, afdd: row.afdd,
          circuit_reference: row.circuitReference, confidence: row.conf,
          source_region: row.highlightBbox || row.sourceCell?.bbox || null,
        })),
      },
      board: result.board ? {
        ref: result.board.ref,
        family: result.board.classification.family,
        header: result.board.header,
      } : null,
      warnings: result.warnings || [],
    };
  }

  function scaleSpatialSchemaHint(schema, sourceWidth, sourceHeight, targetWidth, targetHeight) {
    if (!schema?.columns?.length) return null;
    const fromWidth = Number(sourceWidth);
    const fromHeight = Number(sourceHeight);
    const toWidth = Number(targetWidth);
    const toHeight = Number(targetHeight);
    if (![fromWidth, fromHeight, toWidth, toHeight].every((value) => Number.isFinite(value) && value > 0)) return null;
    const xScale = toWidth / fromWidth;
    const yScale = toHeight / fromHeight;
    const scaleBand = (band) => Array.isArray(band) && band.length >= 4
      ? [Number(band[0]) * xScale, Number(band[1]) * yScale, Number(band[2]) * xScale, Number(band[3]) * yScale]
      : null;
    return {
      ...schema,
      columns: schema.columns.map((column) => ({
        ...column,
        x: Number(column.x) * xScale,
        left: Number.isFinite(Number(column.left)) ? Number(column.left) * xScale : undefined,
        right: Number.isFinite(Number(column.right)) ? Number(column.right) * xScale : undefined,
      })),
      headerBand: scaleBand(schema.headerBand),
      dataBand: scaleBand(schema.dataBand),
      rowSpacing: Number(schema.rowSpacing || 0) * yScale,
      scaledFrom: { width: fromWidth, height: fromHeight },
    };
  }

  function spatialSchemaTransferEligible(result) {
    if (!result?.matched || !result.rows?.length || !result.schema?.columns?.length) return false;
    if (result.schema.transferEligible === false || result.grid?.accepted === false) return false;
    if (!result.board?.ref) return false;
    const blockingWarnings = (result.warnings || []).some((warning) => /^(?:primary_board_not_resolved|unproven_schedule_grid:)/.test(warning));
    if (blockingWarnings) return false;
    const activeRows = result.rows.filter((row) => Core.isPopulatedProtectionRow
      ? Core.isPopulatedProtectionRow(row) : !row.space && !row.spare);
    return activeRows.every((row) => !row.classConflict
      && !row.validation?.invalidSensitivity && !row.validation?.invalidBreakingCapacity);
  }

  function spatialOccupancyContinuationEligible(result) {
    if (!result?.matched || !result.rows?.length || result.grid?.accepted === false) return false;
    const observed = result.rows.filter((row) => !row.inferredWay);
    const occupancyRows = observed.filter((row) => row.way != null && (row.spare || row.space));
    const activeRows = observed.filter((row) => Core.isPopulatedProtectionRow
      ? Core.isPopulatedProtectionRow(row) : !row.space && !row.spare);
    if (activeRows.length || !occupancyRows.length) return false;
    if (occupancyRows.length !== observed.length) return false;
    if (new Set(occupancyRows.map((row) => String(row.way))).size < 1) return false;
    return occupancyRows.every((row) => !row.classConflict && !row.phaseConflict
      && !row.validation?.invalidSensitivity && !row.validation?.invalidBreakingCapacity);
  }

  function spatialParseQuality(result) {
    const rows = result?.matched && Array.isArray(result.rows) ? result.rows : [];
    const activeRows = rows.filter((row) => Core.isPopulatedProtectionRow
      ? Core.isPopulatedProtectionRow(row) : !row.space && !row.spare);
    const completeRows = activeRows.filter((row) => row.device && row.rating != null);
    return {
      rows: rows.length,
      activeRows: activeRows.length,
      completeRows: completeRows.length,
      completeness: activeRows.length ? completeRows.length / activeRows.length : (rows.length ? 1 : 0),
      gridAccepted: result?.grid?.accepted !== false,
      boardResolved: Boolean(result?.board?.ref),
    };
  }

  function automaticGeometryShouldReplaceCalibration(calibrated, automatic) {
    const baseline = spatialParseQuality(automatic);
    if (!baseline.rows) return false;
    const guided = spatialParseQuality(calibrated);
    if (!guided.rows) return true;
    if (!guided.gridAccepted && baseline.gridAccepted) return true;
    if (!guided.boardResolved && baseline.boardResolved && baseline.rows >= guided.rows) return true;
    const materialLoss = baseline.rows >= guided.rows + Math.max(2, Math.ceil(guided.rows * 0.25));
    return materialLoss && baseline.completeRows >= guided.completeRows
      && baseline.completeness + 0.05 >= guided.completeness;
  }

  function parseSpatialScheduleDocument(pageInputs = [], options = {}) {
    const pages = (pageInputs || []).map((input, index) => ({
      ...input,
      documentPage: Number(input.documentPage || input.page || index + 1),
    }));
    const independent = pages.map((input) => {
      const savedCalibration = calibrationRegions(input);
      const strict = parseSpatialSchedulePage(input);
      const attempts = [{ strategy: savedCalibration.length ? 'geometry-calibrated' : 'geometry-strict',
        matched: Boolean(strict.matched && strict.rows?.length), rows: strict.rows?.length || 0 }];
      let result = strict;
      if (savedCalibration.length) {
        const automatic = parseSpatialSchedulePage({
          ...input,
          calibrationHint: { applicable: 0, regions: [], roles: [] },
        });
        const fallback = automaticGeometryShouldReplaceCalibration(strict, automatic);
        attempts.push({ strategy: 'geometry-automatic-fallback',
          matched: Boolean(automatic.matched && automatic.rows?.length), rows: automatic.rows?.length || 0,
          selected: fallback });
        if (fallback) {
          const savedRoles = [...new Set(savedCalibration.map((region) => region.role))];
          const selectedBoard = strict.board?.ref ? strict.board : automatic.board;
          const selectedBoardRef = selectedBoard?.ref || automatic.board?.ref || null;
          result = {
            ...automatic,
            board: selectedBoard || null,
            feeds: selectedBoardRef ? (automatic.feeds || []).map((feed) => ({ ...feed, fromRef: selectedBoardRef })) : automatic.feeds,
            calibration: {
              applicable: savedCalibration.length,
              applied: 0,
              roles: savedRoles,
              fallback: 'automatic_baseline_recovered_rows',
            },
            warnings: [...new Set([...(automatic.warnings || []), 'user_calibration_fell_back_to_automatic_geometry'])],
          };
        }
      }
      if ((!strict.matched || !strict.rows?.length) && input.allowSingleWay) {
        const permissive = parseSpatialSchedulePage({ ...input, allowSingleWay: true, materializeMissingWays: false });
        attempts.push({ strategy: 'geometry-single-way', matched: Boolean(permissive.matched && permissive.rows?.length), rows: permissive.rows?.length || 0 });
        if ((!result.matched || !result.rows?.length) && permissive.matched && permissive.rows?.length) result = permissive;
      }
      return { input, result, attempts };
    });
    const catalogue = independent.filter((entry) => spatialSchemaTransferEligible(entry.result))
      .map((entry) => ({
        page: entry.input.documentPage,
        width: Number(entry.input.pageWidth || entry.input.width),
        height: Number(entry.input.pageHeight || entry.input.height),
        schema: entry.result.schema,
        confidence: Number(entry.result.confidence || entry.result.schema.confidence || 0),
      }));
    const limit = Math.max(1, Math.min(6, Number(options.maxSchemaCandidates) || 4));
    const outputs = independent.map((entry) => {
      if (entry.result?.matched && entry.result.rows?.length) return { ...entry, schemaSourcePage: entry.input.documentPage };
      const width = Number(entry.input.pageWidth || entry.input.width);
      const height = Number(entry.input.pageHeight || entry.input.height);
      const aspect = width / Math.max(1, height);
      const hints = catalogue.map((candidate) => ({
        ...candidate,
        aspectDelta: Math.abs(aspect - candidate.width / Math.max(1, candidate.height)),
        pageDistance: Math.abs(entry.input.documentPage - candidate.page),
      })).filter((candidate) => candidate.aspectDelta <= Math.max(0.12, aspect * 0.16))
        .sort((left, right) => left.aspectDelta - right.aspectDelta
          || right.confidence - left.confidence || left.pageDistance - right.pageDistance)
        .slice(0, limit);
      const candidates = [];
      for (const hint of hints) {
        const targetRoles = new Set((entry.result?.schema?.columns || []).map((column) => column.role));
        const hintRoles = new Set((hint.schema?.columns || []).map((column) => column.role));
        const overlap = [...targetRoles].filter((role) => hintRoles.has(role)).length;
        const roleCompatibility = targetRoles.size ? overlap / targetRoles.size : 1;
        if (targetRoles.size >= 3 && roleCompatibility < 0.6) continue;
        const schemaHint = scaleSpatialSchemaHint(hint.schema, hint.width, hint.height, width, height);
        if (!schemaHint) continue;
        const recovered = parseSpatialSchedulePage({
          ...entry.input,
          schemaHint,
          allowSingleWay: true,
          materializeMissingWays: false,
        });
        entry.attempts.push({
          strategy: 'geometry-document-schema',
          sourcePage: hint.page,
          matched: false,
          rows: recovered.rows?.length || 0,
        });
        if (recovered.matched && recovered.rows?.length) {
          const activeRows = recovered.rows.filter((row) => Core.isPopulatedProtectionRow
            ? Core.isPopulatedProtectionRow(row) : !row.space && !row.spare);
          const completeRows = activeRows.filter((row) => row.device && row.rating != null);
          const unresolvedPhaseRows = recovered.rows.filter((row) => row.phaseConflict).length;
          const completeness = activeRows.length ? completeRows.length / activeRows.length : 1;
          const occupancyContinuation = spatialOccupancyContinuationEligible(recovered);
          const transferAccepted = Number(recovered.confidence || 0) >= 0.62
            && Number(recovered.grid?.populatedRows || 0) > 0
            && unresolvedPhaseRows <= Math.max(1, Math.floor(recovered.rows.length * 0.5))
            && (occupancyContinuation
              || (completeness >= 0.5 && spatialSchemaTransferEligible(recovered)));
          entry.attempts[entry.attempts.length - 1].matched = transferAccepted;
          entry.attempts[entry.attempts.length - 1].completeness = Number(completeness.toFixed(2));
          entry.attempts[entry.attempts.length - 1].occupancyContinuation = occupancyContinuation;
          if (transferAccepted) candidates.push({ result: recovered, hint, completeness });
        }
      }
      candidates.sort((left, right) => Number(right.result.confidence || 0) - Number(left.result.confidence || 0)
        || Number(right.completeness || 0) - Number(left.completeness || 0)
        || Number(right.result.grid?.populatedRows || 0) - Number(left.result.grid?.populatedRows || 0)
        || left.hint.pageDistance - right.hint.pageDistance);
      return candidates.length
        ? { ...entry, result: candidates[0].result, schemaSourcePage: candidates[0].hint.page }
        : { ...entry, schemaSourcePage: null };
    });
    return { pages: outputs, catalogue };
  }

  function schematicPoleConfiguration(text) {
    const source = String(text || '').toUpperCase().replace(/\s+/g, ' ');
    const token = source.match(/\b(TPN|SPN|DPN|TP|DP|SP|4P|3P|2P|1P)\b/)?.[1] || null;
    if (!token) return { poleConfiguration: null, poles: null };
    const poles = token === 'TPN' || token === '4P' ? 4
      : token === 'TP' || token === '3P' ? 3
        : token === 'DPN' || token === 'DP' || token === '2P' ? 2 : 1;
    return { poleConfiguration: token, poles };
  }

  function schematicCable(text) {
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    const sizeMatch = source.match(/\b(\d+(?:\.\d+)?)\s*mm(?:2|\u00b2)?\b/i);
    if (!sizeMatch) return source || null;
    const coresMatch = source.match(/\b([234])\s*(?:C|CORE)\b/i);
    const cpcMatch = source.match(/(?:\+|MIN(?:IMUM)?)\s*(\d+(?:\.\d+)?)\s*mm(?:2|\u00b2)?\s*CPC\b/i);
    const typeMatch = source.match(/\b(XLPE(?:\s*\/\s*SWA)?(?:\s*\/\s*(?:LSZH|LSF))?|SWA|LSZH|LSF|PVC)\b/i);
    return {
      size: Number(sizeMatch[1]),
      cores: coresMatch ? Number(coresMatch[1]) : null,
      cpc: cpcMatch ? Number(cpcMatch[1]) : null,
      typeCode: typeMatch ? typeMatch[1].replace(/\s+/g, '').toUpperCase() : null,
      description: source,
    };
  }

  function parseSpatialSchematicPage(input = {}) {
    // Schematics are connectivity graphs. Once the topology engine is loaded,
    // never fall back to coordinate proximity unless an isolated legacy test
    // opts in explicitly.
    if (Core.parseSchematicTopologyPage && input.allowLegacyProximity !== true) {
      return Core.parseSchematicTopologyPage(input);
    }
    const words = collectSpatialWords(input);
    const pageWidth = Number(input.pageWidth) || Math.max(1, ...words.map((word) => word.x1));
    const pageHeight = Number(input.pageHeight) || Math.max(1, ...words.map((word) => word.y1));
    if (words.length < 8) return { matched: false, confidence: 0, boards: [], feeds: [], devices: [], warnings: ['insufficient_spatial_text'] };

    const legendBoundaryX = (() => {
      const legendWords = words.filter((word) => /^LEGEND$/i.test(word.text));
      if (!legendWords.length) return null;
      const rightmost = legendWords.sort((left, right) => right.cx - left.cx)[0];
      return rightmost.cx >= pageWidth * 0.68 ? rightmost.x0 - Math.max(12, pageWidth * 0.01) : null;
    })();
    const boardCandidates = [];
    const addBoardCandidate = (original, items) => {
      const canonical = Core.canonicalBoardReference(original);
      if (!canonical.normalised) return;
      const cell = sourceCell(items, 'schematic_board_reference');
      if (!cell) return;
      const box = bboxObject(cell.bbox);
      if (!box) return;
      if (Number.isFinite(legendBoundaryX) && box.x0 >= legendBoundaryX) return;
      const candidate = {
        ref: canonical.display || original,
        norm: canonical.normalised,
        sourceCell: cell,
        bbox: cell.bbox,
        cx: (box.x0 + box.x1) / 2,
        cy: (box.y0 + box.y1) / 2,
        labelAxis: (() => {
          const first = normaliseWord(items?.[0]);
          if (!first) return 'horizontal';
          const angle = ((Number(first.rotation) % 360) + 360) % 360;
          return (angle >= 55 && angle <= 125) || (angle >= 235 && angle <= 305) || first.height > first.width * 1.35
            ? 'vertical' : 'horizontal';
        })(),
        confidence: cell.confidence,
      };
      const duplicate = boardCandidates.find((item) => item.norm === candidate.norm);
      if (!duplicate) boardCandidates.push(candidate);
    };
    for (const word of words) {
      Core.extractBoardReferences(word.text).forEach((reference) => addBoardCandidate(reference.original, [word]));
      const lvs = word.text.match(/\bLVS[\s._/-]?\d+\b/gi) || [];
      lvs.forEach((reference) => addBoardCandidate(reference, [word]));
    }
    for (const line of input.lines || []) {
      const lineWords = (line?.words || []).map(normaliseWord).filter(Boolean);
      if (!lineWords.length) continue;
      Core.extractBoardReferences(line.text || '').forEach((reference) => addBoardCandidate(reference.original, lineWords));
      const lvs = String(line.text || '').match(/\bLVS[\s._/-]?\d+\b/gi) || [];
      lvs.forEach((reference) => addBoardCandidate(reference, lineWords));
    }

    const vertical = (word) => {
      const angle = ((Number(word.rotation) % 360) + 360) % 360;
      return (angle >= 55 && angle <= 125) || (angle >= 235 && angle <= 305) || word.height > word.width * 1.35;
    };
    const laneTolerance = Math.max(10, Math.min(26, Math.min(pageWidth, pageHeight) * 0.009));
    const ratingWords = words.filter((word) => /^\s*\d{1,4}(?:\.\d+)?\s*A\s*$/i.test(word.text));
    const coordinateRange = (items, field) => items.length
      ? Math.max(...items.map((item) => item[field])) - Math.min(...items.map((item) => item[field])) : 0;
    const laneAxis = coordinateRange(ratingWords, 'cx') >= coordinateRange(ratingWords, 'cy') ? 'x' : 'y';
    const lanes = [];
    for (const ratingWord of ratingWords) {
      const axis = laneAxis;
      const coordinate = axis === 'x' ? ratingWord.cx : ratingWord.cy;
      if (lanes.some((lane) => lane.axis === axis && Math.abs(lane.coordinate - coordinate) <= laneTolerance)) continue;
      const laneWords = words.filter((word) => Math.abs((axis === 'x' ? word.cx : word.cy) - coordinate) <= laneTolerance);
      const laneText = laneWords.map((word) => word.text).join(' ');
      const deviceWord = laneWords.find((word) => /^(?:MCCB|MCB|ACB|RCBO|RCCB)$/i.test(word.text))
        || laneWords.find((word) => /^(?:FUSE|SWITCH\s*FUSE|FUSE\s*SWITCH)$/i.test(word.text));
      if (!deviceWord) continue;
      const device = /MCCB/i.test(deviceWord.text) ? 'MCCB'
        : /RCBO/i.test(deviceWord.text) ? 'RCBO'
          : /RCCB/i.test(deviceWord.text) ? 'RCCB'
            : /ACB/i.test(deviceWord.text) ? 'ACB'
              : /MCB/i.test(deviceWord.text) ? 'MCB' : 'Fuse';
      const rating = Number(ratingWord.text.match(/\d+(?:\.\d+)?/)?.[0]);
      const poleWord = laneWords.find((word) => /^(?:TPN|SPN|DPN|TP|DP|SP|4P|3P|2P|1P)$/i.test(word.text));
      const pole = schematicPoleConfiguration(poleWord?.text || laneText);
      const cableWords = laneWords.filter((word) => /(?:MM(?:2|\u00b2)?|XLPE|SWA|LSZH|LSF|PVC|CPC|CORE)/i.test(word.text));
      const cableCell = sourceCell(cableWords, 'schematic_cable');
      const cable = schematicCable(cableCell?.text || '');
      const confidenceParts = [ratingWord.confidence, deviceWord.confidence];
      if (poleWord) confidenceParts.push(poleWord.confidence);
      if (cableCell) confidenceParts.push(cableCell.confidence);
      lanes.push({
        axis, coordinate, alongCoordinate: axis === 'x' ? ratingWord.cy : ratingWord.cx, words: laneWords, rating, device, ...pole, cable,
        ratingCell: sourceCell([ratingWord], 'schematic_rating'),
        deviceCell: sourceCell([deviceWord], 'schematic_device'),
        poleCell: poleWord ? sourceCell([poleWord], 'schematic_poles') : null,
        cableCell,
        confidence: Math.min(0.88, confidenceParts.reduce((sum, value) => sum + value, 0) / confidenceParts.length),
      });
    }

    let sourceBoards = boardCandidates.filter((board) => /^LVS/.test(board.norm));
    if (!sourceBoards.length) sourceBoards = boardCandidates.filter((board) => /^(?:MSB|MDB|SMDB|PB)/.test(board.norm));
    if (!sourceBoards.length) sourceBoards = boardCandidates.filter((board) => /^MAIN/.test(board.norm));
    const targetBoards = boardCandidates.filter((board) => !sourceBoards.includes(board) && !/^(?:MAIN|MSB|MDB|SMDB|LVS)/.test(board.norm));
    const boardMetadataDirection = (board, axis) => {
      const boardCoordinate = axis === 'x' ? board.cx : board.cy;
      const boardAlong = axis === 'x' ? board.cy : board.cx;
      const candidates = words.filter((word) => /^(?:\[[^\]]{2,80}\]|\d{1,3}\s*(?:-|\s)?WAYS?|WAY\s*[-:]?\s*\d{1,3}\s*\+\s*\d{1,3})$/i.test(word.text.trim()))
        .map((word) => ({ word, cross: axis === 'x' ? word.cx : word.cy, along: axis === 'x' ? word.cy : word.cx }))
        .filter((item) => Math.abs(item.cross - boardCoordinate) <= laneTolerance * 2.5
          && Math.abs(item.along - boardAlong) <= Math.max(90, (axis === 'x' ? pageHeight : pageWidth) * 0.16))
        .sort((left, right) => Math.abs(left.cross - boardCoordinate) - Math.abs(right.cross - boardCoordinate));
      const delta = candidates.length ? candidates[0].cross - boardCoordinate : 0;
      return Math.abs(delta) >= 2 ? Math.sign(delta) : 0;
    };
    const matches = [];
    for (const lane of lanes) {
      for (const board of targetBoards) {
        const boardCoordinate = lane.axis === 'x' ? board.cx : board.cy;
        const signedDistance = lane.coordinate - boardCoordinate;
        const direction = boardMetadataDirection(board, lane.axis);
        if (direction && Math.sign(signedDistance) !== direction) continue;
        const distance = Math.abs(signedDistance);
        const maximum = lane.axis === 'x' ? Math.max(45, pageWidth * 0.035) : Math.max(35, pageHeight * 0.035);
        if (distance <= maximum) matches.push({ lane, board, distance });
      }
    }
    matches.sort((left, right) => left.distance - right.distance);
    const assignedLanes = new Set();
    const assignedBoards = new Set();
    const feedMatches = [];
    for (const match of matches) {
      if (assignedLanes.has(match.lane) || assignedBoards.has(match.board.norm)) continue;
      assignedLanes.add(match.lane);
      assignedBoards.add(match.board.norm);
      feedMatches.push(match);
    }

    const decorateBoard = (board) => {
      const verticalLabel = board.labelAxis === 'vertical';
      const sameLane = words.filter((word) => {
        const crossDistance = verticalLabel ? Math.abs(word.cx - board.cx) : Math.abs(word.cy - board.cy);
        const alongDistance = verticalLabel ? Math.abs(word.cy - board.cy) : Math.abs(word.cx - board.cx);
        return crossDistance <= laneTolerance * 1.6 && alongDistance <= Math.max(90, (verticalLabel ? pageHeight : pageWidth) * 0.16);
      });
      const proximity = (word) => verticalLabel ? Math.abs(word.cx - board.cx) : Math.abs(word.cy - board.cy);
      const locationWord = sameLane.filter((word) => /^\s*\[[^\]]{2,80}\]\s*$/.test(word.text)).sort((left, right) => proximity(left) - proximity(right))[0];
      const wayWord = sameLane.filter((word) => /\b\d{1,3}\s*(?:-|\s)?WAYS?\b/i.test(word.text)).sort((left, right) => proximity(left) - proximity(right))[0];
      const splitWayWord = sameLane.filter((word) => /\bWAY\s*[-:]?\s*\d{1,3}\s*\+\s*\d{1,3}\b/i.test(word.text)).sort((left, right) => proximity(left) - proximity(right))[0];
      const wayText = splitWayWord?.text || wayWord?.text || '';
      const split = wayText.match(/\bWAY\s*[-:]?\s*(\d{1,3})\s*\+\s*(\d{1,3})\b/i);
      const single = wayText.match(/\b(\d{1,3})\s*(?:-|\s)?WAYS?\b/i);
      const splitTotal = split && Number(split[1]) <= 48 && Number(split[2]) <= 48 ? Number(split[1]) + Number(split[2]) : null;
      return {
        ...board,
        location: locationWord ? locationWord.text.replace(/^\s*\[|\]\s*$/g, '').trim() : null,
        waysTotal: splitTotal || (single && Number(single[1]) <= 72 ? Number(single[1]) : null),
        locationCell: locationWord ? sourceCell([locationWord], 'schematic_location') : null,
        waysCell: (splitWayWord || wayWord) ? sourceCell([splitWayWord || wayWord], 'schematic_ways') : null,
      };
    };
    const boards = boardCandidates.map(decorateBoard);
    const feeds = feedMatches.map(({ lane, board }) => ({
      fromRef: sourceBoards.slice().sort((left, right) => {
        const leftDistance = Math.abs((lane.axis === 'x' ? left.cx : left.cy) - lane.coordinate)
          + Math.abs((lane.axis === 'x' ? left.cy : left.cx) - lane.alongCoordinate) * 3;
        const rightDistance = Math.abs((lane.axis === 'x' ? right.cx : right.cy) - lane.coordinate)
          + Math.abs((lane.axis === 'x' ? right.cy : right.cx) - lane.alongCoordinate) * 3;
        return leftDistance - rightDistance;
      })[0]?.ref || null,
      toRef: board.ref,
      rating: lane.rating,
      device: lane.device,
      poles: lane.poles,
      poleConfiguration: lane.poleConfiguration,
      cable: lane.cable,
      confidence: lane.confidence,
      sourceCell: sourceCell([lane.ratingCell, lane.deviceCell, lane.poleCell, lane.cableCell]
        .filter(Boolean).flatMap((cell) => cell.words || []), 'schematic_feeder'),
      fieldSources: {
        rating: lane.ratingCell,
        device: lane.deviceCell,
        poles: lane.poleCell,
        cable: lane.cableCell,
      },
    }));
    const devices = [];
    for (const { lane, board } of feedMatches) {
      const meter = lane.words.find((word) => /^(?:M|METER)$/i.test(word.text));
      const spd = lane.words.find((word) => /^(?:SPD|1\s*\+\s*2|T1\s*\+\s*T2)$/i.test(word.text));
      if (meter) devices.push({ boardRef: board.ref, device: 'Meter', desc: 'Schematic meter', confidence: Math.min(0.72, meter.confidence), sourceCell: sourceCell([meter], 'schematic_accessory') });
      if (spd) devices.push({ boardRef: board.ref, device: 'SPD', desc: /1\s*\+\s*2/i.test(spd.text) ? 'Type 1+2 surge protection' : 'Surge protection', confidence: Math.min(0.72, spd.confidence), sourceCell: sourceCell([spd], 'schematic_accessory') });
    }
    for (const lane of lanes.filter((candidate) => !assignedLanes.has(candidate))) {
      const spare = lane.words.find((word) => /^SPARE$/i.test(word.text));
      const sourceBoard = sourceBoards.slice().sort((left, right) => {
        const leftDistance = Math.abs((lane.axis === 'x' ? left.cx : left.cy) - lane.coordinate)
          + Math.abs((lane.axis === 'x' ? left.cy : left.cx) - lane.alongCoordinate) * 3;
        const rightDistance = Math.abs((lane.axis === 'x' ? right.cx : right.cy) - lane.coordinate)
          + Math.abs((lane.axis === 'x' ? right.cy : right.cx) - lane.alongCoordinate) * 3;
        return leftDistance - rightDistance;
      })[0];
      if (!spare || !sourceBoard) continue;
      devices.push({ boardRef: sourceBoard.ref, device: lane.device, rating: lane.rating, poles: lane.poles,
        poleConfiguration: lane.poleConfiguration, spare: true, desc: 'Spare outgoing way', confidence: lane.confidence,
        sourceCell: sourceCell([spare], 'schematic_spare') });
    }

    const warnings = [];
    if (!sourceBoards.length) warnings.push('schematic_source_board_not_resolved');
    if (boardCandidates.length > 1 && !feeds.length) warnings.push('schematic_feeder_lanes_not_resolved');
    if (lanes.some((lane) => !lane.cable)) warnings.push('schematic_feeder_cable_missing');
    return {
      matched: feeds.length > 0,
      confidence: feeds.length ? feeds.reduce((sum, feed) => sum + feed.confidence, 0) / feeds.length : 0,
      boards,
      feeds,
      devices,
      warnings,
      sourceBoards: sourceBoards.map((board) => board.norm),
      laneCount: lanes.length,
    };
  }

  function deduplicateFeederRelationships(feeders = []) {
    const present = (value) => value !== undefined && value !== null && value !== '';
    const normal = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
    const sameKnownValue = (left, right) => !present(left) || !present(right) || normal(left) === normal(right);
    const sameCable = (left, right) => {
      if (!left || !right) return true;
      if (typeof left === 'string' || typeof right === 'string') return normal(left) === normal(right);
      return ['ref', 'size', 'cpc', 'cores', 'typeCode'].every((field) => sameKnownValue(left[field], right[field]));
    };
    const compatible = (left, right) => normal(left.from) === normal(right.from)
      && normal(left.to) === normal(right.to)
      && sameKnownValue(left.way, right.way)
      && sameKnownValue(left.device, right.device)
      && sameKnownValue(left.rating, right.rating)
      && sameKnownValue(left.poles, right.poles)
      && sameCable(left.cable, right.cable);
    const evidenceFor = (feeder) => ({
      fileId: feeder.fileId ?? null,
      page: feeder.page ?? null,
      line: feeder.line ?? null,
      srcText: feeder.srcText || null,
      bbox: feeder.bbox || null,
      confidence: Number(feeder.conf) || null,
      spatial: Boolean(feeder.spatial),
      ai: Boolean(feeder.ai),
    });
    const mergeCable = (primary, secondary) => {
      if (!primary) return secondary || null;
      if (!secondary || typeof primary === 'string' || typeof secondary === 'string') return primary;
      const merged = { ...primary };
      Object.entries(secondary).forEach(([field, value]) => {
        if (!present(merged[field]) && present(value)) merged[field] = value;
      });
      return merged;
    };
    const distinct = [];
    const duplicates = [];
    for (const feeder of feeders.filter((item) => item?.to)) {
      const matches = distinct.filter((item) => compatible(item, feeder));
      if (matches.length !== 1) {
        distinct.push({ ...feeder, evidence: [...(feeder.evidence || []), evidenceFor(feeder)] });
        continue;
      }
      const existing = matches[0];
      const preferred = (Number(feeder.conf) || 0) > (Number(existing.conf) || 0) ? feeder : existing;
      const secondary = preferred === feeder ? existing : feeder;
      const merged = { ...preferred };
      ['from', 'to', 'way', 'device', 'rating', 'poles', 'srcText', 'bbox'].forEach((field) => {
        if (!present(merged[field]) && present(secondary[field])) merged[field] = secondary[field];
      });
      merged.cable = mergeCable(preferred.cable, secondary.cable);
      merged.conf = Math.max(Number(existing.conf) || 0, Number(feeder.conf) || 0);
      merged.spatial = Boolean(existing.spatial || feeder.spatial);
      merged.ai = Boolean(existing.ai || feeder.ai);
      merged.evidence = [...(existing.evidence || [evidenceFor(existing)]), ...(feeder.evidence || [evidenceFor(feeder)])];
      const index = distinct.indexOf(existing);
      distinct[index] = merged;
      duplicates.push({ keptId: merged.id || null, duplicateId: secondary.id || null, reason: 'compatible_feeder_evidence' });
    }
    return { feeders: distinct, duplicates };
  }

  Object.assign(Core, {
    DEFAULT_BOARD_CLASSIFICATION_POLICY,
    CALIBRATION_ROLE_DEFINITIONS,
    buildCalibrationSignature,
    resolveCalibrationRegion,
    collectSpatialWords,
    extractContextualBoardReferences,
    inferScheduleColumns,
    parseProtectionDescriptor,
    resolveProtectionDevice,
    classifyBoardFamily,
    familyTypeCode,
    parseSpatialSchedulePage,
    parseSpatialScheduleDocument,
    trimbleCableScheduleProfile,
    assessScheduleGrid,
    parseSpatialSchematicPage,
    buildSpatialLayoutHint,
    scaleSpatialSchemaHint,
    deduplicateFeederRelationships,
    parseProtectionIndicator: indicatorValue,
    extractWayIdentifier,
  });
})(globalThis);
