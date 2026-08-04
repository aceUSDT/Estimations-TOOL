/* Parsed-document markdown → the extractor's line shape.
 *
 * The point of this module is that it adds NO extraction logic: it lowers
 * markdown to lines so everything already measured against real documents keeps
 * applying. So the test that matters is not "does it strip pipes" — it is
 * whether the production parseScheduleLine reads real ways out of the result.
 * That is asserted here against the same parser the app runs.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const load = (p) => import(pathToFileURL(path.resolve(ROOT, '..', p)));

const {
  parsedMarkdownToPages, tableRowToLine, isTableRow, isTableSeparator,
  flattenMarkdownText, tableDensity,
} = await load('api/_lib/extraction/parsed-markdown.mjs');
const P = require('./app-pipeline.cjs');

let fail = 0;
const check = (name, cond, detail) => { if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; } };

/* ---- the shape a document parser actually returns for a DB schedule ---- */
const SCHEDULE_MD = `# Distribution Board Schedule

**Board Ref:** DB-1-GF
Number of Ways: 12

| Way | Phase | Circuit Description | Rating (A) | Curve | RCD (mA) |
|-----|:-----:|---------------------|-----------:|-------|----------|
| 1 | L1 | Lighting Ground Floor | 6 | B | - |
| 2 | L2 | Kitchen ring | 32 | B | 30 |
| 3 | L3 | Spare | | | |
| 7 | L1 | Fixed power Reception | 20 | C | 30 |

*Notes: all cables LSF.*
`;

{
  const pages = parsedMarkdownToPages(SCHEDULE_MD);
  check('a document with no page markers is ONE page', pages.length === 1, String(pages.length));
  const text = pages[0].lines.map((l) => l.text);

  /* Asserted against dashes AND alignment colons: a |:--:| separator survives a
     dashes-only check, because the colons make it fail /^-+$/. The first version
     of this check did exactly that and passed with the separator left in. */
  check('the separator row is dropped',
    !text.some((t) => /^[-:\s|]+$/.test(t) && t.includes('-')), JSON.stringify(text.slice(0, 4)));
  check('the board reference survives as plain text',
    text.some((t) => t.includes('DB-1-GF') && !t.includes('**')), JSON.stringify(text.filter((t) => t.includes('DB-1-GF'))));
  check('the heading keeps its words and loses its hashes',
    text.some((t) => t === 'Distribution Board Schedule'), JSON.stringify(text[0]));

  /* THE ASSERTION THAT MATTERS: the production parser reads these rows. */
  const ctx = () => ({ board: 'DB1GF', sawHeader: true });
  const rows = text.map((t) => P.parseScheduleLine(t, ctx())).filter(Boolean);
  const byWay = new Map(rows.filter((r) => r.way != null).map((r) => [r.way, r]));

  check('way 1 reads as 6A on L1', byWay.get(1) && byWay.get(1).rating === 6 && byWay.get(1).phase === 'L1',
    JSON.stringify(byWay.get(1) && { r: byWay.get(1).rating, p: byWay.get(1).phase }));
  check('way 2 reads as 32A on L2', byWay.get(2) && byWay.get(2).rating === 32 && byWay.get(2).phase === 'L2',
    JSON.stringify(byWay.get(2) && { r: byWay.get(2).rating, p: byWay.get(2).phase }));
  check('way 7 reads as 20A on L1', byWay.get(7) && byWay.get(7).rating === 20,
    JSON.stringify(byWay.get(7) && byWay.get(7).rating));
  /* A spare way is a way. Losing it makes the board look smaller than it is. */
  check('the spare way is captured, not dropped', byWay.get(3) && byWay.get(3).spare === true,
    JSON.stringify(byWay.get(3) && { spare: byWay.get(3).spare }));

  /* And the board is found from the same lines. */
  const board = P.scheduleBoardFromLines(text);
  check('the board resolves from the parsed markdown', board && board.norm === 'DB1GF', JSON.stringify(board));
}

/* ---- cell joining ---- */
{
  check('a table row becomes a flat line',
    tableRowToLine('| 7 | L1 | Kitchen ring | 32 | B |') === '7  L1  Kitchen ring  32  B',
    tableRowToLine('| 7 | L1 | Kitchen ring | 32 | B |'));
  /* Two spaces, not one: a single space glues "32" and "B" into a token that is
     neither a rating nor a curve. */
  check('cells are separated by more than one space', /\d {2,}L1/.test(tableRowToLine('| 7 | L1 | x |')));
  /* The empty cell must be in the MIDDLE. Trailing empties are removed by the
     final trim whether or not they were filtered, so a trailing-only case cannot
     tell the two behaviours apart — as the first version of this check did not. */
  check('an empty cell in the middle collapses rather than leaving a gap',
    tableRowToLine('| 3 | | Spare | 6 |') === '3  Spare  6',
    JSON.stringify(tableRowToLine('| 3 | | Spare | 6 |')));
  check('trailing empty cells leave nothing behind',
    tableRowToLine('| 3 | L3 | Spare | | | |') === '3  L3  Spare',
    JSON.stringify(tableRowToLine('| 3 | L3 | Spare | | | |')));
  check('a separator row is recognised', isTableSeparator('|-----|:---:|------:|'));
  check('a data row is not mistaken for a separator', !isTableSeparator('| 1 | L1 | Lighting - hall | 6 |'));
  check('prose is not a table row', !isTableRow('Notes: all cables LSF.'));
}

/* ---- markdown that carries no take-off meaning ---- */
{
  check('bold is removed but its text kept', flattenMarkdownText('**Board Ref:** DB-1') === 'Board Ref: DB-1');
  check('a bullet loses its marker', flattenMarkdownText('- 12 way TP&N') === '12 way TP&N');
  check('a link keeps its text', flattenMarkdownText('see [the schedule](http://x)') === 'see the schedule');
  check('an image is dropped', flattenMarkdownText('![plan](x.png)') === '');
  /* A rating written 6*A must not lose the asterisk to italic handling — the
     positional rating scan already tolerates a trailing mark, and eating it
     would change the token. */
  check('a lone asterisk in a value is not treated as italics',
    flattenMarkdownText('| 17L2 | 16* |').includes('16*'), flattenMarkdownText('| 17L2 | 16* |'));
}

/* ---- page breaks ---- */
{
  const md = `<!-- page 1 -->
| 1 | L1 | A | 6 |
<!-- page 2 -->
| 2 | L2 | B | 10 |`;
  const pages = parsedMarkdownToPages(md);
  check('explicit page markers split the document', pages.length === 2, String(pages.length));
  check('page numbers come from the markers', pages[0].page === 1 && pages[1].page === 2,
    JSON.stringify(pages.map((p) => p.page)));
  check('a leading marker does not create an empty first page',
    pages[0].lines.length > 0 && pages[0].lines[0].text.startsWith('1'), JSON.stringify(pages[0].lines[0]));

  for (const [marker, why] of [['--- Page 2 ---', 'ruled form'], ['## Page 2', 'heading form'], ['Page 2', 'bare form']]) {
    const p = parsedMarkdownToPages(`| 1 | L1 | A | 6 |\n${marker}\n| 2 | L2 | B | 10 |`);
    check(`page marker recognised: ${why}`, p.length === 2, `${p.length} pages`);
  }

  /* A wrong split is worse than none: it puts a page number on every Review item
     that the estimator then cannot find in the document. */
  const noMarkers = parsedMarkdownToPages('| 1 | L1 | A | 6 |\n| 2 | L2 | B | 10 |\n| 3 | L3 | C | 16 |');
  check('no recognisable marker ⇒ one page, not a guess', noMarkers.length === 1, String(noMarkers.length));
  check('nothing is lost when it is not split', noMarkers[0].lines.length === 3, String(noMarkers[0].lines.length));
}

/* ---- table density, so a thin parse is visible before the workbook is ---- */
{
  check('a schedule is mostly table', tableDensity(SCHEDULE_MD) > 0.3, String(tableDensity(SCHEDULE_MD)));
  check('prose is not', tableDensity('All works shall comply with BS 7671.\nSee drawing E-001.') === 0);
  check('empty input is zero, not NaN', tableDensity('') === 0);
}

/* ---- empty and junk input ---- */
{
  check('empty markdown ⇒ no pages', parsedMarkdownToPages('').length === 0);
  check('whitespace-only markdown ⇒ no pages', parsedMarkdownToPages('   \n\n  ').length === 0);
  check('null is tolerated', parsedMarkdownToPages(null).length === 0);
}

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: parsed markdown lowers to lines the production parser reads — ways, ratings, spares and the board.');
