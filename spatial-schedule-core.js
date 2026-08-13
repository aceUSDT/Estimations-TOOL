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
    { role: 'rcd_ma', patterns: [/RCD.*OPERATING.*CURRENT/, /RCD.*\bMA\b/, /EARTH.*FAULT.*(?:DEVICE|CURRENT|\bMA\b)/, /^\(?MA\)?$/] },
    { role: 'circuit_reference', patterns: [/CIRCUIT.*REFERENCE/, /LOAD.*REFERENCE/] },
    { role: 'description', patterns: [/CIRCUIT.*DESCRIPTION/, /^DUTY$/, /^DESCRIPTION$/, /^SERVING$/, /LOAD.*DESCRIPTION/] },
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

  function columnCells(words, schema) {
    const assigned = Object.fromEntries(schema.columns.map((column) => [column.role, []]));
    for (const word of words) {
      const column = schema.columns.find((item) => word.cx >= item.left && word.cx < item.right)
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
    const explicitText = String(fields.deviceClass || '');
    const explicit = explicitText.match(/\b(AFDD\s*\+\s*RCBO|RCBO|MCCB|MCB|ACB|RCCB|RCD|FUSE|SWITCH\s+DISCONNECTOR|ISOLATOR)\b/i)?.[1]?.toUpperCase() || null;
    const tripUnit = String(fields.tripUnit || '').trim();
    let device = null; let confidence = 0.55; let classBasis = null; const reasons = [];
    if (standard.correctedFrom) reasons.push(`Normalised ${standard.correctedFrom} to ${standard.code}`);
    if (explicit) {
      device = explicit === 'RCCB' ? 'RCD' : explicit.replace(/\s+/g, ' ');
      classBasis = 'explicit';
      confidence = 0.96; reasons.push('Explicit device class');
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
    } else if (standard.code === '60947' && (/^(?:\d+(?:\.\d+)?|TMD|TM-D|LSI|LSIG)$/i.test(tripUnit)
      || /MICROLOGIC|MCCB/i.test(context.boardProtectionText || ''))) {
      classBasis = 'bs_en_context';
      device = 'MCCB'; confidence = 0.91; reasons.push('BS 60947 with MCCB trip-unit evidence');
    } else if (fields.rcdProtected === true && Number(fields.rating) > 0 && !explicit) {
      classBasis = 'derived_rcd';
      device = fields.afdd === true ? 'AFDD+RCBO' : 'RCBO';
      confidence = 0.9;
      reasons.push('Rated outgoing CPD with explicit row-level RCD protection');
    }
    if (/^AFDD\s*\+\s*RCBO$/i.test(device || '')) device = 'AFDD+RCBO';
    const rcdProtected = fields.rcdProtected === true || Number(fields.sensitivityMa) > 0;
    if (device === 'MCB' && rcdProtected) {
      device = fields.afdd === true ? 'AFDD+RCBO' : 'RCBO';
      classBasis = fields.afdd === true ? 'derived_rcd_afdd' : 'derived_rcd';
      confidence = Math.max(confidence, 0.94);
      reasons.push(fields.afdd === true
        ? 'MCB with row-level RCD and AFDD protection'
        : 'MCB with row-level RCD protection');
    } else if (device === 'RCBO' && fields.afdd === true) {
      device = 'AFDD+RCBO';
      classBasis = 'derived_afdd';
      reasons.push('RCBO with row-level AFDD protection');
    }
    return { device, classBasis, confidence, reasons, standardCode: standard.code, protectionStandard: standard.label };
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

  function phaseValues(value) {
    const source = String(value || '').toUpperCase().replace(/\s+/g, '');
    if (/L1(?:-|–|—|\/|TO)L3|L1\/L2\/L3|3PH|THREEPHASE|TP&?N/.test(source)) return ['L1', 'L2', 'L3'];
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
    const tripUnit = typeCurve || typeDevice ? null : (typeText || null);
    const curve = (cellText(cells, 'trip_curve').match(/\b[BCD]\b/i)?.[0] || typeCurve || '').toUpperCase() || null;
    const rating = numberValue(cells.rating, { max: 6300 });
    const ka = numberValue(cells.breaking_capacity, { max: 150 });
    const circuitText = cellText(cells, 'circuit_reference');
    const detectedReference = Core.extractBoardReferences(circuitText)[0] || null;
    const circuitReference = detectedReference?.original || null;
    const descriptionCellText = cellText(cells, 'description');
    const description = descriptionCellText || circuitText || '';
    const occupancyLabels = new Set([
      descriptionCellText, circuitText, deviceClassText, standardText, typeText,
    ].map((value) => Core.occupancyLabel?.(value)).filter(Boolean));
    const spareText = occupancyLabels.has('spare');
    const explicitSpace = occupancyLabels.has('space');
    const rcdRaw = numberValue(cells.rcd_ma, { min: 0.001, max: 1000 });
    const rcdMa = rcdRaw != null && rcdRaw < 1 ? Math.round(rcdRaw * 1000) : rcdRaw;
    const rcdIndicator = indicatorValue(cells.rcd);
    const textualRcdProtection = /\b(?:C\s*\/\s*W|WITH)\s+RCD\b/i.test(allText);
    const rcdProtected = rcdIndicator === true || rcdMa != null || textualRcdProtection ? true : rcdIndicator;
    const afddIndicator = indicatorValue(cells.afdd);
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
    const hasDeviceEvidence = Boolean(resolution.device || rating != null || standardText || resolvedDeviceClassText);
    const occupancyConflict = occupancyLabels.size > 1;
    const spare = spareText;
    const space = explicitSpace || (!spare && !hasDeviceEvidence && !description);
    const poles = uniquePhases.length >= 3 && hasDeviceEvidence ? 3
      : (uniquePhases.length === 1 && hasDeviceEvidence ? 1 : null);
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
    const requiresReview = space || occupancyConflict || (!spare && (!resolution.device || rating == null
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
    const row = {
      way, phase, rating, device: resolution.device, class_basis: resolution.classBasis, curve, tripUnit,
      poleConfiguration: poles === 3 ? 'TP' : poles === 1 ? 'SP' : null,
      protectionStandard: resolution.protectionStandard, protectionStandardCode: resolution.standardCode,
      sens: rcdMa, rcdProtected, afdd: afddIndicator === true, afddIndicated: afddIndicator, poles, ka,
      desc: description, circuitReference, circuitReferenceText: circuitText || null, circuitConfig,
      associatedDevices: Core.extractAssociatedEquipment(description),
      cable: (liveCsa != null || cpcCsa != null || cableType || installMethod) ? {
        orig: [liveCsa != null ? `${liveCsa}mm2` : null, cpcCsa != null ? `CPC ${cpcCsa}mm2` : null, cableType].filter(Boolean).join(' '),
        size: liveCsa, cpc: cpcCsa, typeCode: cableType,
        install_method: installMethod, reference_method: referenceMethod,
      } : null,
      spare, space, incomer: false, qty: space ? 0 : (hasDeviceEvidence ? 1 : 0),
      occupies_ways: poles === 3 ? 3 : 1,
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
        rating: cells.rating || source,
        curve: cells.trip_curve || cells.trip_unit || source,
        breakingCapacity: cells.breaking_capacity || source,
        poles: cells.phase || cells.way || source,
        rcdProtection: cells.rcd || cells.rcd_ma || source,
        rcdSensitivity: cells.rcd_ma || cells.rcd || source,
        afdd: cells.afdd || source,
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
    if (phaseWords.length) aggregateCells.phase = interpretedPhaseCell(phases);
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
      const row = parseSpatialRow(cells, schema.confidence, { ...context, phaseLane: true, laneTop, laneBottom });
      return applyPhaseReconciliation(row, item.phaseRepair, item.phaseConflict, cells.phase);
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
    const context = {
      boardProtectionText: header.header.supply_cpd_details || '',
      phaseLaneModel: inferPhaseLaneModel(words, wayAnchors, schema, header.header),
    };
    const ys = wayAnchors.map((word) => word.cy);
    const rows = [];
    for (let index = 0; index < wayAnchors.length; index += 1) {
      const top = index ? (ys[index - 1] + ys[index]) / 2 : schema.dataBand[1];
      const bottom = index < wayAnchors.length - 1 ? (ys[index] + ys[index + 1]) / 2 : schema.dataBand[1] + schema.dataBand[3];
      const rowWords = words.filter((word) => word.cy >= top && word.cy < bottom);
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

  function parseSpatialScheduleDocument(pageInputs = [], options = {}) {
    const pages = (pageInputs || []).map((input, index) => ({
      ...input,
      documentPage: Number(input.documentPage || input.page || index + 1),
    }));
    const independent = pages.map((input) => {
      const strict = parseSpatialSchedulePage(input);
      const attempts = [{ strategy: 'geometry-strict', matched: Boolean(strict.matched && strict.rows?.length), rows: strict.rows?.length || 0 }];
      let result = strict;
      if ((!strict.matched || !strict.rows?.length) && input.allowSingleWay) {
        const permissive = parseSpatialSchedulePage({ ...input, allowSingleWay: true, materializeMissingWays: false });
        attempts.push({ strategy: 'geometry-single-way', matched: Boolean(permissive.matched && permissive.rows?.length), rows: permissive.rows?.length || 0 });
        if (permissive.matched && permissive.rows?.length) result = permissive;
      }
      return { input, result, attempts };
    });
    const catalogue = independent.filter((entry) => entry.result?.matched && entry.result.rows?.length && entry.result.schema?.columns?.length)
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
          const transferAccepted = Number(recovered.confidence || 0) >= 0.62
            && Number(recovered.grid?.populatedRows || 0) > 0
            && completeness >= 0.5
            && unresolvedPhaseRows <= Math.max(1, Math.floor(recovered.rows.length * 0.5));
          entry.attempts[entry.attempts.length - 1].matched = transferAccepted;
          entry.attempts[entry.attempts.length - 1].completeness = Number(completeness.toFixed(2));
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
    collectSpatialWords,
    extractContextualBoardReferences,
    inferScheduleColumns,
    parseProtectionDescriptor,
    resolveProtectionDevice,
    classifyBoardFamily,
    familyTypeCode,
    parseSpatialSchedulePage,
    parseSpatialScheduleDocument,
    assessScheduleGrid,
    parseSpatialSchematicPage,
    buildSpatialLayoutHint,
    scaleSpatialSchemaHint,
    deduplicateFeederRelationships,
    parseProtectionIndicator: indicatorValue,
    extractWayIdentifier,
  });
})(globalThis);
