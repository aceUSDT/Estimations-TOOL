export const word = (text, x, y, width = Math.max(12, text.length * 6), height = 12, rotation = 0) => ({
  text,
  bbox: [x, y, width, height],
  confidence: 1,
  rotation,
});

export const directFeeder = {
  pageWidth: 800,
  pageHeight: 600,
  lines: [
    { text: 'LV SCHEMATIC', words: [word('LV SCHEMATIC', 20, 20, 90)] },
    { text: 'LVS1 Main LV Switchboard', words: [word('LVS1', 80, 485, 35), word('Main LV Switchboard', 120, 485, 115)] },
    { text: 'DB-A-01 [Office] 12-Way', words: [word('DB-A-01', 485, 85, 55), word('[Office]', 545, 85, 45), word('12-Way', 545, 102, 42)] },
    { text: '125A MCCB TPN 50mm2 4C XLPE/SWA/LSZH', words: [
      word('125A', 490, 228, 28), word('MCCB', 490, 246, 34), word('TPN', 490, 264, 22),
      word('50mm2', 390, 286, 38), word('4C', 432, 286, 14), word('XLPE/SWA/LSZH', 450, 286, 90),
    ] },
  ],
  vectorGeometry: {
    version: 1,
    pageWidth: 800,
    pageHeight: 600,
    segments: [
      { x1: 100, y1: 500, x2: 100, y2: 300, width: 1, pathId: 'a' },
      { x1: 100, y1: 300, x2: 500, y2: 300, width: 1, pathId: 'b' },
      { x1: 500, y1: 300, x2: 500, y2: 100, width: 1, pathId: 'c' },
    ],
    junctions: [],
    stats: { segments: 3, junctionCandidates: 0 },
  },
};

export const crossedWithoutJunction = {
  pageWidth: 400,
  pageHeight: 300,
  lines: [
    { text: 'LV SCHEMATIC', words: [word('LV SCHEMATIC', 10, 10, 90)] },
    { text: 'LVS1', words: [word('LVS1', 12, 142, 32)] },
    { text: 'DB-X-01', words: [word('DB-X-01', 188, 12, 52)] },
  ],
  vectorGeometry: {
    version: 1,
    pageWidth: 400,
    pageHeight: 300,
    segments: [
      { x1: 20, y1: 150, x2: 380, y2: 150, width: 1, pathId: 'horizontal' },
      { x1: 210, y1: 20, x2: 210, y2: 280, width: 1, pathId: 'vertical' },
    ],
    junctions: [],
    stats: { segments: 2, junctionCandidates: 0 },
  },
};

export const crossedWithJunction = {
  ...crossedWithoutJunction,
  vectorGeometry: {
    ...crossedWithoutJunction.vectorGeometry,
    junctions: [{ x: 210, y: 150, bbox: [207, 147, 6, 6], source: 'filled_vector_shape' }],
    stats: { segments: 2, junctionCandidates: 1 },
  },
};

export const nestedPanelboard = {
  pageWidth: 1000,
  pageHeight: 700,
  lines: [
    { text: 'LV SCHEMATIC', words: [word('LV SCHEMATIC', 20, 20, 90)] },
    { text: 'LVS1 Main LV Switchboard', words: [word('LVS1', 282, 632, 35), word('Main LV Switchboard', 320, 632, 115)] },
    { text: 'LVS2 GSHP Panelboard', words: [word('LVS2', 682, 482, 35), word('GSHP Panelboard', 720, 482, 90)] },
    { text: 'DB-CHILD', words: [word('DB-CHILD', 372, 72, 60)] },
    { text: '125A MCCB TPN', words: [word('125A', 385, 260, 28), word('MCCB', 385, 278, 34), word('TPN', 385, 296, 22)] },
    { text: 'DB-DIRECT', words: [word('DB-DIRECT', 820, 72, 68)] },
    { text: '63A MCB TPN', words: [word('63A', 835, 260, 24), word('MCB', 835, 278, 28), word('TPN', 835, 296, 22)] },
  ],
  vectorGeometry: {
    version: 1,
    pageWidth: 1000,
    pageHeight: 700,
    segments: [
      { x1: 300, y1: 650, x2: 300, y2: 500, width: 1, pathId: 'panel-incomer' },
      { x1: 300, y1: 500, x2: 700, y2: 500, width: 1, pathId: 'panel-busbar' },
      { x1: 400, y1: 500, x2: 400, y2: 90, width: 1, pathId: 'panel-child' },
      { x1: 300, y1: 600, x2: 850, y2: 600, width: 1, pathId: 'root-busbar' },
      { x1: 850, y1: 600, x2: 850, y2: 90, width: 1, pathId: 'root-direct' },
    ],
    junctions: [],
    stats: { segments: 5, junctionCandidates: 0 },
  },
};

export const corroboratedRootPanelboards = {
  pageWidth: 1000,
  pageHeight: 700,
  lines: [
    { text: 'LV SCHEMATIC', words: [word('LV SCHEMATIC', 20, 20, 90)] },
    { text: 'REF: MSP1 MAINS SWITCH PANEL', words: [word('REF:', 58, 620, 28), word('MSP1', 88, 620, 35),
      word('MAINS SWITCH PANEL', 126, 620, 120)] },
    { text: 'REF: PBT1 TENANT PANELBOARD SUPPLY PANEL RATING', words: [word('REF:', 355, 85, 28),
      word('PBT1', 385, 85, 34), word('PANELBOARD', 360, 100, 62), word('SUPPLY', 370, 112, 38),
      word('PANEL RATING', 360, 124, 72)] },
    { text: 'REF: PBT2 TENANT PANELBOARD SUPPLY PANEL RATING', words: [word('REF:', 655, 85, 28),
      word('PBT2', 685, 85, 34), word('PANELBOARD', 660, 100, 62), word('SUPPLY', 670, 112, 38),
      word('PANEL RATING', 660, 124, 72)] },
    { text: '125A MCCB TPN', words: [word('125A', 390, 245, 28), word('MCCB', 390, 263, 34), word('TPN', 390, 281, 22)] },
    { text: '125A MCCB TPN', words: [word('125A', 690, 245, 28), word('MCCB', 690, 263, 34), word('TPN', 690, 281, 22)] },
  ],
  vectorGeometry: {
    version: 1,
    pageWidth: 1000,
    pageHeight: 700,
    segments: [
      { x1: 100, y1: 640, x2: 100, y2: 580, width: 1, pathId: 'root-incomer' },
      { x1: 100, y1: 520, x2: 700, y2: 520, width: 1, pathId: 'root-outgoing-busbar' },
      { x1: 400, y1: 520, x2: 400, y2: 100, width: 1, pathId: 'tenant-one' },
      { x1: 700, y1: 520, x2: 700, y2: 100, width: 1, pathId: 'tenant-two' },
    ],
    junctions: [],
    stats: { segments: 4, junctionCandidates: 0 },
  },
};
