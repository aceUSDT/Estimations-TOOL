(function attachSchematicTopologyCore(global) {
  'use strict';

  const Core = global.EstimationExtractorCore;
  if (!Core) throw new Error('EstimationExtractorCore must load before schematic-topology-core.js');

  const round = (value, places = 3) => {
    const factor = 10 ** places;
    return Math.round(Number(value) * factor) / factor;
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
  const segmentLength = (segment) => Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
  const applyMatrix = (matrix, point) => ({
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  });
  const multiplyMatrix = (left, right) => [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
  const colourValue = (args) => (args || []).slice(0, 4).map((value) => round(value, 4)).join(',');
  const boxFromPoints = (points) => {
    if (!points.length) return null;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    return [round(x0), round(y0), round(Math.max(...xs) - x0), round(Math.max(...ys) - y0)];
  };
  const boxObject = (bbox) => bbox && bbox.length >= 4 ? {
    x0: Number(bbox[0]), y0: Number(bbox[1]),
    x1: Number(bbox[0]) + Number(bbox[2]), y1: Number(bbox[1]) + Number(bbox[3]),
  } : null;
  const pointInBox = (point, bbox, padding = 0) => {
    const box = boxObject(bbox);
    return Boolean(box) && point.x >= box.x0 - padding && point.x <= box.x1 + padding
      && point.y >= box.y0 - padding && point.y <= box.y1 + padding;
  };
  const unionBoxes = (boxes) => {
    const valid = boxes.map(boxObject).filter(Boolean);
    if (!valid.length) return null;
    const x0 = Math.min(...valid.map((box) => box.x0));
    const y0 = Math.min(...valid.map((box) => box.y0));
    const x1 = Math.max(...valid.map((box) => box.x1));
    const y1 = Math.max(...valid.map((box) => box.y1));
    return [round(x0), round(y0), round(x1 - x0), round(y1 - y0)];
  };

  function extractPdfVectorGeometry(input = {}) {
    const operatorList = input.operatorList || {};
    const fnArray = operatorList.fnArray || [];
    const argsArray = operatorList.argsArray || [];
    const OPS = input.OPS || {};
    const viewport = Array.isArray(input.viewportTransform) ? input.viewportTransform : [1, 0, 0, 1, 0, 0];
    const pageWidth = Number(input.pageWidth) || 0;
    const pageHeight = Number(input.pageHeight) || 0;
    const stateStack = [];
    let state = { matrix: [1, 0, 0, 1, 0, 0], lineWidth: 1, dash: [], stroke: '', fill: '' };
    let path = [];
    let annotationDepth = 0;
    let pathSequence = 0;
    const segments = [];
    const junctions = [];
    const shapes = [];
    const stats = { operators: fnArray.length, constructPaths: 0, paintedPaths: 0, annotationsSkipped: 0 };
    const is = (fn, name) => Number.isFinite(OPS[name]) && fn === OPS[name];
    const transformed = (x, y) => applyMatrix(viewport, applyMatrix(state.matrix, { x: Number(x), y: Number(y) }));
    const addLine = (items, from, to, meta = {}) => {
      if (!from || !to || !Number.isFinite(from.x + from.y + to.x + to.y)) return;
      if (distance(from, to) < 0.05) return;
      items.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, ...meta });
    };
    const curvePoints = (from, c1, c2, to) => {
      const points = [];
      for (let index = 1; index <= 6; index += 1) {
        const t = index / 6;
        const mt = 1 - t;
        points.push({
          x: mt ** 3 * from.x + 3 * mt ** 2 * t * c1.x + 3 * mt * t ** 2 * c2.x + t ** 3 * to.x,
          y: mt ** 3 * from.y + 3 * mt ** 2 * t * c1.y + 3 * mt * t ** 2 * c2.y + t ** 3 * to.y,
        });
      }
      return points;
    };
    const decodePath = (args) => {
      const operations = Array.isArray(args?.[0]) ? args[0] : [];
      const coordinates = Array.isArray(args?.[1]) || ArrayBuffer.isView(args?.[1]) ? Array.from(args[1]) : [];
      let coordinateIndex = 0;
      let current = null;
      let start = null;
      const items = [];
      for (const operation of operations) {
        if (operation === OPS.moveTo) {
          current = transformed(coordinates[coordinateIndex], coordinates[coordinateIndex + 1]);
          coordinateIndex += 2;
          start = current;
        } else if (operation === OPS.lineTo) {
          const next = transformed(coordinates[coordinateIndex], coordinates[coordinateIndex + 1]);
          coordinateIndex += 2;
          addLine(items, current, next);
          current = next;
        } else if (operation === OPS.curveTo) {
          const c1 = transformed(coordinates[coordinateIndex], coordinates[coordinateIndex + 1]);
          const c2 = transformed(coordinates[coordinateIndex + 2], coordinates[coordinateIndex + 3]);
          const next = transformed(coordinates[coordinateIndex + 4], coordinates[coordinateIndex + 5]);
          coordinateIndex += 6;
          for (const point of curvePoints(current, c1, c2, next)) {
            addLine(items, current, point, { curve: true });
            current = point;
          }
        } else if (operation === OPS.curveTo2) {
          const c1 = current;
          const c2 = transformed(coordinates[coordinateIndex], coordinates[coordinateIndex + 1]);
          const next = transformed(coordinates[coordinateIndex + 2], coordinates[coordinateIndex + 3]);
          coordinateIndex += 4;
          for (const point of curvePoints(current, c1, c2, next)) {
            addLine(items, current, point, { curve: true });
            current = point;
          }
        } else if (operation === OPS.curveTo3) {
          const c1 = transformed(coordinates[coordinateIndex], coordinates[coordinateIndex + 1]);
          const next = transformed(coordinates[coordinateIndex + 2], coordinates[coordinateIndex + 3]);
          coordinateIndex += 4;
          const c2 = next;
          for (const point of curvePoints(current, c1, c2, next)) {
            addLine(items, current, point, { curve: true });
            current = point;
          }
        } else if (operation === OPS.closePath) {
          addLine(items, current, start, { closed: true });
          current = start;
        } else if (operation === OPS.rectangle) {
          const x = coordinates[coordinateIndex];
          const y = coordinates[coordinateIndex + 1];
          const width = coordinates[coordinateIndex + 2];
          const height = coordinates[coordinateIndex + 3];
          coordinateIndex += 4;
          const corners = [transformed(x, y), transformed(x + width, y), transformed(x + width, y + height), transformed(x, y + height)];
          for (let index = 0; index < corners.length; index += 1) addLine(items, corners[index], corners[(index + 1) % corners.length], { closed: true });
          current = corners[0];
          start = current;
        }
      }
      return items;
    };
    const paintPath = ({ stroke = false, fill = false } = {}) => {
      if (!path.length) return;
      stats.paintedPaths += 1;
      const determinant = Math.abs(state.matrix[0] * state.matrix[3] - state.matrix[1] * state.matrix[2]);
      const width = Math.max(0.1, Number(state.lineWidth || 1) * Math.sqrt(determinant || 1));
      const pathId = `pdf-path-${pathSequence += 1}`;
      const points = path.flatMap((segment) => [{ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 }]);
      const bbox = boxFromPoints(points);
      if (bbox) shapes.push({ bbox, stroke, fill, segmentCount: path.length, pathId, width: round(width) });
      if (stroke) {
        path.forEach((segment) => segments.push({
          ...Object.fromEntries(Object.entries(segment).map(([key, value]) => [key, typeof value === 'number' ? round(value) : value])),
          width: round(width), dash: [...state.dash], colour: state.stroke, pathId,
        }));
      }
      if (fill && bbox) {
        const box = boxObject(bbox);
        const minPage = Math.max(1, Math.min(pageWidth || Infinity, pageHeight || Infinity));
        const maxMarker = Math.max(8, minPage * 0.012);
        const markerWidth = box.x1 - box.x0;
        const markerHeight = box.y1 - box.y0;
        const aspect = Math.max(markerWidth, markerHeight) / Math.max(0.1, Math.min(markerWidth, markerHeight));
        if (markerWidth >= 0.5 && markerHeight >= 0.5 && markerWidth <= maxMarker && markerHeight <= maxMarker && aspect <= 2.5) {
          junctions.push({ x: round((box.x0 + box.x1) / 2), y: round((box.y0 + box.y1) / 2), bbox, source: 'filled_vector_shape', pathId });
        }
      }
      path = [];
    };

    for (let index = 0; index < fnArray.length; index += 1) {
      const fn = fnArray[index];
      const args = argsArray[index] || [];
      if (is(fn, 'beginAnnotation')) {
        annotationDepth += 1;
        stats.annotationsSkipped += 1;
        continue;
      }
      if (is(fn, 'endAnnotation')) {
        annotationDepth = Math.max(0, annotationDepth - 1);
        continue;
      }
      if (annotationDepth && input.ignoreAnnotations !== false) continue;
      if (is(fn, 'save')) stateStack.push({ ...state, matrix: [...state.matrix], dash: [...state.dash] });
      else if (is(fn, 'restore')) state = stateStack.pop() || state;
      else if (is(fn, 'transform')) state.matrix = multiplyMatrix(state.matrix, args.slice(0, 6).map(Number));
      else if (is(fn, 'setLineWidth')) state.lineWidth = Number(args[0]) || 1;
      else if (is(fn, 'setDash')) state.dash = Array.from(args[0] || []);
      else if (is(fn, 'setStrokeRGBColor') || is(fn, 'setStrokeGray') || is(fn, 'setStrokeCMYKColor')) state.stroke = colourValue(args);
      else if (is(fn, 'setFillRGBColor') || is(fn, 'setFillGray') || is(fn, 'setFillCMYKColor')) state.fill = colourValue(args);
      else if (is(fn, 'constructPath')) {
        stats.constructPaths += 1;
        path.push(...decodePath(args));
      } else if (is(fn, 'stroke') || is(fn, 'closeStroke')) paintPath({ stroke: true });
      else if (is(fn, 'fill') || is(fn, 'eoFill')) paintPath({ fill: true });
      else if (is(fn, 'fillStroke') || is(fn, 'eoFillStroke') || is(fn, 'closeFillStroke') || is(fn, 'closeEOFillStroke')) paintPath({ stroke: true, fill: true });
      else if (is(fn, 'endPath')) path = [];
    }
    const bounded = segments.filter((segment) => {
      if (!pageWidth || !pageHeight) return true;
      const margin = Math.max(pageWidth, pageHeight) * 0.02;
      return [segment.x1, segment.x2].every((value) => value >= -margin && value <= pageWidth + margin)
        && [segment.y1, segment.y2].every((value) => value >= -margin && value <= pageHeight + margin);
    });
    return {
      version: 1,
      pageWidth,
      pageHeight,
      segments: bounded,
      junctions,
      shapes,
      stats: { ...stats, segments: bounded.length, junctionCandidates: junctions.length, shapes: shapes.length },
    };
  }

  function buildRasterTraceMap(input = {}) {
    const width = Math.max(0, Math.floor(Number(input.width) || 0));
    const height = Math.max(0, Math.floor(Number(input.height) || 0));
    const pixels = input.data;
    if (!width || !height || !pixels || pixels.length < width * height * 4) return null;
    const histogram = new Uint32Array(256);
    for (let offset = 0; offset < width * height * 4; offset += 4) {
      const luminance = clamp(Math.round(0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2]), 0, 255);
      histogram[luminance] += 1;
    }
    const percentile = (ratio) => {
      const target = width * height * ratio;
      let count = 0;
      for (let value = 0; value < histogram.length; value += 1) {
        count += histogram[value];
        if (count >= target) return value;
      }
      return 255;
    };
    const total = width * height;
    let weighted = 0;
    for (let value = 0; value < 256; value += 1) weighted += value * histogram[value];
    let backgroundWeight = 0;
    let backgroundCount = 0;
    let bestVariance = -1;
    let otsu = 128;
    for (let value = 0; value < 256; value += 1) {
      backgroundCount += histogram[value];
      if (!backgroundCount || backgroundCount === total) continue;
      backgroundWeight += value * histogram[value];
      const foregroundCount = total - backgroundCount;
      const backgroundMean = backgroundWeight / backgroundCount;
      const foregroundMean = (weighted - backgroundWeight) / foregroundCount;
      const variance = backgroundCount * foregroundCount * (backgroundMean - foregroundMean) ** 2;
      if (variance > bestVariance) { bestVariance = variance; otsu = value; }
    }
    const paperTone = percentile(0.9);
    const threshold = clamp(Math.max(otsu, paperTone - 55), 75, 210);
    const mask = new Uint8Array(total);
    let darkPixels = 0;
    for (let pixel = 0, offset = 0; pixel < total; pixel += 1, offset += 4) {
      const luminance = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
      if (luminance <= threshold && pixels[offset + 3] > 24) { mask[pixel] = 1; darkPixels += 1; }
    }
    return { version: 1, width, height, threshold, darkRatio: darkPixels / total, mask };
  }

  function validateRasterTracePath(input = {}) {
    const raster = input.raster;
    const rawPath = input.path || [];
    if (!raster?.mask || !raster.width || !raster.height || rawPath.length < 2) {
      return { accepted: false, reason: 'raster_trace_evidence_missing', coverage: 0, maximumGap: null };
    }
    if (!(raster.darkRatio > 0.00005) || raster.darkRatio > 0.55) {
      return { accepted: false, reason: 'raster_contrast_unusable', coverage: 0, maximumGap: null };
    }
    const points = rawPath.map((point) => {
      const values = Array.isArray(point) ? point : [point.x, point.y];
      const x = Number(values[0]);
      const y = Number(values[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return input.normalised === false ? { x, y } : { x: x / 1000 * (raster.width - 1), y: y / 1000 * (raster.height - 1) };
    }).filter(Boolean);
    if (points.length !== rawPath.length) return { accepted: false, reason: 'raster_trace_path_invalid', coverage: 0, maximumGap: null };
    const radius = clamp(Math.round(Math.min(raster.width, raster.height) * 0.003), 1, 5);
    const isSupported = (x, y, extra = 0) => {
      const reach = radius + extra;
      const cx = Math.round(x);
      const cy = Math.round(y);
      for (let offsetY = -reach; offsetY <= reach; offsetY += 1) {
        const py = cy + offsetY;
        if (py < 0 || py >= raster.height) continue;
        for (let offsetX = -reach; offsetX <= reach; offsetX += 1) {
          const px = cx + offsetX;
          if (px < 0 || px >= raster.width || offsetX * offsetX + offsetY * offsetY > reach * reach) continue;
          if (raster.mask[py * raster.width + px]) return true;
        }
      }
      return false;
    };
    let totalSamples = 0;
    let supportedSamples = 0;
    let totalLength = 0;
    let currentGap = 0;
    let maximumGap = 0;
    const segmentCoverage = [];
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      const length = distance(from, to);
      if (length < 0.5) continue;
      const samples = Math.max(2, Math.ceil(length));
      let segmentSupported = 0;
      for (let sample = 0; sample <= samples; sample += 1) {
        const t = sample / samples;
        const supported = isSupported(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
        totalSamples += 1;
        if (supported) {
          supportedSamples += 1;
          segmentSupported += 1;
          maximumGap = Math.max(maximumGap, currentGap);
          currentGap = 0;
        } else currentGap += length / samples;
      }
      totalLength += length;
      segmentCoverage.push(segmentSupported / (samples + 1));
    }
    maximumGap = Math.max(maximumGap, currentGap);
    const coverage = supportedSamples / Math.max(1, totalSamples);
    const junctionsSupported = points.slice(1, -1).every((point) => isSupported(point.x, point.y, radius));
    const minimumLength = Math.min(raster.width, raster.height) * 0.025;
    const accepted = totalLength >= minimumLength && coverage >= 0.52
      && segmentCoverage.every((value) => value >= 0.32)
      && maximumGap <= Math.max(18, totalLength * 0.08) && junctionsSupported;
    return {
      accepted,
      reason: accepted ? null : totalLength < minimumLength ? 'raster_trace_too_short'
        : coverage < 0.52 ? 'raster_trace_low_coverage'
          : !junctionsSupported ? 'raster_trace_junction_unsupported'
            : maximumGap > Math.max(18, totalLength * 0.08) ? 'raster_trace_discontinuous' : 'raster_trace_segment_unsupported',
      coverage: round(coverage, 4),
      maximumGap: round(maximumGap),
      totalLength: round(totalLength),
      segmentCoverage: segmentCoverage.map((value) => round(value, 4)),
      radius,
      threshold: raster.threshold,
    };
  }

  function pointToSegment(point, segment) {
    const dx = segment.x2 - segment.x1;
    const dy = segment.y2 - segment.y1;
    const denominator = dx * dx + dy * dy;
    if (!denominator) return { distance: distance(point, { x: segment.x1, y: segment.y1 }), t: 0, point: { x: segment.x1, y: segment.y1 } };
    const t = clamp(((point.x - segment.x1) * dx + (point.y - segment.y1) * dy) / denominator, 0, 1);
    const projection = { x: segment.x1 + t * dx, y: segment.y1 + t * dy };
    return { distance: distance(point, projection), t, point: projection };
  }

  function inferSchematicExclusionZones(words = [], pageWidth = 1, pageHeight = 1) {
    const zones = [];
    const add = (bbox, reason) => {
      if (!bbox || bbox[2] <= 0 || bbox[3] <= 0) return;
      zones.push({ bbox, reason });
    };
    for (const word of words) {
      const text = String(word.text || '').replace(/\s+/g, ' ').trim().toUpperCase();
      if (!text) continue;
      if (/^(?:LEGEND|SYMBOL KEY)$/.test(text) && word.cx >= pageWidth * 0.62) {
        add([Math.max(0, word.x0 - pageWidth * 0.015), Math.max(0, word.y0 - pageHeight * 0.02),
          pageWidth - Math.max(0, word.x0 - pageWidth * 0.015), Math.min(pageHeight * 0.58, pageHeight - word.y0)], 'legend');
      }
      if (/^(?:NOTES|GENERAL NOTES)$/.test(text) && (word.cx >= pageWidth * 0.65 || word.cy >= pageHeight * 0.72)) {
        add([Math.max(0, word.x0 - pageWidth * 0.01), Math.max(0, word.y0 - pageHeight * 0.015),
          pageWidth - Math.max(0, word.x0 - pageWidth * 0.01), Math.min(pageHeight * 0.25, pageHeight - word.y0)], 'notes');
      }
    }
    const titleWords = words.filter((word) => /(?:DRAWING\s+TITLE|DRAWING\s+NUMBER|REVISION|SCALE|STATUS)/i.test(word.text || '') && word.cy >= pageHeight * 0.72);
    if (titleWords.length >= 2) add([0, Math.max(0, Math.min(...titleWords.map((word) => word.y0)) - pageHeight * 0.02), pageWidth, pageHeight], 'title_revision_block');
    return zones;
  }

  function buildConductorTopology(input = {}) {
    const pageWidth = Number(input.pageWidth) || 1;
    const pageHeight = Number(input.pageHeight) || 1;
    const minPage = Math.max(1, Math.min(pageWidth, pageHeight));
    const tolerance = Number(input.tolerance) || clamp(minPage * 0.0014, 1.1, 4.5);
    const gapTolerance = Number(input.gapTolerance) || tolerance * 3.2;
    const exclusionZones = input.exclusionZones || [];
    const excluded = (point) => exclusionZones.some((zone) => pointInBox(point, zone.bbox || zone));
    const sourceSegments = (input.segments || []).map((segment, index) => ({ ...segment, sourceIndex: index }))
      .filter((segment) => segmentLength(segment) >= Math.max(0.4, tolerance * 0.35))
      .filter((segment) => !excluded({ x: (segment.x1 + segment.x2) / 2, y: (segment.y1 + segment.y2) / 2 }));
    const candidatePoints = sourceSegments.flatMap((segment) => [
      { x: segment.x1, y: segment.y1, kind: 'endpoint' },
      { x: segment.x2, y: segment.y2, kind: 'endpoint' },
    ]).concat((input.junctions || []).map((point) => ({ ...point, kind: 'junction' })));
    const cellSize = Math.max(tolerance * 5, minPage * 0.008);
    const pointGrid = new Map();
    const cellKey = (x, y) => `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
    candidatePoints.forEach((point) => {
      const key = cellKey(point.x, point.y);
      if (!pointGrid.has(key)) pointGrid.set(key, []);
      pointGrid.get(key).push(point);
    });
    const candidatesNearSegment = (segment) => {
      const x0 = Math.min(segment.x1, segment.x2) - tolerance;
      const x1 = Math.max(segment.x1, segment.x2) + tolerance;
      const y0 = Math.min(segment.y1, segment.y2) - tolerance;
      const y1 = Math.max(segment.y1, segment.y2) + tolerance;
      const values = [];
      for (let gx = Math.floor(x0 / cellSize); gx <= Math.floor(x1 / cellSize); gx += 1) {
        for (let gy = Math.floor(y0 / cellSize); gy <= Math.floor(y1 / cellSize); gy += 1) values.push(...(pointGrid.get(`${gx}:${gy}`) || []));
      }
      return values;
    };
    const nodes = [];
    const nodeGrid = new Map();
    const nodeForPoint = (point, provenance = null) => {
      const gx = Math.floor(point.x / tolerance);
      const gy = Math.floor(point.y / tolerance);
      let best = null;
      for (let x = gx - 1; x <= gx + 1; x += 1) for (let y = gy - 1; y <= gy + 1; y += 1) {
        for (const node of nodeGrid.get(`${x}:${y}`) || []) if (!best || distance(point, node) < distance(point, best)) best = node;
      }
      if (best && distance(point, best) <= tolerance) {
        if (provenance && !best.provenance.includes(provenance)) best.provenance.push(provenance);
        return best;
      }
      const node = { id: nodes.length, x: round(point.x), y: round(point.y), provenance: provenance ? [provenance] : [], edges: [] };
      nodes.push(node);
      const key = `${Math.floor(node.x / tolerance)}:${Math.floor(node.y / tolerance)}`;
      if (!nodeGrid.has(key)) nodeGrid.set(key, []);
      nodeGrid.get(key).push(node);
      return node;
    };
    const edges = [];
    const edgeKeys = new Set();
    const addEdge = (left, right, meta = {}) => {
      if (!left || !right || left.id === right.id) return null;
      const key = left.id < right.id ? `${left.id}:${right.id}` : `${right.id}:${left.id}`;
      if (edgeKeys.has(key)) return null;
      edgeKeys.add(key);
      const edge = { id: edges.length, a: left.id, b: right.id, length: distance(left, right), inferred: false, ...meta };
      edges.push(edge);
      left.edges.push(edge.id);
      right.edges.push(edge.id);
      return edge;
    };
    sourceSegments.forEach((segment) => {
      const splits = [{ t: 0, point: { x: segment.x1, y: segment.y1 }, kind: 'endpoint' }, { t: 1, point: { x: segment.x2, y: segment.y2 }, kind: 'endpoint' }];
      const seen = new Set();
      for (const candidate of candidatesNearSegment(segment)) {
        const projection = pointToSegment(candidate, segment);
        if (projection.distance > tolerance) continue;
        if (projection.t <= 0.0001 || projection.t >= 0.9999) continue;
        const key = round(projection.t, 4);
        if (seen.has(key)) continue;
        seen.add(key);
        splits.push({ t: projection.t, point: projection.point, kind: candidate.kind });
      }
      splits.sort((left, right) => left.t - right.t);
      const distinct = splits.filter((item, index) => !index || Math.abs(item.t - splits[index - 1].t) > 0.0001);
      for (let index = 1; index < distinct.length; index += 1) {
        const left = nodeForPoint(distinct[index - 1].point, distinct[index - 1].kind);
        const right = nodeForPoint(distinct[index].point, distinct[index].kind);
        addEdge(left, right, { sourceIndex: segment.sourceIndex, width: segment.width || null, pathId: segment.pathId || null });
      }
    });

    const componentOf = () => {
      const components = [];
      const assignment = new Array(nodes.length).fill(-1);
      nodes.forEach((node) => {
        if (assignment[node.id] >= 0) return;
        const id = components.length;
        const queue = [node.id];
        const memberIds = [];
        assignment[node.id] = id;
        while (queue.length) {
          const current = queue.shift();
          memberIds.push(current);
          for (const edgeId of nodes[current].edges) {
            const edge = edges[edgeId];
            const next = edge.a === current ? edge.b : edge.a;
            if (assignment[next] >= 0) continue;
            assignment[next] = id;
            queue.push(next);
          }
        }
        const members = memberIds.map((memberId) => nodes[memberId]);
        components.push({ id, nodeIds: memberIds, bbox: boxFromPoints(members), totalLength: 0 });
      });
      edges.forEach((edge) => { const id = assignment[edge.a]; if (components[id]) components[id].totalLength += edge.length; });
      return { components, assignment };
    };
    let componentData = componentOf();
    const symbolBridges = [];
    const degreeOneBeforeSymbols = nodes.filter((node) => node.edges.length === 1);
    const endpointDirection = (node) => {
      const edge = edges[node.edges[0]];
      const other = nodes[edge.a === node.id ? edge.b : edge.a];
      const dx = node.x - other.x;
      const dy = node.y - other.y;
      const length = Math.hypot(dx, dy) || 1;
      return { x: dx / length, y: dy / length };
    };
    const symbolCandidates = (input.shapes || []).filter((shape) => {
      const box = boxObject(shape.bbox);
      if (!box) return false;
      const width = box.x1 - box.x0;
      const height = box.y1 - box.y0;
      const maximum = minPage * 0.032;
      const aspect = Math.max(width, height) / Math.max(tolerance, Math.min(width, height));
      return Math.max(width, height) >= tolerance * 1.5 && Math.max(width, height) <= maximum
        && Math.min(width, height) <= maximum * 0.75 && aspect <= 5 && Number(shape.segmentCount || 0) <= 30;
    });
    for (const shape of symbolCandidates) {
      const box = boxObject(shape.bbox);
      const padding = Math.max(tolerance * 3, Math.min(box.x1 - box.x0, box.y1 - box.y0) * 0.7);
      const terminals = degreeOneBeforeSymbols.filter((node) => pointInBox(node, shape.bbox, padding));
      const pairs = [];
      for (let leftIndex = 0; leftIndex < terminals.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < terminals.length; rightIndex += 1) {
          const left = terminals[leftIndex];
          const right = terminals[rightIndex];
          if (componentData.assignment[left.id] === componentData.assignment[right.id]) continue;
          const gap = distance(left, right);
          const maximumGap = Math.hypot(box.x1 - box.x0 + padding * 2, box.y1 - box.y0 + padding * 2);
          if (gap <= tolerance || gap > maximumGap) continue;
          const direction = { x: (right.x - left.x) / gap, y: (right.y - left.y) / gap };
          const leftDirection = endpointDirection(left);
          const rightDirection = endpointDirection(right);
          const leftFacing = leftDirection.x * direction.x + leftDirection.y * direction.y;
          const rightFacing = rightDirection.x * -direction.x + rightDirection.y * -direction.y;
          if (leftFacing < 0.72 || rightFacing < 0.72) continue;
          pairs.push({ left, right, gap });
        }
      }
      pairs.sort((left, right) => left.gap - right.gap);
      const chosen = pairs[0];
      if (!chosen || symbolBridges.some((bridge) => bridge.left.id === chosen.left.id || bridge.right.id === chosen.left.id
        || bridge.left.id === chosen.right.id || bridge.right.id === chosen.right.id)) continue;
      const edge = addEdge(chosen.left, chosen.right, { symbolBridge: true, reason: 'bounded_graphical_device_symbol', shapePathId: shape.pathId });
      if (edge) symbolBridges.push(chosen);
    }
    componentData = componentOf();
    const degreeOne = nodes.filter((node) => node.edges.length === 1);
    const bridgeCandidates = [];
    for (let leftIndex = 0; leftIndex < degreeOne.length; leftIndex += 1) {
      const left = degreeOne[leftIndex];
      const leftEdge = edges[left.edges[0]];
      const leftOther = nodes[leftEdge.a === left.id ? leftEdge.b : leftEdge.a];
      const leftVector = { x: left.x - leftOther.x, y: left.y - leftOther.y };
      const leftLength = Math.hypot(leftVector.x, leftVector.y) || 1;
      for (let rightIndex = leftIndex + 1; rightIndex < degreeOne.length; rightIndex += 1) {
        const right = degreeOne[rightIndex];
        if (componentData.assignment[left.id] === componentData.assignment[right.id]) continue;
        const gap = distance(left, right);
        if (gap <= tolerance * 1.25 || gap > gapTolerance) continue;
        const rightEdge = edges[right.edges[0]];
        const rightOther = nodes[rightEdge.a === right.id ? rightEdge.b : rightEdge.a];
        const rightVector = { x: right.x - rightOther.x, y: right.y - rightOther.y };
        const rightLength = Math.hypot(rightVector.x, rightVector.y) || 1;
        const alignment = Math.abs((leftVector.x * rightVector.x + leftVector.y * rightVector.y) / (leftLength * rightLength));
        const gapAlignment = Math.abs((leftVector.x * (right.x - left.x) + leftVector.y * (right.y - left.y)) / (leftLength * gap));
        if (alignment < 0.985 || gapAlignment < 0.985) continue;
        const midpoint = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
        if (excluded(midpoint)) continue;
        bridgeCandidates.push({ left, right, gap });
      }
    }
    bridgeCandidates.sort((left, right) => left.gap - right.gap);
    const bridgedNodes = new Set();
    bridgeCandidates.forEach((candidate) => {
      if (bridgedNodes.has(candidate.left.id) || bridgedNodes.has(candidate.right.id)) return;
      addEdge(candidate.left, candidate.right, { inferred: true, reason: 'small_collinear_vector_gap' });
      bridgedNodes.add(candidate.left.id);
      bridgedNodes.add(candidate.right.id);
    });
    componentData = componentOf();
    nodes.forEach((node) => { node.component = componentData.assignment[node.id]; });
    return {
      nodes,
      edges,
      components: componentData.components,
      tolerance,
      stats: {
        sourceSegments: sourceSegments.length,
        nodes: nodes.length,
        edges: edges.length,
        components: componentData.components.length,
        junctions: nodes.filter((node) => node.provenance.includes('junction')).length,
        symbolBridges: edges.filter((edge) => edge.symbolBridge).length,
        inferredBridges: edges.filter((edge) => edge.inferred).length,
      },
    };
  }

  function shortestPath(graph, startId, targetId) {
    if (startId == null || targetId == null) return null;
    const distances = new Array(graph.nodes.length).fill(Infinity);
    const previousNode = new Array(graph.nodes.length).fill(null);
    const previousEdge = new Array(graph.nodes.length).fill(null);
    const visited = new Set();
    distances[startId] = 0;
    while (visited.size < graph.nodes.length) {
      let current = null;
      let best = Infinity;
      for (let index = 0; index < distances.length; index += 1) {
        if (!visited.has(index) && distances[index] < best) { current = index; best = distances[index]; }
      }
      if (current == null || !Number.isFinite(best)) break;
      if (current === targetId) break;
      visited.add(current);
      for (const edgeId of graph.nodes[current].edges) {
        const edge = graph.edges[edgeId];
        const next = edge.a === current ? edge.b : edge.a;
        const candidate = best + edge.length * (edge.inferred ? 1.4 : 1);
        if (candidate >= distances[next]) continue;
        distances[next] = candidate;
        previousNode[next] = current;
        previousEdge[next] = edgeId;
      }
    }
    if (!Number.isFinite(distances[targetId])) return null;
    const nodeIds = [];
    const edgeIds = [];
    let current = targetId;
    while (current != null) {
      nodeIds.push(current);
      if (current === startId) break;
      edgeIds.push(previousEdge[current]);
      current = previousNode[current];
    }
    if (nodeIds[nodeIds.length - 1] !== startId) return null;
    nodeIds.reverse();
    edgeIds.reverse();
    return { distance: distances[targetId], nodeIds, edgeIds, points: nodeIds.map((id) => ({ x: graph.nodes[id].x, y: graph.nodes[id].y })) };
  }

  function sourceCell(words, role) {
    if (!words?.length) return null;
    const bboxFor = (word) => word.bbox || (Number.isFinite(word.x0) && Number.isFinite(word.y0)
      ? [word.x0, word.y0, Number(word.width ?? word.x1 - word.x0), Number(word.height ?? word.y1 - word.y0)] : null);
    return {
      text: words.map((word) => word.text).join(' ').replace(/\s+/g, ' ').trim(),
      bbox: unionBoxes(words.map(bboxFor)),
      confidence: Math.min(...words.map((word) => Number(word.confidence ?? 1))),
      role,
      words: words.map((word) => ({ text: word.text, bbox: bboxFor(word), confidence: word.confidence ?? 1, rotation: word.rotation || 0 })),
    };
  }

  function normalisedWords(input) {
    if (Core.collectSpatialWords) return Core.collectSpatialWords(input);
    return (input.words || []).map((word) => {
      const box = boxObject(word.bbox);
      return box ? { ...word, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1, cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2 } : null;
    }).filter(Boolean);
  }

  function boardCandidatesFromWords(input, words, zones) {
    const candidates = [];
    const add = (text, items, sourceText = text) => {
      const canonical = Core.canonicalBoardReference(text);
      if (!canonical?.normalised) return;
      const norm = canonical.normalised;
      if (!/^(?:DB|LVS|MSB|MDB|SMDB|PB|SB|PANEL|MAIN)/.test(norm)) return;
      const cell = sourceCell(items, 'schematic_board_reference');
      const box = boxObject(cell?.bbox);
      if (!box || zones.some((zone) => pointInBox({ x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }, zone.bbox))) return;
      candidates.push({
        ref: canonical.display || text,
        norm,
        sourceText,
        sourceCell: cell,
        bbox: cell.bbox,
        cx: (box.x0 + box.x1) / 2,
        cy: (box.y0 + box.y1) / 2,
        confidence: cell.confidence,
      });
    };
    words.forEach((word) => {
      (Core.extractBoardReferences?.(word.text) || []).forEach((reference) => add(reference.original, [word], word.text));
      (String(word.text || '').match(/\b(?:LVS|MSB|MDB|SMDB|PB)[\s._/-]?\d+[A-Z0-9._/-]*\b/gi) || []).forEach((reference) => add(reference, [word], word.text));
    });
    (input.lines || []).forEach((line) => {
      const lineWords = words.filter((word) => (line.words || []).some((original) => original === word || original.id === word.id));
      const available = lineWords.length ? lineWords : words.filter((word) => String(line.text || '').includes(word.text));
      (Core.extractBoardReferences?.(line.text || '') || []).forEach((reference) => {
        const matching = available.filter((word) => String(word.text || '').toUpperCase().includes(String(reference.original || '').toUpperCase())
          || String(reference.original || '').toUpperCase().includes(String(word.text || '').toUpperCase()));
        add(reference.original, matching.length ? matching : available.slice(0, 1), line.text || reference.original);
      });
      if (/\bMAIN\s+LV\s+(?:SWITCHBOARD|PANELBOARD)\b/i.test(line.text || '')) {
        const mainWords = available.filter((word) => /MAIN|LV|SWITCHBOARD|PANELBOARD/i.test(word.text || ''));
        add('MAIN-LV-SWITCHBOARD', mainWords.length ? mainWords : available.slice(0, 1), line.text);
      }
    });
    const byNorm = new Map();
    candidates.forEach((candidate) => {
      const prior = byNorm.get(candidate.norm);
      const sourceScore = /^MAIN/.test(candidate.norm) ? 3 : /^(?:LVS|MSB|MDB)/.test(candidate.norm) ? 1 : 0;
      candidate.sourceScore = sourceScore;
      if (!prior || sourceScore > prior.sourceScore || candidate.sourceCell.text.length > prior.sourceCell.text.length) byNorm.set(candidate.norm, candidate);
    });
    return [...byNorm.values()];
  }

  function parseCable(text) {
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    const sizeMatch = source.match(/\b(\d+(?:\.\d+)?)\s*mm(?:2|\u00b2)?\b/i);
    if (!sizeMatch) return null;
    const coresMatch = source.match(/\b([234])\s*(?:x\s*)?(?:C|CORE)\b/i) || source.match(/\b1\s*x\s*[1-9]\s*x\s*([2345])c\b/i);
    const cpcMatch = source.match(/(?:\+|MIN(?:IMUM)?)\s*(\d+(?:\.\d+)?)\s*mm(?:2|\u00b2)?\s*CPC\b/i);
    const typeMatch = source.match(/\b(XLPE(?:\s*\/\s*SWA)?(?:\s*\/\s*(?:LSZH|LSF))?|SWA|LSZH|LSF|PVC|THERMOSETTING)\b/i);
    return {
      size: Number(sizeMatch[1]),
      cores: coresMatch ? Number(coresMatch[1]) : null,
      cpc: cpcMatch ? Number(cpcMatch[1]) : null,
      typeCode: typeMatch ? typeMatch[1].replace(/\s+/g, '').toUpperCase() : null,
      description: source,
    };
  }

  function parsePoles(text) {
    const token = String(text || '').toUpperCase().match(/\b(TPN|SPN|DPN|TP|DP|SP|4P|3P|2P|1P)\b/)?.[1] || null;
    const poles = token === 'TPN' || token === '4P' ? 4 : token === 'TP' || token === '3P' ? 3 : token === 'DPN' || token === 'DP' || token === '2P' ? 2 : token ? 1 : null;
    return { poleConfiguration: token, poles };
  }

  function distanceToPath(point, points) {
    let best = Infinity;
    for (let index = 1; index < points.length; index += 1) best = Math.min(best, pointToSegment(point, {
      x1: points[index - 1].x, y1: points[index - 1].y, x2: points[index].x, y2: points[index].y,
    }).distance);
    return best;
  }

  function terminalBusbarRun(graph, path, maxReach, minimumLength) {
    if (!path?.edgeIds?.length || path.points.length !== path.edgeIds.length + 1) return null;
    const runs = [];
    let current = null;
    let traversed = 0;
    const directionThreshold = Math.cos(22 * Math.PI / 180);
    for (let index = path.edgeIds.length - 1; index >= 0; index -= 1) {
      const edge = graph.edges[path.edgeIds[index]];
      const from = path.points[index];
      const to = path.points[index + 1];
      const length = Number(edge?.length) || distance(from, to);
      const vectorLength = distance(from, to) || 1;
      const direction = { x: (to.x - from.x) / vectorLength, y: (to.y - from.y) / vectorLength };
      const aligned = current && Math.abs(direction.x * current.direction.x + direction.y * current.direction.y) >= directionThreshold;
      if (!aligned && current && traversed >= maxReach) break;
      if (!aligned) {
        current = { edgeIds: [], length: 0, direction, terminalOffset: traversed };
        runs.push(current);
      }
      current.edgeIds.push(path.edgeIds[index]);
      current.length += length;
      const weight = Math.max(1, current.length);
      const sign = direction.x * current.direction.x + direction.y * current.direction.y < 0 ? -1 : 1;
      const averaged = {
        x: (current.direction.x * (weight - length) + direction.x * sign * length) / weight,
        y: (current.direction.y * (weight - length) + direction.y * sign * length) / weight,
      };
      const averagedLength = Math.hypot(averaged.x, averaged.y) || 1;
      current.direction = { x: averaged.x / averagedLength, y: averaged.y / averagedLength };
      traversed += length;
    }
    return runs.filter((run) => run.length >= minimumLength)
      .sort((left, right) => right.length - left.length || left.terminalOffset - right.terminalOffset)[0] || null;
  }

  function busbarParentEvidence(graph, candidatePath, targetPath, dimensions) {
    const minimumLength = Math.max(graph.tolerance * 8, dimensions.minPage * 0.02);
    const run = terminalBusbarRun(graph, candidatePath, dimensions.minPage * 0.25, minimumLength);
    if (!run) return null;
    const targetEdgeIndexes = new Map(targetPath.edgeIds.map((edgeId, index) => [edgeId, index]));
    const candidateEdgeIndexes = new Map(candidatePath.edgeIds.map((edgeId, index) => [edgeId, index]));
    const shared = run.edgeIds.filter((edgeId) => targetEdgeIndexes.has(edgeId));
    const overlapLength = shared.reduce((sum, edgeId) => sum + (graph.edges[edgeId]?.length || 0), 0);
    const minimumOverlap = Math.max(graph.tolerance * 2.5, dimensions.minPage * 0.004);
    if (overlapLength < minimumOverlap) return null;
    const lastTargetIndex = Math.max(...shared.map((edgeId) => targetEdgeIndexes.get(edgeId)));
    const lastCandidateIndex = Math.max(...shared.map((edgeId) => candidateEdgeIndexes.get(edgeId)));
    const targetRemaining = targetPath.edgeIds.slice(lastTargetIndex + 1)
      .reduce((sum, edgeId) => sum + (graph.edges[edgeId]?.length || 0), 0);
    const candidateRemaining = candidatePath.edgeIds.slice(lastCandidateIndex + 1)
      .reduce((sum, edgeId) => sum + (graph.edges[edgeId]?.length || 0), 0);
    if (targetRemaining < graph.tolerance * 2 || candidateRemaining < graph.tolerance * 2) return null;
    const distanceFromRoot = targetPath.edgeIds.slice(0, lastTargetIndex + 1)
      .reduce((sum, edgeId) => sum + (graph.edges[edgeId]?.length || 0), 0);
    return { mode: 'terminal_busbar_branch', distanceFromRoot, overlapLength, busbarLength: run.length };
  }

  function parseSchematicTopologyPage(input = {}) {
    const words = normalisedWords(input);
    const pageWidth = Number(input.pageWidth || input.vectorGeometry?.pageWidth) || Math.max(1, ...words.map((word) => word.x1 || 0));
    const pageHeight = Number(input.pageHeight || input.vectorGeometry?.pageHeight) || Math.max(1, ...words.map((word) => word.y1 || 0));
    const zones = inferSchematicExclusionZones(words, pageWidth, pageHeight);
    const boards = boardCandidatesFromWords(input, words, zones);
    const vector = input.vectorGeometry;
    if (!vector?.segments?.length) {
      return {
        matched: false,
        confidence: 0,
        boards,
        feeds: [],
        devices: [],
        warnings: ['schematic_vector_geometry_missing'],
        topologyMethod: 'none',
        diagnostics: { unresolvedBoards: boards.map((board) => board.norm), ambiguousBoards: [], exclusionZones: zones },
      };
    }
    const graph = buildConductorTopology({
      segments: vector.segments,
      junctions: vector.junctions,
      shapes: vector.shapes,
      pageWidth,
      pageHeight,
      exclusionZones: zones,
    });
    const minPage = Math.max(1, Math.min(pageWidth, pageHeight));
    const snapDistance = clamp(minPage * 0.028, 16, 90);
    const componentQuality = (componentId) => {
      const component = graph.components[componentId];
      const box = boxObject(component?.bbox);
      if (!component || !box) return 0;
      const extent = Math.max(box.x1 - box.x0, box.y1 - box.y0);
      return Math.min(1, Math.max(extent / (minPage * 0.12), component.totalLength / (minPage * 0.5)));
    };
    boards.forEach((board) => {
      const box = boxObject(board.bbox);
      const points = [
        { x: board.cx, y: board.cy },
        { x: box.x0, y: board.cy }, { x: box.x1, y: board.cy },
        { x: board.cx, y: box.y0 }, { x: board.cx, y: box.y1 },
      ];
      const ranked = graph.nodes.map((node) => ({
        node,
        distance: Math.min(...points.map((point) => distance(point, node))),
        quality: componentQuality(node.component),
      })).filter((item) => item.distance <= snapDistance && item.quality >= 0.2)
        .sort((left, right) => (left.distance + (1 - left.quality) * snapDistance * 0.35) - (right.distance + (1 - right.quality) * snapDistance * 0.35));
      board.anchor = ranked[0]?.node || null;
      board.anchorDistance = ranked[0]?.distance ?? null;
      board.anchorConfidence = ranked[0] ? clamp(1 - ranked[0].distance / snapDistance, 0.25, 0.98) : 0;
      board.anchorAmbiguous = Boolean(ranked[1] && ranked[0].node.component !== ranked[1].node.component
        && Math.abs(ranked[0].distance - ranked[1].distance) <= graph.tolerance * 2);
      const nearby = words.filter((word) => Math.hypot(word.cx - board.cx, word.cy - board.cy) <= minPage * 0.08);
      const location = nearby.find((word) => /^\s*\[[^\]]{2,80}\]\s*$/.test(word.text));
      const ways = nearby.find((word) => /\b\d{1,3}\s*(?:-|\s)?WAYS?\b/i.test(word.text));
      board.location = location ? location.text.replace(/^\s*\[|\]\s*$/g, '').trim() : null;
      board.locationCell = location ? sourceCell([location], 'schematic_location') : null;
      board.waysTotal = ways ? Number(ways.text.match(/\d{1,3}/)?.[0]) : null;
      board.waysCell = ways ? sourceCell([ways], 'schematic_ways') : null;
    });
    const anchored = boards.filter((board) => board.anchor && !board.anchorAmbiguous);
    const rootsByComponent = new Map();
    anchored.filter((board) => board.sourceScore > 0 || /^(?:LVS|MSB|MDB|MAIN)/.test(board.norm)).forEach((board) => {
      const prior = rootsByComponent.get(board.anchor.component);
      const score = board.sourceScore * 4 + componentQuality(board.anchor.component) * 2 - (board.anchorDistance || 0) / snapDistance;
      if (!prior || score > prior.score) rootsByComponent.set(board.anchor.component, { board, score });
    });
    const feeds = [];
    const devices = [];
    const unresolvedBoards = [];
    const ambiguousBoards = boards.filter((board) => board.anchorAmbiguous).map((board) => board.norm);
    const rootPathCache = new Map();
    const pathFromRoot = (root, target) => {
      const key = `${root.anchor.id}:${target.anchor.id}`;
      if (!rootPathCache.has(key)) rootPathCache.set(key, shortestPath(graph, root.anchor.id, target.anchor.id));
      return rootPathCache.get(key);
    };
    for (const target of anchored) {
      const root = rootsByComponent.get(target.anchor.component)?.board;
      if (!root) {
        if (!(target.sourceScore > 0 || /^(?:LVS|MSB|MDB|MAIN)/.test(target.norm))) unresolvedBoards.push(target.norm);
        continue;
      }
      if (root.norm === target.norm || root.anchor.id === target.anchor.id) continue;
      const rootPath = pathFromRoot(root, target);
      if (!rootPath) { unresolvedBoards.push(target.norm); continue; }
      const rootPathSet = new Set(rootPath.nodeIds);
      const parentEvidence = anchored.filter((candidate) => candidate.norm !== target.norm && candidate.anchor.component === target.anchor.component)
        .map((candidate) => {
          const candidatePath = pathFromRoot(root, candidate);
          if (!candidatePath) return null;
          if (rootPathSet.has(candidate.anchor.id) && candidatePath.distance < rootPath.distance - graph.tolerance) {
            return { candidate, path: candidatePath, mode: 'anchor_on_route', distanceFromRoot: candidatePath.distance, overlapLength: 0 };
          }
          if (candidate.sourceScore <= 0 || candidate.norm === root.norm) return null;
          const evidence = busbarParentEvidence(graph, candidatePath, rootPath, { minPage });
          return evidence ? { candidate, path: candidatePath, ...evidence } : null;
        }).filter(Boolean)
        .sort((left, right) => right.distanceFromRoot - left.distanceFromRoot
          || right.overlapLength - left.overlapLength || right.candidate.anchorConfidence - left.candidate.anchorConfidence);
      const selectedParentEvidence = parentEvidence[0] || { candidate: root, mode: 'component_root', overlapLength: 0 };
      const parent = selectedParentEvidence.candidate;
      const path = shortestPath(graph, parent.anchor.id, target.anchor.id);
      if (!path || path.nodeIds.length < 2) { unresolvedBoards.push(target.norm); continue; }
      const corridor = clamp(minPage * 0.014, 8, 42);
      const pathWords = words.filter((word) => !zones.some((zone) => pointInBox({ x: word.cx, y: word.cy }, zone.bbox))
        && distanceToPath({ x: word.cx, y: word.cy }, path.points) <= corridor);
      const deviceWord = pathWords.filter((word) => /^(?:ACB|MCCB|MCB|RCBO|RCCB|FUSE|SWITCH\s*FUSE|FUSE\s*SWITCH)$/i.test(word.text.trim()))
        .sort((left, right) => distanceToPath({ x: left.cx, y: left.cy }, path.points) - distanceToPath({ x: right.cx, y: right.cy }, path.points))[0];
      const ratingWords = pathWords.filter((word) => /^\s*\d{1,4}(?:\.\d+)?\s*A\s*$/i.test(word.text));
      const ratingWord = ratingWords.sort((left, right) => {
        const leftDistance = deviceWord ? Math.hypot(left.cx - deviceWord.cx, left.cy - deviceWord.cy) : Math.hypot(left.cx - target.cx, left.cy - target.cy);
        const rightDistance = deviceWord ? Math.hypot(right.cx - deviceWord.cx, right.cy - deviceWord.cy) : Math.hypot(right.cx - target.cx, right.cy - target.cy);
        return leftDistance - rightDistance;
      })[0];
      const poleWord = pathWords.find((word) => /^(?:TPN|SPN|DPN|TP|DP|SP|4P|3P|2P|1P)$/i.test(word.text.trim()));
      const cableWords = pathWords.filter((word) => /(?:MM(?:2|\u00b2)?|XLPE|SWA|LSZH|LSF|PVC|CPC|CORE|THERMOSETTING)/i.test(word.text));
      const cableCell = sourceCell(cableWords, 'schematic_cable');
      const cable = parseCable(cableCell?.text);
      const { poleConfiguration, poles } = parsePoles(poleWord?.text || pathWords.map((word) => word.text).join(' '));
      const device = deviceWord ? deviceWord.text.trim().toUpperCase().replace(/\s+/g, ' ') : null;
      const rating = ratingWord ? Number(ratingWord.text.match(/\d+(?:\.\d+)?/)?.[0]) : null;
      const inferredEdges = path.edgeIds.map((id) => graph.edges[id]).filter((edge) => edge.inferred);
      const symbolEdges = path.edgeIds.map((id) => graph.edges[id]).filter((edge) => edge.symbolBridge);
      const confidence = clamp(0.55 + target.anchorConfidence * 0.2 + parent.anchorConfidence * 0.1
        + (device ? 0.06 : 0) + (rating != null ? 0.06 : 0) - inferredEdges.length * 0.08, 0.35, 0.94);
      const fieldSources = {
        rating: ratingWord ? sourceCell([ratingWord], 'schematic_rating') : null,
        device: deviceWord ? sourceCell([deviceWord], 'schematic_device') : null,
        poles: poleWord ? sourceCell([poleWord], 'schematic_poles') : null,
        cable: cableCell,
      };
      const evidenceWords = [ratingWord, deviceWord, poleWord, ...cableWords].filter(Boolean);
      feeds.push({
        fromRef: parent.ref,
        toRef: target.ref,
        rating,
        device,
        poles,
        poleConfiguration,
        cable,
        confidence,
        sourceCell: sourceCell(evidenceWords, 'schematic_feeder'),
        fieldSources,
        topologyMethod: 'pdf_vector_trace',
        path: path.points.map((point) => [round(point.x), round(point.y)]),
        pathBbox: boxFromPoints(path.points),
        pathEvidence: {
          sourceAnchor: [parent.anchor.x, parent.anchor.y],
          targetAnchor: [target.anchor.x, target.anchor.y],
          edgeCount: path.edgeIds.length,
          junctionCount: path.nodeIds.filter((id) => graph.nodes[id].provenance.includes('junction')).length,
          symbolBridges: symbolEdges.length,
          inferredBridges: inferredEdges.length,
          parentEvidence: selectedParentEvidence.mode,
          parentBusbarOverlap: round(selectedParentEvidence.overlapLength || 0),
          crossingPolicy: 'shared_endpoint_or_filled_junction_only',
        },
        warnings: inferredEdges.length ? ['small_collinear_vector_gap_bridged'] : [],
      });
      const meter = pathWords.find((word) => /^(?:M|METER)$/i.test(word.text));
      const spd = pathWords.find((word) => /^(?:SPD|1\s*\+\s*2|T1\s*\+\s*T2)$/i.test(word.text));
      if (meter) devices.push({ boardRef: target.ref, device: 'Meter', desc: 'Schematic meter', confidence: Math.min(0.78, confidence), sourceCell: sourceCell([meter], 'schematic_accessory') });
      if (spd) devices.push({ boardRef: target.ref, device: 'SPD', desc: /1\s*\+\s*2/i.test(spd.text) ? 'Type 1+2 surge protection' : 'Surge protection', confidence: Math.min(0.78, confidence), sourceCell: sourceCell([spd], 'schematic_accessory') });
    }
    boards.filter((board) => !board.anchor && !unresolvedBoards.includes(board.norm)).forEach((board) => unresolvedBoards.push(board.norm));
    const warnings = [];
    if (!rootsByComponent.size) warnings.push('schematic_source_board_not_resolved');
    if (unresolvedBoards.length) warnings.push('schematic_topology_unresolved');
    if (ambiguousBoards.length) warnings.push('schematic_topology_ambiguous');
    const usedInferredBridges = feeds.reduce((sum, feed) => sum + Number(feed.pathEvidence?.inferredBridges || 0), 0);
    const usedSymbolBridges = feeds.reduce((sum, feed) => sum + Number(feed.pathEvidence?.symbolBridges || 0), 0);
    if (usedInferredBridges) warnings.push('schematic_vector_gaps_bridged_for_review');
    return {
      matched: feeds.length > 0,
      confidence: feeds.length ? feeds.reduce((sum, feed) => sum + feed.confidence, 0) / feeds.length : 0,
      boards,
      feeds,
      devices,
      warnings,
      sourceBoards: [...rootsByComponent.values()].map((entry) => entry.board.norm),
      topologyMethod: 'pdf_vector_trace',
      vectorStats: vector.stats || null,
      graphStats: { ...graph.stats, usedInferredBridges, usedSymbolBridges },
      diagnostics: { unresolvedBoards: [...new Set(unresolvedBoards)], ambiguousBoards, exclusionZones: zones,
        graphStats: { ...graph.stats, usedInferredBridges, usedSymbolBridges } },
    };
  }

  function canonical(value) {
    return Core.canonicalBoardReference(value || '')?.normalised || String(value || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  }

  function normalDevice(value) {
    const upper = String(value || '').toUpperCase();
    return ['RCBO', 'RCCB', 'MCCB', 'MCB', 'ACB', 'FUSE'].find((token) => new RegExp(`\\b${token}\\b`).test(upper)) || null;
  }

  function reconcileSchematicSchedules(input = {}) {
    const boards = input.boards || {};
    const filesById = new Map((input.files || []).map((file) => [file.id, file]));
    const feeders = (input.feeders || []).filter((feed) => feed && feed.to && String(feed.sourceRole || '').startsWith('schematic'));
    const entries = Object.values(boards);
    const schematic = entries.filter((board) => board.schematicEvidence || (board.pages || []).some((page) => page.sourceRole === 'schematic'));
    const schedules = entries.filter((board) => board.scheduleEvidence || (board.pages || []).some((page) => page.primary || page.sourceRole === 'schedule'));
    const scheduleByNorm = new Map(schedules.map((board) => [canonical(board.norm || board.orig), board]));
    const schematicByNorm = new Map(schematic.map((board) => [canonical(board.norm || board.orig), board]));
    const discrepancies = [];
    const revisionEvidence = (board, role) => {
      const values = [];
      for (const pageRef of board?.pages || []) {
        if (role && pageRef.sourceRole && pageRef.sourceRole !== role) continue;
        const page = filesById.get(pageRef.fileId)?.pages?.[Number(pageRef.page) - 1];
        const text = (page?.lines || []).map((line) => line.text || '').join(' ');
        const matches = [...text.matchAll(/\bREV(?:ISION)?(?:\s+(?:NO|NUMBER|ID|REF|STATUS))?\s*[:#-]?\s*(P\d{1,3}|R\d{1,3}|T\d{1,3}|[A-Z]\d{0,2}|\d{1,3})\b/gi)];
        matches.forEach((match) => values.push({ value: match[1].toUpperCase(), fileId: pageRef.fileId, page: pageRef.page }));
      }
      const distinct = [...new Map(values.map((item) => [item.value, item])).values()];
      return distinct.length === 1 ? distinct[0] : null;
    };
    const add = (kind, boardNorm, message, severity, detail = {}) => discrepancies.push({
      id: `xdoc:${kind}:${boardNorm}:${canonical(detail.from || '')}`,
      kind,
      code: String(kind || '').toUpperCase(),
      schematicNorm: boardNorm,
      scheduleNorm: scheduleByNorm.has(boardNorm) ? boardNorm : null,
      message,
      severity,
      detail,
    });
    schematic.forEach((schematicBoard) => {
      const norm = canonical(schematicBoard.norm || schematicBoard.orig);
      const scheduleBoard = scheduleByNorm.get(norm);
      if (!scheduleBoard) {
        add('missing_schedule', norm, `${schematicBoard.orig || norm} appears in the schematic but has no exact board-schedule match.`, 'high');
        return;
      }
      const feed = feeders.filter((candidate) => canonical(candidate.to) === norm).sort((left, right) => Number(right.conf || 0) - Number(left.conf || 0))[0] || null;
      const header = scheduleBoard.header || {};
      const schematicRevision = revisionEvidence(schematicBoard, 'schematic');
      const scheduleRevision = revisionEvidence(scheduleBoard, 'schedule');
      if (schematicRevision && scheduleRevision && schematicRevision.value !== scheduleRevision.value) {
        add('revision_conflict', norm, `${scheduleBoard.orig || norm}: schematic and schedule revisions differ and require document-control review.`, 'high', {
          schematicRevision, scheduleRevision,
        });
      }
      if (!feed) add('schematic_feed_missing', norm, `${scheduleBoard.orig || norm} has a schedule, but its schematic conductor route was not resolved.`, 'high');
      if (feed) {
        const scheduleParent = canonical(header.fed_from_ref || scheduleBoard.parent || '');
        const schematicParent = canonical(feed.from || '');
        if (scheduleParent && schematicParent && scheduleParent !== schematicParent) {
          add('supply_from_mismatch', norm, `${scheduleBoard.orig || norm}: schedule supply source and traced schematic parent do not agree.`, 'high', { from: schematicParent, schematic: schematicParent, schedule: scheduleParent, feedId: feed.id });
        }
        const scheduleRating = Number(header.incomer_rating_a ?? header.supply_cpd_rating_a ?? header.board_rating_a);
        const schematicRating = Number(feed.rating);
        if (Number.isFinite(scheduleRating) && Number.isFinite(schematicRating) && scheduleRating !== schematicRating) {
          add('rating_mismatch', norm, `${scheduleBoard.orig || norm}: schematic feeder is ${schematicRating}A; schedule incomer is ${scheduleRating}A.`, 'high', { schematicRating, scheduleRating, feedId: feed.id });
        }
        const scheduleDevice = normalDevice(header.incomer_class || header.supply_cpd_class || header.supply_cpd_details);
        const schematicDevice = normalDevice(feed.device);
        if (scheduleDevice && schematicDevice && scheduleDevice !== schematicDevice) {
          add('device_mismatch', norm, `${scheduleBoard.orig || norm}: schematic feeder device is ${schematicDevice}; schedule incomer is ${scheduleDevice}.`, 'high', { schematicDevice, scheduleDevice, feedId: feed.id });
        }
        const schedulePoles = Number(header.incomer_poles);
        if (Number.isFinite(schedulePoles) && Number.isFinite(Number(feed.poles)) && schedulePoles !== Number(feed.poles)) {
          add('poles_mismatch', norm, `${scheduleBoard.orig || norm}: schematic and schedule pole configurations do not agree.`, 'high', { schematicPoles: Number(feed.poles), schedulePoles, feedId: feed.id });
        }
        const scheduleCable = parseCable(header.supply_cable_details || '');
        const schematicCable = typeof feed.cable === 'string' ? parseCable(feed.cable) : feed.cable;
        if (scheduleCable && schematicCable) {
          const fields = ['size', 'cores', 'cpc', 'typeCode'];
          const differences = fields.filter((field) => scheduleCable[field] != null && schematicCable[field] != null
            && String(scheduleCable[field]).toUpperCase() !== String(schematicCable[field]).toUpperCase());
          if (differences.length) add('cable_mismatch', norm, `${scheduleBoard.orig || norm}: schematic and schedule incoming cable details differ.`, 'high', { differences, schematicCable, scheduleCable, feedId: feed.id });
        }
      }
      add('linked', norm, `${schematicBoard.orig || norm} is linked to its exact board schedule.`, 'info', { feedId: feed?.id || null });
    });
    schedules.forEach((board) => {
      const norm = canonical(board.norm || board.orig);
      if (!schematicByNorm.has(norm) && schematic.length) add('schedule_orphan_board', norm, `${board.orig || norm} has a board schedule but no exact schematic node match.`, 'medium');
    });
    return {
      discrepancies,
      summary: {
        schematicBoards: schematic.length,
        scheduleBoards: schedules.length,
        exactLinks: discrepancies.filter((item) => item.kind === 'linked').length,
        blocking: discrepancies.filter((item) => item.severity === 'high').length,
      },
    };
  }

  Object.assign(Core, {
    extractPdfVectorGeometry,
    buildRasterTraceMap,
    validateRasterTracePath,
    inferSchematicExclusionZones,
    buildConductorTopology,
    parseSchematicTopologyPage,
    reconcileSchematicSchedules,
  });
})(globalThis);
