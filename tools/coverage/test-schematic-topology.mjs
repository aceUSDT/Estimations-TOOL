import assert from 'node:assert/strict';
import test from 'node:test';

await import('../../extractor-core.js');
await import('../../spatial-schedule-core.js');
await import('../../schematic-topology-core.js');

const Core = globalThis.EstimationExtractorCore;
const { directFeeder, crossedWithoutJunction, crossedWithJunction, nestedPanelboard, corroboratedRootPanelboards } = await import('./fixtures/schematic-topology-synthetic.mjs');

test('PDF operator replay preserves transforms, paint state, junctions, and annotation exclusion', () => {
  const OPS = {
    save: 1, restore: 2, transform: 3, setLineWidth: 4, constructPath: 5,
    stroke: 6, fill: 7, beginAnnotation: 8, endAnnotation: 9,
    moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17, closePath: 18, rectangle: 19,
  };
  const geometry = Core.extractPdfVectorGeometry({
    OPS,
    pageWidth: 200,
    pageHeight: 200,
    viewportTransform: [2, 0, 0, 2, 0, 0],
    operatorList: {
      fnArray: [OPS.save, OPS.transform, OPS.setLineWidth, OPS.constructPath, OPS.stroke, OPS.restore,
        OPS.constructPath, OPS.fill, OPS.beginAnnotation, OPS.constructPath, OPS.stroke, OPS.endAnnotation],
      argsArray: [[], [1, 0, 0, 1, 5, 10], [2], [[OPS.moveTo, OPS.lineTo], [0, 0, 20, 0]], [], [],
        [[OPS.rectangle], [48, 48, 4, 4]], [], [], [[OPS.moveTo, OPS.lineTo], [0, 0, 80, 80]], [], []],
    },
  });
  assert.equal(geometry.segments.length, 1);
  assert.deepEqual([geometry.segments[0].x1, geometry.segments[0].y1, geometry.segments[0].x2, geometry.segments[0].y2], [10, 20, 50, 20]);
  assert.equal(geometry.junctions.length, 1);
  assert.deepEqual([geometry.junctions[0].x, geometry.junctions[0].y], [100, 100]);
  assert.equal(geometry.stats.annotationsSkipped, 1);
});

test('a scanned schematic path must be continuously supported by drawing pixels', () => {
  const width = 120;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const paint = (x, y) => {
    for (let py = Math.max(0, y - 1); py <= Math.min(height - 1, y + 1); py += 1) {
      for (let px = Math.max(0, x - 1); px <= Math.min(width - 1, x + 1); px += 1) {
        const offset = (py * width + px) * 4;
        data[offset] = 0; data[offset + 1] = 0; data[offset + 2] = 0; data[offset + 3] = 255;
      }
    }
  };
  for (let y = 10; y <= 90; y += 1) { paint(12, y); paint(90, y); }
  for (let x = 12; x <= 90; x += 1) paint(x, 50);
  const raster = Core.buildRasterTraceMap({ width, height, data });
  const traced = Core.validateRasterTracePath({ raster, path: [[101, 909], [101, 505], [756, 505], [756, 101]], normalised: true });
  const invented = Core.validateRasterTracePath({ raster, path: [[101, 909], [500, 800], [900, 700]], normalised: true });
  assert.equal(traced.accepted, true);
  assert.ok(traced.coverage > 0.9);
  assert.equal(invented.accepted, false);
  assert.match(invented.reason, /^raster_trace_/);
});

test('a bare interior crossing remains two electrical components', () => {
  const graph = Core.buildConductorTopology(crossedWithoutJunction.vectorGeometry);
  assert.equal(graph.components.length, 2);
  assert.equal(graph.stats.junctions, 0);
});

test('a filled junction explicitly joins crossing conductors', () => {
  const graph = Core.buildConductorTopology(crossedWithJunction.vectorGeometry);
  assert.equal(graph.components.length, 1);
  assert.ok(graph.stats.junctions >= 1);
});

test('an endpoint on a conductor creates a T junction without proximity guessing', () => {
  const graph = Core.buildConductorTopology({
    pageWidth: 300,
    pageHeight: 200,
    segments: [
      { x1: 10, y1: 100, x2: 290, y2: 100 },
      { x1: 150, y1: 20, x2: 150, y2: 100 },
    ],
  });
  assert.equal(graph.components.length, 1);
});

test('a small collinear vector gap is bridged but remains review evidence', () => {
  const graph = Core.buildConductorTopology({
    pageWidth: 300,
    pageHeight: 200,
    segments: [
      { x1: 10, y1: 100, x2: 100, y2: 100 },
      { x1: 103, y1: 100, x2: 290, y2: 100 },
    ],
  });
  assert.equal(graph.components.length, 1);
  assert.equal(graph.stats.inferredBridges, 1);
});

test('a feeder is emitted only from a traced source-to-target vector route', () => {
  const parsed = Core.parseSchematicTopologyPage(directFeeder);
  assert.equal(parsed.matched, true);
  assert.ok(parsed.boards.some((board) => board.norm === 'LVS1' && board.sourceScore >= 3));
  assert.ok(!parsed.boards.some((board) => board.norm === 'MAINLVSWITCHBOARD'), 'generic main label is folded into the explicit source identity');
  assert.equal(parsed.feeds.length, 1);
  assert.equal(parsed.feeds[0].fromRef, 'LVS1');
  assert.equal(parsed.feeds[0].toRef, 'DB-A-01');
  assert.equal(parsed.feeds[0].rating, 125);
  assert.equal(parsed.feeds[0].device, 'MCCB');
  assert.equal(parsed.feeds[0].poleConfiguration, 'TPN');
  assert.equal(parsed.feeds[0].cable.size, 50);
  assert.equal(parsed.feeds[0].topologyMethod, 'pdf_vector_trace');
  assert.ok(parsed.feeds[0].path.length >= 4);
  assert.equal(parsed.feeds[0].pathEvidence.crossingPolicy, 'shared_endpoint_or_filled_junction_only');
});

test('explicit short REF labels identify schematic boards without promoting circuit labels', () => {
  const labelled = {
    pageWidth: 800,
    pageHeight: 600,
    lines: [
      { text: 'LV SCHEMATIC', words: [{ text: 'LV SCHEMATIC', bbox: [20, 20, 90, 12], confidence: 1 }] },
      { text: 'REF: MSP1 MAINS SWITCH PANEL PANEL RATING 1600A SUPPLY 400V', words: [
        { text: 'REF:', bbox: [58, 484, 28, 12], confidence: 1 },
        { text: 'MSP1', bbox: [88, 484, 35, 12], confidence: 1 },
        { text: 'MAINS SWITCH PANEL', bbox: [126, 484, 120, 12], confidence: 1 },
        { text: 'PANEL RATING 1600A', bbox: [126, 501, 112, 12], confidence: 1 },
        { text: 'SUPPLY 400V', bbox: [126, 518, 72, 12], confidence: 1 },
      ] },
      { text: 'REF: PBT1 TENANT PANELBOARD 6WAY TP&N', words: [
        { text: 'REF:', bbox: [470, 83, 28, 12], confidence: 1 },
        { text: 'PBT1', bbox: [500, 83, 34, 12], confidence: 1 },
        { text: 'TENANT PANELBOARD', bbox: [538, 83, 108, 12], confidence: 1 },
        { text: '6WAY TP&N', bbox: [538, 100, 64, 12], confidence: 1 },
      ] },
      { text: 'LL PB 1', words: [{ text: 'LL PB 1', bbox: [300, 180, 44, 12], confidence: 1 }] },
      { text: '125A MCCB TPN', words: [
        { text: '125A', bbox: [490, 228, 28, 12], confidence: 1 },
        { text: 'MCCB', bbox: [490, 246, 34, 12], confidence: 1 },
        { text: 'TPN', bbox: [490, 264, 22, 12], confidence: 1 },
      ] },
    ],
    vectorGeometry: directFeeder.vectorGeometry,
  };
  const parsed = Core.parseSchematicTopologyPage(labelled);
  assert.ok(parsed.boards.some((board) => board.norm === 'MSP1' && board.sourceScore >= 3));
  assert.ok(parsed.boards.some((board) => board.norm === 'PBT1' && board.explicitLabel));
  assert.ok(!parsed.boards.some((board) => board.norm === 'PB1'), 'LL PB 1 is an outgoing circuit label, not a board identity');
  assert.equal(parsed.feeds.length, 1);
  assert.equal(parsed.feeds[0].fromRef, 'MSP1');
  assert.equal(parsed.feeds[0].toRef, 'PBT1');
});

test('a child branching from a proven panelboard busbar receives the immediate parent', () => {
  const parsed = Core.parseSchematicTopologyPage(nestedPanelboard);
  const child = parsed.feeds.find((feed) => feed.toRef === 'DB-CHILD');
  const direct = parsed.feeds.find((feed) => feed.toRef === 'DB-DIRECT');
  assert.equal(child?.fromRef, 'LVS2');
  assert.equal(child?.pathEvidence.parentEvidence, 'terminal_busbar_branch');
  assert.ok(child?.pathEvidence.parentBusbarOverlap >= 90);
  assert.equal(direct?.fromRef, 'LVS1');
  assert.notEqual(direct?.pathEvidence.parentEvidence, 'terminal_busbar_branch');
});

test('an authoritative switchboard root can recover its outgoing component from multiple panelboard anchors', () => {
  const parsed = Core.parseSchematicTopologyPage(corroboratedRootPanelboards);
  const recovered = parsed.diagnostics.sourceAnchorRecoveries.find((entry) => entry.board === 'MSP1');
  assert.deepEqual(new Set(recovered?.corroboratingSources), new Set(['PBT1', 'PBT2']));
  assert.ok(parsed.feeds.some((feed) => feed.fromRef === 'MSP1' && feed.toRef === 'PBT1'));
  assert.ok(parsed.feeds.some((feed) => feed.fromRef === 'MSP1' && feed.toRef === 'PBT2'));
  assert.deepEqual(parsed.diagnostics.unresolvedBoards, []);
});

test('nearby labels and bare crossings cannot invent a feeder', () => {
  const parsed = Core.parseSchematicTopologyPage(crossedWithoutJunction);
  assert.equal(parsed.matched, false);
  assert.equal(parsed.feeds.length, 0);
  assert.ok(parsed.warnings.includes('schematic_topology_unresolved'));
});

test('the same crossing becomes a feeder only with explicit junction evidence', () => {
  const parsed = Core.parseSchematicTopologyPage(crossedWithJunction);
  assert.equal(parsed.matched, true);
  assert.equal(parsed.feeds.length, 1);
  assert.ok(parsed.feeds[0].pathEvidence.junctionCount >= 1);
});

test('schematic parsing fails closed without vector geometry', () => {
  const parsed = Core.parseSchematicTopologyPage({ ...directFeeder, vectorGeometry: null });
  assert.equal(parsed.matched, false);
  assert.equal(parsed.feeds.length, 0);
  assert.ok(parsed.warnings.includes('schematic_vector_geometry_missing'));
});

test('schedule reconciliation checks exact identity, source, device, rating, poles, and cable', () => {
  const boards = {
    LVS1: { norm: 'LVS1', orig: 'LVS1', schematicEvidence: true, pages: [{ fileId: 's1', page: 1, sourceRole: 'schematic' }] },
    DBA01: {
      norm: 'DBA01', orig: 'DB-A-01', schematicEvidence: true, scheduleEvidence: true,
      pages: [{ fileId: 's1', page: 1, sourceRole: 'schematic' }, { fileId: 'd1', page: 1, sourceRole: 'schedule', primary: true }],
      header: { fed_from_ref: 'MDB-OTHER', incomer_class: 'RCBO', incomer_rating_a: 160, incomer_poles: 3,
        supply_cable_details: '70mm2 4C XLPE/SWA/LSZH' },
    },
    DBONLY: { norm: 'DBONLY', orig: 'DB-ONLY', scheduleEvidence: true, pages: [{ fileId: 'd1', page: 1, sourceRole: 'schedule', primary: true }], header: {} },
  };
  const result = Core.reconcileSchematicSchedules({
    boards,
    feeders: [{ id: 'f1', from: 'LVS1', to: 'DBA01', sourceRole: 'schematic_feeder', device: 'MCCB', rating: 125, poles: 4,
      cable: { size: 50, cores: 4, typeCode: 'XLPE/SWA/LSZH' }, conf: 0.9 }],
    files: [
      { id: 's1', pages: [{ lines: [{ text: 'LV SCHEMATIC REV P05' }] }] },
      { id: 'd1', pages: [{ lines: [{ text: 'BOARD SCHEDULE Rev P01' }] }] },
    ],
  });
  const kinds = new Set(result.discrepancies.map((item) => item.kind));
  for (const kind of ['supply_from_mismatch', 'rating_mismatch', 'device_mismatch', 'poles_mismatch', 'cable_mismatch',
    'revision_conflict', 'schedule_orphan_board']) assert.ok(kinds.has(kind), kind);
  assert.ok(kinds.has('linked'));
  assert.ok(kinds.has('missing_schedule'));
  assert.ok(result.summary.blocking >= 6);
});
