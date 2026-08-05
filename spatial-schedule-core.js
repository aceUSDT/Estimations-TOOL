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
    { role: 'rating', patterns: [/\bRATING\b.*(?:A|AMP)/, /CURRENT.*RATING/, /^IN\s*\(?A\)?$/] },
    { role: 'trip_curve', patterns: [/TRIP.*CURVE/, /CHARACTERISTIC/, /^CURVE$/] },
    { role: 'breaking_capacity', patterns: [/SHORT.*CIRCUIT.*CAPACITY/, /(?=.*\bSHORT\b)(?=.*\bCIRCUIT\b)(?=.*\bCAPACITY\b)/, /BREAKING.*CAPACITY/, /FAULT.*RATING/, /^KA$/] },
    { role: 'afdd', patterns: [/\bAFDD\b/, /\bAFFD\b/, /ARC.*FAULT/] },
    { role: 'rcd', patterns: [/^RCD$/, /RCD.*(?:YES|NO|PROTECT)/] },
    { role: 'rcd_ma', patterns: [/RCD.*OPERATING.*CURRENT/, /RCD.*\bMA\b/, /^\(?MA\)?$/] },
    { role: 'circuit_reference', patterns: [/CIRCUIT.*REFERENCE/, /LOAD.*REFERENCE/] },
    { role: 'description', patterns: [/CIRCUIT.*DESCRIPTION/, /^DUTY$/, /^DESCRIPTION$/, /LOAD.*DESCRIPTION/] },
    { role: 'circuit_type', patterns: [/CIRCUIT.*TYPE/, /CIRCUIT.*CONFIG/, /^CONFIG(?:URATION)?$/] },
    { role: 'line_csa', patterns: [/(?:LIVE|LINE|PHASE).*\bMM/, /CONDUCTOR.*SIZE/] },
    { role: 'cpc_csa', patterns: [/\bCPC\b/, /EARTH.*(?:SIZE|CSA)/] },
    { role: 'cable_type', patterns: [/CABLE.*TYPE/, /CABLE.*CODE/] },
    { role: 'install_method', patterns: [/INSTALL.*METHOD/, /REFERENCE.*METHOD/] },
    { role: 'max_disconnect', patterns: [/DIS.*CONN.*TIME/, /DISCONNECTION.*TIME/] },
    { role: 'max_zs', patterns: [/MAX.*ZS/, /ZS.*MAX/] },
  ];

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

  function extractWayNumber(value) {
    const match = String(value || '').trim().match(/^(?:(?:WAY|CCT|CKT|CIRCUIT)\s*[:#-]?\s*)?(\d{1,3})(?:\s*[\/-]\s*L[123])?$/i);
    if (!match) return null;
    const way = Number(match[1]);
    return way >= 1 && way <= 200 ? way : null;
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
    const candidates = horizontalWords(words).filter((word) => extractWayNumber(word.text) != null && word.cx <= pageWidth * 0.38);
    const clusters = clusterByX(candidates, Math.max(5, pageWidth * 0.012));
    const scored = clusters.map((cluster) => {
      const sorted = cluster.words.slice().sort((a, b) => a.cy - b.cy);
      const values = sorted.map((word) => extractWayNumber(word.text));
      const unique = new Set(values).size;
      let consecutive = 0;
      for (let i = 1; i < values.length; i += 1) if (values[i] === values[i - 1] + 1) consecutive += 1;
      const phaseSupport = sorted.filter((word) => words.some((other) => /^L[123]$/i.test(other.text)
        && other.cx > word.cx && other.cx - word.cx < pageWidth * 0.16 && Math.abs(other.cy - word.cy) < Math.max(18, word.height * 2))).length;
      const expectedBoost = Number.isFinite(options.expectedX)
        ? Math.max(-4, 7 - Math.abs(cluster.cx - Number(options.expectedX)) / Math.max(3, pageWidth * 0.01))
        : 0;
      return { ...cluster, sorted, score: unique * 2 + consecutive * 2 + phaseSupport + expectedBoost - (cluster.cx / pageWidth) };
    }).filter((cluster) => cluster.sorted.length >= (options.allowSingle ? 1 : 2));
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.sorted || [];
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
    const ratingX = selected.get('rating')?.x ?? null;
    const tripUnitX = repeatedX(dataWords, (word) => {
      if (Number.isFinite(standardX) && word.cx <= standardX) return false;
      if (Number.isFinite(ratingX) && word.cx >= ratingX) return false;
      return /^(?:TMD|TM-D|LSI|LSIG|MICROLOGIC|\d{1,2}\.\d+)$/i.test(word.text);
    }, tolerance);
    const guesses = {
      way: median(wayAnchors.map((word) => word.cx)),
      phase: repeatedX(dataWords, (word) => /^L[123]$/i.test(word.text), tolerance),
      device_standard: standardX,
      device_class: repeatedX(dataWords, (word) => /^(?:MCB|RCBO|MCCB|ACB|RCD|FUSE|ISOLATOR)$/i.test(word.text), tolerance),
      trip_unit: tripUnitX,
      circuit_reference: repeatedX(dataWords, (word) => Core.extractBoardReferences(word.text).length > 0, tolerance),
      circuit_type: repeatedX(dataWords, (word) => /^(?:RD|RG|RADIAL|RING)$/i.test(word.text), tolerance),
    };
    for (const [role, x] of Object.entries(guesses)) {
      if (!Number.isFinite(x)) continue;
      const existing = selected.get(role);
      const disagrees = existing && Math.abs(existing.x - x) > Math.max(tolerance * 1.5, pageWidth * 0.018);
      if (!existing || role === 'way' || disagrees) {
        selected.set(role, {
          role,
          x,
          evidence: existing?.evidence || null,
          source: existing ? 'header_data_reconciled' : (role === 'way' ? 'way_sequence' : 'data_pattern'),
        });
      }
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
    const phaseWords = words.filter((word) => /^L[123]$/i.test(word.text)
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

  function columnCells(words, schema) {
    const assigned = Object.fromEntries(schema.columns.map((column) => [column.role, []]));
    for (const word of words) {
      const column = schema.columns.find((item) => word.cx >= item.left && word.cx < item.right)
        || schema.columns.slice().sort((a, b) => Math.abs(a.x - word.cx) - Math.abs(b.x - word.cx))[0];
      if (column) assigned[column.role].push(word);
    }
    return Object.fromEntries(Object.entries(assigned).map(([role, list]) => [role, sourceCell(list, role)]));
  }

  function numberValue(cell, { max = Infinity } = {}) {
    const match = String(cell?.text || '').match(/-?\d+(?:\.\d+)?/);
    const value = match ? Number(match[0]) : null;
    return Number.isFinite(value) && Math.abs(value) <= max ? value : null;
  }

  function indicatorValue(cell) {
    const token = String(cell?.text || '').trim();
    if (!token) return null;
    if (/^(?:YES|Y|TRUE|1|CHECKED|TICK)$/i.test(token) || /[\u2713\u2714\u2611\uF0FC]/.test(token)) return true;
    if (/^(?:NO|N|FALSE|0|X|-|--)$/i.test(token) || /[\u00D7\u2715\u2716\u2610\uF0FB]/.test(token)) return false;
    return null;
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

  function parseProtectionDescriptor(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const standard = protectionStandard(text);
    const explicit = text.match(/\b(AFDD\s*\+\s*RCBO|RCBO|MCCB|MCB|ACB|RCCB|RCD|HRC\s+FUSE|FUSE|SWITCH\s+DISCONNECTOR|ISOLATOR)\b/i)?.[1] || null;
    const rating = Number(text.match(/\b(\d+(?:\.\d+)?)\s*A(?:MPS?)?\b/i)?.[1]) || null;
    const tripUnit = text.match(/\bMICROLOGIC\s*([0-9]+(?:\.[0-9]+)?)\b/i)?.[1]
      || text.match(/\b(TMD|TM-D|LSI|LSIG|ELECTRONIC\s+TRIP(?:\s+UNIT)?)\b/i)?.[1]
      || null;
    const curve = text.match(/\b(?:TYPE|CURVE|CHARACTERISTIC)\s*([BCD])\b/i)?.[1]?.toUpperCase() || null;
    const breakingCapacityKa = Number(text.match(/\b(\d+(?:\.\d+)?)\s*KA\b/i)?.[1]) || null;
    return { text, standardCode: standard.code, protectionStandard: standard.label, explicitDevice: explicit, rating, tripUnit, curve, breakingCapacityKa };
  }

  function resolveProtectionDevice(fields = {}, context = {}) {
    const standard = protectionStandard(fields.standard || fields.protectionStandard);
    const explicitText = `${fields.deviceClass || ''} ${fields.description || ''}`;
    const explicit = explicitText.match(/\b(AFDD\s*\+\s*RCBO|RCBO|MCCB|MCB|ACB|RCCB|RCD|FUSE|SWITCH\s+DISCONNECTOR|ISOLATOR)\b/i)?.[1]?.toUpperCase() || null;
    const tripUnit = String(fields.tripUnit || '').trim();
    let device = null; let confidence = 0.55; const reasons = [];
    if (standard.correctedFrom) reasons.push(`Normalised ${standard.correctedFrom} to ${standard.code}`);
    if (explicit) {
      device = explicit === 'RCCB' ? 'RCD' : explicit.replace(/\s+/g, ' ');
      confidence = 0.96; reasons.push('Explicit device class');
    } else if (standard.code === '60898') {
      device = 'MCB'; confidence = 0.97; reasons.push('BS EN 60898');
    } else if (standard.code === '61009') {
      device = 'RCBO'; confidence = 0.97; reasons.push('BS EN 61009');
    } else if (standard.code === '61008') {
      device = 'RCD'; confidence = 0.97; reasons.push('BS EN 61008');
    } else if (standard.code === '60947-2') {
      device = 'MCCB'; confidence = 0.97; reasons.push('BS EN 60947-2');
    } else if (standard.code === '60947-3') {
      device = 'Isolator'; confidence = 0.97; reasons.push('BS EN 60947-3');
    } else if (standard.code === '60947' && (/^(?:\d+(?:\.\d+)?|TMD|TM-D|LSI|LSIG)$/i.test(tripUnit)
      || /MICROLOGIC|MCCB/i.test(context.boardProtectionText || ''))) {
      device = 'MCCB'; confidence = 0.91; reasons.push('BS 60947 with MCCB trip-unit evidence');
    }
    return { device, confidence, reasons, standardCode: standard.code, protectionStandard: standard.label };
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
      const active = devices.filter((row) => row && !row.space && !row.spare);
      const finalCircuitRatio = active.length ? active.filter((row) => !row.circuitReference && Number(row.rating) <= 63).length / active.length : 0;
      if (Number.isFinite(rating) && rating <= policy.consumerUnitMaxAmps && phaseConfig === 'SPN' && finalCircuitRatio >= 0.65) {
        family = 'consumer_unit'; confidence = 0.78; reasons.push('Single-phase final-circuit context within consumer-unit policy');
      } else if (Number.isFinite(rating) && rating >= policy.distributionBoardMinAmps && rating <= policy.distributionBoardMaxAmps) {
        family = 'distribution_board'; confidence = 0.86; reasons.push(`${policy.id}: rating within distribution-board range`);
      } else if (/\bDB\b|DISTRIBUTION\s+BOARD/.test(text) || /^DB/i.test(header.board_ref || '')) {
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
    const parsed = Core.extractBoardHeader(lines);
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

  function parseSpatialRow(cells, schemaConfidence, context = {}) {
    const way = numberValue(cells.way, { max: 200 });
    if (!way) return null;
    const allText = Object.values(cells).filter(Boolean).map((cell) => cell.text).join(' ');
    const phases = (cellText(cells, 'phase').match(/L[123]/gi) || []).map((phase) => phase.toUpperCase());
    const uniquePhases = [...new Set(phases)];
    const standardText = cellText(cells, 'device_standard');
    const deviceClassText = cellText(cells, 'device_class');
    const typeText = cellText(cells, 'trip_unit');
    const typeCurve = typeText.match(/^\s*([BCD])\s*$/i)?.[1]?.toUpperCase() || null;
    const tripUnit = typeCurve ? null : (typeText || null);
    const curve = (cellText(cells, 'trip_curve').match(/\b[BCD]\b/i)?.[0] || typeCurve || '').toUpperCase() || null;
    const rating = numberValue(cells.rating, { max: 6300 });
    const ka = numberValue(cells.breaking_capacity, { max: 150 });
    const circuitText = cellText(cells, 'circuit_reference');
    const detectedReference = Core.extractBoardReferences(circuitText)[0] || null;
    const circuitReference = detectedReference?.original || null;
    const description = cellText(cells, 'description') || circuitText || '';
    const spare = /\bSPARE\b/i.test(allText);
    const explicitSpace = /\b(?:SPACE|FITTED\s+BLANK|BLANK\s+WAY)\b/i.test(allText);
    const resolution = resolveProtectionDevice({ standard: standardText, deviceClass: deviceClassText, tripUnit, description }, context);
    const hasDeviceEvidence = Boolean(resolution.device || rating != null || standardText || deviceClassText);
    const space = explicitSpace || (!spare && !hasDeviceEvidence && !description);
    const poles = uniquePhases.length >= 3 && [cells.rating, cells.device_standard, cells.device_class].filter(Boolean).length
      ? 3
      : (uniquePhases.length === 1 && hasDeviceEvidence ? 1 : null);
    const phase = poles === 3 ? '3PH' : (uniquePhases.length === 1 ? uniquePhases[0] : null);
    const rcdMa = numberValue(cells.rcd_ma, { max: 1000 });
    const rcdProtected = indicatorValue(cells.rcd);
    const afdd = indicatorValue(cells.afdd);
    const circuitTypeRaw = cellText(cells, 'circuit_type').toUpperCase();
    const circuitConfig = /^(?:RD|RAD|RADIAL)$/.test(circuitTypeRaw) ? 'RADIAL' : (/^(?:RG|RING)$/.test(circuitTypeRaw) ? 'RING' : null);
    const liveCsa = numberValue(cells.line_csa, { max: 1000 });
    const cpcCsa = numberValue(cells.cpc_csa, { max: 1000 });
    const cableType = cellText(cells, 'cable_type') || null;
    const confidence = Math.min(resolution.confidence || 0.55, schemaConfidence || 0.55,
      ...Object.values(cells).filter(Boolean).map((cell) => Number(cell.confidence) || 0.6));
    const requiresReview = space || (!spare && (!resolution.device || rating == null)) || confidence < 0.78;
    const source = sourceCell(Object.values(cells).filter(Boolean).flatMap((cell) => cell.words || []), 'row');
    return {
      way, phase, rating, device: resolution.device, curve, tripUnit,
      protectionStandard: resolution.protectionStandard, protectionStandardCode: resolution.standardCode,
      sens: rcdMa, rcdProtected, afdd: afdd === true, poles, ka,
      desc: description, circuitReference, circuitReferenceText: circuitText || null, circuitConfig,
      cable: (liveCsa != null || cpcCsa != null || cableType) ? {
        orig: [liveCsa != null ? `${liveCsa}mm2` : null, cpcCsa != null ? `CPC ${cpcCsa}mm2` : null, cableType].filter(Boolean).join(' '),
        size: liveCsa, cpc: cpcCsa, typeCode: cableType,
      } : null,
      spare, space, incomer: false, qty: space ? 0 : (resolution.device ? 1 : 0),
      inferredDevice: resolution.confidence < 0.9,
      requiresReview,
      resolutionSource: 'spatial_column_schema',
      resolutionReasons: resolution.reasons,
      srcText: source?.text || allText,
      sourceCell: source,
      fieldSources: {
        device: cells.device_class || cells.device_standard || source,
        rating: cells.rating || source,
        curve: cells.trip_curve || cells.trip_unit || source,
        breakingCapacity: cells.breaking_capacity || source,
        poles: cells.phase || cells.way || source,
        circuitReference: cells.circuit_reference || cells.description || source,
      },
      conf: confidence,
    };
  }

  function parseSpatialWayRows(rowWords, wayAnchor, top, bottom, schema, context) {
    const aggregateCells = columnCells(rowWords, schema);
    aggregateCells.way = sourceCell([wayAnchor], 'way');
    const aggregate = parseSpatialRow(aggregateCells, schema.confidence, context);
    const phaseColumn = schema.columns.find((column) => column.role === 'phase');
    const phaseWords = rowWords.filter((word) => /^L[123]$/i.test(word.text)
      && (!phaseColumn || (word.cx >= phaseColumn.left && word.cx < phaseColumn.right)))
      .sort((a, b) => a.cy - b.cy);
    const phases = [];
    for (const word of phaseWords) {
      const phase = word.text.toUpperCase();
      if (!phases.some((item) => item.phase === phase)) phases.push({ phase, word, cy: word.cy });
    }
    if (!aggregate || phases.length < 2) return aggregate ? [aggregate] : [];

    const phaseRows = phases.map((item, index) => {
      const laneTop = index ? (phases[index - 1].cy + item.cy) / 2 : top;
      const laneBottom = index < phases.length - 1 ? (item.cy + phases[index + 1].cy) / 2 : bottom;
      const laneWords = rowWords.filter((word) => word.cy >= laneTop && word.cy < laneBottom);
      const cells = columnCells(laneWords, schema);
      cells.way = sourceCell([wayAnchor], 'way');
      cells.phase = sourceCell([item.word], 'phase');
      return parseSpatialRow(cells, schema.confidence, context);
    }).filter(Boolean);
    const meaningful = phaseRows.filter((row) => !row.space || row.spare);
    const technical = phaseRows.filter((row) => row.device || row.rating != null || row.protectionStandard
      || row.circuitReference || row.cable || row.sens != null || row.afdd);
    const explicitSpares = phaseRows.filter((row) => row.spare);
    if (!meaningful.length) return [aggregate];
    if (technical.length >= 2 || explicitSpares.length) return phaseRows;
    if (technical.length === 1 && technical[0].phase !== 'L2') return phaseRows;
    if ((technical.length === 1 && technical[0].phase === 'L2')
      || (technical.length === 0 && meaningful.length === 1 && meaningful[0].phase === 'L2')) {
      aggregate.inferredPoleGrouping = true;
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
    const phaseWords = words.filter((word) => /^L[123]$/i.test(word.text)
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
      let way = extractWayNumber(nearestAnchor.text);
      let inferredWay = false;
      const lastAnchor = wayAnchors[wayAnchors.length - 1];
      if (lastAnchor && nearestAnchor === lastAnchor && /^L1$/i.test(phaseWord.text) && standardWord.cy > lastAnchor.cy + 2) {
        way = extractWayNumber(lastAnchor.text) + 1;
        inferredWay = true;
      }
      if (!Number.isInteger(way) || way < 1 || way > 200) continue;
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

  function parseSpatialSchedulePage(input = {}) {
    const words = collectSpatialWords(input);
    const pageWidth = Number(input.pageWidth || input.width || Math.max(1, ...words.map((word) => word.x1)));
    const pageHeight = Number(input.pageHeight || input.height || Math.max(1, ...words.map((word) => word.y1)));
    if (words.length < 8 || !Number.isFinite(pageWidth) || !Number.isFinite(pageHeight)) {
      return { matched: false, confidence: 0, words: words.length, rows: [], feeds: [], references: [], warnings: ['insufficient_spatial_words'] };
    }
    const hintedWayX = input.schemaHint?.columns?.find((column) => column.role === 'way')?.x;
    const wayAnchors = findWayAnchors(words, pageWidth, { allowSingle: Boolean(input.allowSingleWay), expectedX: hintedWayX });
    const schema = input.schemaHint
      ? continuationSchema(words, wayAnchors, pageWidth, pageHeight, input.schemaHint)
      : inferScheduleColumns(words, wayAnchors, pageWidth, pageHeight);
    const minimumWays = input.allowSingleWay ? 1 : 2;
    if (wayAnchors.length < minimumWays || !schema?.columns?.some((column) => column.role === 'way')) {
      return { matched: false, confidence: schema?.confidence || 0, words: words.length, schema, rows: [], feeds: [], references: [], warnings: ['way_column_not_resolved'] };
    }
    const header = extractSpatialBoardHeader(input, words, schema);
    const context = { boardProtectionText: header.header.supply_cpd_details || '' };
    const ys = wayAnchors.map((word) => word.cy);
    const rows = [];
    for (let index = 0; index < wayAnchors.length; index += 1) {
      const top = index ? (ys[index - 1] + ys[index]) / 2 : schema.dataBand[1];
      const bottom = index < wayAnchors.length - 1 ? (ys[index] + ys[index + 1]) / 2 : schema.dataBand[1] + schema.dataBand[3];
      const rowWords = words.filter((word) => word.cy >= top && word.cy < bottom);
      rows.push(...parseSpatialWayRows(rowWords, wayAnchors[index], top, bottom, schema, context));
    }
    reconcileProtectionStandardRows(words, wayAnchors, rows, schema, context);
    const observedRowCount = rows.length;
    const expectedWays = Number(header.header.ways_total);
    if (input.materializeMissingWays !== false && Number.isInteger(expectedWays) && expectedWays > 0 && expectedWays <= 200) {
      const present = new Set(rows.map((row) => Number(row.way)).filter(Number.isInteger));
      for (let way = 1; way <= expectedWays; way += 1) {
        if (!present.has(way)) rows.push(inferredHeaderWay(way, header));
      }
      rows.sort((a, b) => Number(a.way) - Number(b.way) || String(a.phase || '').localeCompare(String(b.phase || '')));
    }
    const classification = classifyBoardFamily(header.header, { devices: rows, policy: input.boardPolicy });
    const ref = header.header.board_ref || header.references.find((reference) => reference.role === 'primary_board')?.original || null;
    const feeds = ref ? rows.filter((row) => row.circuitReference).map((row) => ({
      fromRef: ref, toRef: row.circuitReference, way: row.way, device: row.device,
      rating: row.rating, poles: row.poles, cable: row.cable, confidence: row.conf,
      sourceCell: row.fieldSources.circuitReference,
    })) : [];
    const warnings = [];
    if (!ref) warnings.push('primary_board_not_resolved');
    if (schema.confidence < 0.72) warnings.push('column_schema_review_required');
    if (rows.some((row) => row.inferredWay)) warnings.push('header_way_without_printed_row');
    if (rows.some((row) => row.requiresReview)) warnings.push('row_review_required');
    return {
      matched: rows.length >= minimumWays && schema.confidence >= 0.58,
      confidence: Math.min(schema.confidence, ref ? 0.98 : 0.65),
      words: words.length,
      schema,
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
          circuit_reference: row.circuitReference, confidence: row.conf,
          source_region: row.sourceCell?.bbox || null,
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
    collectSpatialWords,
    extractContextualBoardReferences,
    inferScheduleColumns,
    parseProtectionDescriptor,
    resolveProtectionDevice,
    classifyBoardFamily,
    familyTypeCode,
    parseSpatialSchedulePage,
    buildSpatialLayoutHint,
    deduplicateFeederRelationships,
  });
})(globalThis);
