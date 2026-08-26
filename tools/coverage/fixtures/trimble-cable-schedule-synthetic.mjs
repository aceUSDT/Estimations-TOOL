const word = (text, x, y, width = Math.max(6, String(text).length * 4.1), height = 8) => ({
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
function appendRow(words, { id, rating = 10, device = 'MCB', target, length = 10 }, index) {
  const top = 180 + index * 67;
  tokens(words, ['1', 'x', '1', 'x', '3c'], 300, top, 3);
  words.push(word('2.5', 368, top));
  tokens(words, ['LSZH', 'Cable', 'Cu'], 400, top, 3);
  words.push(word(String(length), 542, top));
  words.push(word('0', 586, top));
  words.push(word('1.20', 631, top));
  words.push(word('N/A', 673, top));
  words.push(word(String(rating), 704, top));
  words.push(word(device, 726, top));
  words.push(word('N/A', 756, top));
  words.push(word('N/A', 786, top));
  tokens(words, ['Connected', 'From:', 'FF-03', 'LIGHTING', '&', 'POWER'], 131, top + 7, 3);
  words.push(word(id, 43, top + 12, 72));
  words.push(word(`3/${index + 1}/L1`, 178, top + 17, 32));
  words.push(word('2.5', 583, top + 14));
  words.push(word('No', 584, top + 25));
  tokens(words, ['Connected', 'to:', '---'], 131, top + 37, 3);
  tokens(words, target.split(' '), 180, top + 37, 3);
}

export function createTrimbleCableScheduleSyntheticPage() {
  const words = [];
  tokens(words, ['Cable', 'Schedule'], 320, 54, 6);
  tokens(words, ['Id', 'No:'], 42, 132, 3);
  tokens(words, ['Connected', 'From:'], 131, 132, 3);
  words.push(word('Cores', 300, 132));
  words.push(word('CSA', 368, 132));
  tokens(words, ['Cable', 'Type'], 400, 132, 3);
  words.push(word('Length', 542, 132));
  tokens(words, ['Protective', 'Device'], 672, 123, 3);
  words.push(word('Ir(A)', 673, 143));
  words.push(word('In(A)', 704, 143));
  words.push(word('Type', 726, 143));
  words.push(word('RCD', 756, 132));
  words.push(word('AFDD', 786, 132));
  tokens(words, ['Connected', 'To:'], 131, 145, 3);

  appendRow(words, { id: 'FF-L&P-3/L/1-L1', target: 'GF-05 STAIRCORE LIGHTS', length: 30 }, 0);
  appendRow(words, { id: 'FF-L&P-3/L/1-L2', target: 'FF-03 RISER LIGHTS' }, 1);
  appendRow(words, { id: 'FF-L&P-3/L/1-L3', target: 'FF-04 ENTRANCE LIGHTS' }, 2);
  appendRow(words, { id: 'FF-L&P-3/L/2-L1', target: 'FF-05 STORE LIGHTS' }, 3);
  appendRow(words, { id: 'FF-L&P-3/L/2-L2', target: 'FF-06 CLEANER LIGHTS' }, 4);
  appendRow(words, { id: 'FF-L&P-3/P/1-TP&N', target: 'GF-DB-01 THREE PHASE LOAD', rating: 32 }, 5);
  tokens(words, ['Created', 'using:', 'v22.0.44.2', 'BS', '7671:2018+A3:2024'], 20, 568, 4);
  words.push(word('(c) 1996-2026 Trimble Inc.', 733, 568, 92));
  return {
    documentPage: 1,
    page: 1,
    pageWidth: 842,
    pageHeight: 595,
    words,
    lines: [],
    pageType: 'cable-schedule',
    allowSingleWay: true,
  };
}
