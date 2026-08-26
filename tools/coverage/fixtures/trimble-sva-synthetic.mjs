const word = (text, x, y, width = Math.max(6, String(text).length * 4.15), height = 8) => ({
  text: String(text),
  bbox: [x, y, width, height],
  confidence: 0.99,
});

function tokens(target, values, x, y, gap = 4) {
  let cursor = x;
  values.forEach((value) => {
    const item = word(value, cursor, y);
    target.push(item);
    cursor += item.bbox[2] + gap;
  });
}

const BOARD_MANIFEST = [
  { ref: '01 MAIN LV SWITCHBOARD', pages: 4, rows: 17, ways: 24, rating: 400, fault: 50, spare: 33.3, incomer: 400 },
  { ref: '02 DB-A', pages: 8, rows: 34, ways: 24, rating: 100, fault: 25, spare: 37.5, incomer: 160 },
  { ref: '03 DB-B', pages: 7, rows: 33, ways: 24, rating: 100, fault: 25, spare: 33.3, incomer: 160 },
  { ref: '04 DB-C', pages: 10, rows: 45, ways: 24, rating: 100, fault: 25, spare: 29.2, incomer: 160 },
  { ref: '05 DB-D', pages: 13, rows: 59, ways: 28, rating: 100, fault: 25, spare: 17.9, incomer: 160 },
  { ref: '06 DB-E', pages: 12, rows: 54, ways: 28, rating: 100, fault: 25, spare: 21.4, incomer: 160 },
  { ref: '07 DB-F', pages: 1, rows: 4, ways: 8, rating: 160, fault: 25, spare: 50, incomer: 160 },
];

function protectionSpecs() {
  const result = [];
  for (let index = 0; index < 17; index += 1) {
    result.push({
      device: 'MCCB',
      phase: index < 15 ? 'L1,L2,L3' : (index === 15 ? 'L1' : 'L2'),
      rating: index < 5 ? 160 : 25,
      breaking: index < 15 ? 25 : 18,
      tripUnit: index < 6 ? 'LSI' : 'Thermal magnetic',
      curve: null,
      standard: 'BS EN60947-2',
      separateRcd: false,
    });
  }
  for (let index = 0; index < 200; index += 1) {
    result.push({
      device: 'MCB',
      phase: index < 19 ? 'L1,L2,L3' : ['L1', 'L2', 'L3'][(index - 19) % 3],
      rating: [6, 10, 16, 20, 25, 32, 40, 63][index % 8],
      breaking: index < 139 ? 10 : 15,
      tripUnit: null,
      curve: index < 187 ? 'B' : 'C',
      standard: 'BS EN60898',
      separateRcd: index < 9,
    });
  }
  for (let index = 0; index < 29; index += 1) {
    result.push({
      device: 'RCBO',
      phase: ['L1', 'L2', 'L3'][index % 3],
      rating: [6, 10, 16, 20, 32][index % 5],
      breaking: 10,
      tripUnit: null,
      curve: 'B',
      standard: 'BS EN61009',
      separateRcd: false,
    });
  }
  return result;
}

function rowsPerPage(total, pages) {
  const minimum = Math.floor(total / pages);
  const extra = total % pages;
  return Array.from({ length: pages }, (_, index) => minimum + (index < extra ? 1 : 0));
}

function headerWords(board) {
  const words = [];
  tokens(words, ['Distribution', 'Board', 'Schedule'], 280, 54, 6);
  tokens(words, ['Board', 'Data'], 22, 144, 5);
  tokens(words, ['Id', 'No:'], 22, 163, 3);
  tokens(words, board.ref.split(/\s+/), 90, 163, 4);
  words.push(word('ModelNo:', 238, 163));
  words.push(word('Schneider', 303, 163));
  tokens(words, ['L1', 'L2', 'L3'], 697, 163, 35);

  words.push(word('Name:', 22, 182));
  tokens(words, ['Power', 'TPN'], 90, 182, 4);
  tokens(words, ['No.', 'of', 'Ways:'], 238, 182, 4);
  words.push(word(String(board.ways), 329, 182));
  words.push(word('Spare:', 393, 182));
  words.push(word(String(board.spare), 443, 182));
  tokens(words, ['Total', 'Connected', 'Load', '(A):'], 543, 182, 4);
  tokens(words, ['50.00', '50.00', '50.00'], 686, 182, 25);

  tokens(words, ['Board', 'Rating', '(A):'], 22, 202, 4);
  words.push(word(String(board.rating), 111, 202));
  tokens(words, ['Fault', 'Rating', '(kA):'], 238, 202, 4);
  words.push(word(String(board.fault), 329, 202));
  tokens(words, ['Ze', '(ohm):'], 393, 202, 4);
  words.push(word('0.10000', 443, 202));
  tokens(words, ['Total', 'Diversified', 'Load', '(A):'], 543, 202, 4);
  tokens(words, ['40.00', '40.00', '40.00'], 686, 202, 25);

  tokens(words, ['Incomer', 'Details'], 22, 236, 5);
  tokens(words, ['Device', 'Manufacturer:'], 22, 255, 4);
  words.push(word('N/A', 129, 255));
  tokens(words, ['Device', 'Type:'], 316, 255, 4);
  tokens(words, ['Isolating', 'Switch'], 393, 255, 4);
  tokens(words, ['Device', 'Rating', '(A):'], 574, 255, 4);
  words.push(word(String(board.incomer), 670, 255));

  words.push(word('Way', 31, 285));
  tokens(words, ['Id', 'No'], 66, 285, 3);
  tokens(words, ['Cable', 'Type'], 185, 285, 4);
  words.push(word('Cores', 332, 285));
  words.push(word('Phase', 384, 285));
  tokens(words, ['Connected', 'To:'], 428, 285, 4);
  tokens(words, ['Overcurrent', 'Protective', 'Device'], 566, 285, 4);
  tokens(words, ['Rating', '(A)'], 773, 285, 4);

  words.push(word('Phase', 28, 298));
  words.push(word('Name', 66, 298));
  tokens(words, ['Sep.', 'CPC'], 378, 298, 4);
  tokens(words, ['Id', 'No'], 428, 298, 3);
  tokens(words, ['Earth', 'Fault', 'Protective', 'Device'], 566, 298, 4);
  tokens(words, ['Trip', 'Rating', '(A)'], 765, 298, 4);

  words.push(word('Name', 428, 309));
  tokens(words, ['Arc', 'Flash', 'Protective', 'Device'], 566, 309, 4);
  tokens(words, ['Rating', '(A)'], 773, 309, 4);
  return words;
}

function deviceDescriptor(spec) {
  if (spec.device === 'MCCB') {
    return `Hager, h3+ MCCB, P160 - ${spec.breaking}kA - 3-4P, ${spec.tripUnit}`;
  }
  if (spec.device === 'RCBO') {
    return `Hager, RCBO, ADC4 - ${spec.breaking}kA - 1P+N, ${spec.curve} Curve - Type A - 30mA - ${spec.standard}`;
  }
  return `Hager, MCB, NBN - ${spec.breaking}kA, Type ${spec.curve} - ${spec.standard}`;
}

function appendRow(words, spec, rowIndex, boardIndex, globalIndex) {
  const y = 329 + rowIndex * 45;
  const way = spec.phase === 'L1,L2,L3' ? rowIndex + 1 : Math.floor(rowIndex / 3) + 1;
  words.push(word(String(way), 36, y));
  words.push(word(`ROW-${boardIndex + 1}-${globalIndex + 1}`, 66, y, 78));
  words.push(word('Multicore 90C thermosetting LSF', 184, y, 132));
  words.push(word('1 x 1 x 3c', 332, y, 42));
  words.push(word('1.5', 390, y));
  words.push(word(`LOAD ${globalIndex + 1}`, 428, y, 90));

  const descriptor = deviceDescriptor(spec);
  if (globalIndex % 11 === 0) {
    const split = Math.max(1, descriptor.lastIndexOf(' - '));
    words.push(word(descriptor.slice(0, split), 566, y, 190));
    words.push(word(descriptor.slice(split + 3), 566, y + 8, 190));
  } else {
    words.push(word(descriptor, 566, y, 190));
  }
  words.push(word(String(spec.rating), 786, y));

  const earthY = y + 19;
  words.push(word(spec.phase, 23, earthY, spec.phase.length > 2 ? 45 : 12));
  words.push(word('0', 393, earthY));
  if (spec.separateRcd) {
    words.push(word('Generic RCD, 2P, Type A, Instantaneous', 566, earthY, 190));
    words.push(word('0.03', 784, earthY));
  } else {
    words.push(word('None', 566, earthY));
    words.push(word(spec.device === 'RCBO' ? '0.03' : 'N/A', 784, earthY));
  }
  words.push(word('None', 566, y + 32));
  words.push(word('N/A', 784, y + 32));
}

export function createTrimbleSvaSyntheticDocument() {
  const specs = protectionSpecs();
  const pages = [];
  let globalIndex = 0;
  let documentPage = 2;
  BOARD_MANIFEST.forEach((board, boardIndex) => {
    rowsPerPage(board.rows, board.pages).forEach((count) => {
      const words = headerWords(board);
      for (let rowIndex = 0; rowIndex < count; rowIndex += 1) {
        appendRow(words, specs[globalIndex], rowIndex, boardIndex, globalIndex);
        globalIndex += 1;
      }
      tokens(words, ['Created', 'using:', 'v22.0.40.7', 'BS', '7671:2018+A3:2024'], 20, 568, 4);
      words.push(word('(c) 1996-2025 Trimble Inc.', 733, 568, 92));
      pages.push({
        documentPage,
        page: documentPage,
        pageWidth: 842,
        pageHeight: 595,
        words,
        lines: [],
        pageType: 'db-schedule',
        allowSingleWay: true,
      });
      documentPage += 1;
    });
  });
  if (pages.length !== 55 || globalIndex !== 246) throw new Error('Synthetic Trimble manifest is inconsistent');
  return pages;
}

export { BOARD_MANIFEST };
