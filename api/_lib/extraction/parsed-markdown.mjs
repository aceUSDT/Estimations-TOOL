/* Turn a parsed document (markdown) into the LINE shape the extractor reads.
 *
 * Unlimited-OCR returns a whole document as markdown with its tables preserved.
 * The temptation is to write a new extraction path for it. That would be a
 * mistake: this project's value is in what already reads a line —
 * parseScheduleLine's four way-marker forms, the damaged phase cells, the
 * classless dialects, board detection, way conflicts, coverage. All of it is
 * measured against real documents (PROJECT_HISTORY §2). None of it should be
 * re-derived against a new input format.
 *
 * So this converts markdown DOWN to lines, and everything downstream is
 * untouched. A table row
 *
 *     | 7 | L1 | Kitchen ring | 32 | B | 30 |
 *
 * becomes
 *
 *     7 L1 Kitchen ring 32 B 30
 *
 * which is exactly the shape parseScheduleLine already reads — and a cleaner one
 * than OCR produces, because the cell boundaries are known rather than inferred
 * from pixel gaps (§2.4: the widest whitespace corridor on a real sheet was 1.2%
 * of the page span).
 *
 * UNVERIFIED: no document has been through the real service from here, so the
 * exact markdown the model emits — how it marks page breaks, whether it always
 * uses pipe tables — is taken from the format's documented behaviour, not from a
 * captured result. The page-break patterns below are deliberately generous for
 * that reason, and a document that matches none of them is returned as ONE page
 * rather than being split wrongly.
 */

/* Page separators seen across markdown document parsers. A wrong split is worse
 * than no split: it invents page numbers, and every completeness report and
 * Review item cites a page an estimator then cannot find. */
const PAGE_BREAK = [
  /^\s*<!--\s*page[^>]*?(\d+)[^>]*?-->\s*$/i,     // <!-- page 3 -->, <!-- PageBreak 3 -->
  /^\s*---\s*page\s*(\d+)\s*---\s*$/i,             // --- Page 3 ---
  /^\s*\[?page\s*(\d+)\]?\s*$/i,                   // Page 3 / [Page 3]
  /^\s*#{1,6}\s*page\s*(\d+)\s*$/i,                // ## Page 3
];

function pageBreakNumber(line) {
  for (const re of PAGE_BREAK) {
    const m = String(line).match(re);
    if (m) return Number(m[1]) || null;
  }
  return null;
}

/* A markdown table separator: |---|:--:|---| and friends. Dropped, because it
 * carries no data and would parse as a row of dashes. */
export function isTableSeparator(line) {
  const t = String(line).trim();
  if (!t.includes('-') || !t.includes('|')) return false;
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(t);
}

export function isTableRow(line) {
  const t = String(line).trim();
  return t.startsWith('|') && t.lastIndexOf('|') > 0;
}

/* One markdown table row → one flat line.
 *
 * Cells are joined with two spaces, not one. The extractor's line grouping and
 * several dialect patterns key off run boundaries, and a single space would glue
 * "32" and "B" into a token that reads as neither a rating nor a curve. Empty
 * cells collapse rather than emitting a gap, because a blank cell is an absent
 * value, not a value of "". */
export function tableRowToLine(line) {
  const t = String(line).trim();
  const inner = t.replace(/^\|/, '').replace(/\|\s*$/, '');
  return inner.split('|').map((c) => c.trim()).filter(Boolean).join('  ').trim();
}

/* Strip the markdown that carries no take-off meaning, keeping the text. A
 * heading is often the board's own name ("## DB-LL-D"), so its TEXT is kept and
 * only the hashes go. */
export function flattenMarkdownText(line) {
  return String(line)
    .replace(/^\s{0,3}#{1,6}\s+/, '')          // heading marks, text kept
    .replace(/^\s{0,3}>\s?/, '')               // block quote
    .replace(/^\s{0,3}([*+-]|\d+[.)])\s+/, '') // list bullet
    .replace(/\*\*(.+?)\*\*/g, '$1')           // bold
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')  // italic
    .replace(/`([^`]*)`/g, '$1')               // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')      // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // links → their text
    .trimEnd();
}

/* markdown → pages of lines, in the shape the analysis pipeline consumes.
 *
 * Returns [{ page, lines: [{ text }] }] so it can be handed to the same code
 * that receives pdf.js output. */
export function parsedMarkdownToPages(markdown, opts = {}) {
  const keepEmpty = Boolean(opts.keepEmpty);
  const src = String(markdown || '');
  if (!src.trim()) return [];

  const pages = [];
  let current = { page: 1, lines: [] };

  for (const raw of src.split(/\r?\n/)) {
    const breakAt = pageBreakNumber(raw);
    if (breakAt !== null || (/^\s*<!--\s*page/i.test(raw))) {
      /* Start a new page. The FIRST break also closes page 1, so a document that
         opens with "<!-- page 1 -->" does not produce an empty leading page. */
      if (current.lines.length) pages.push(current);
      current = { page: breakAt || (pages.length + 1), lines: [] };
      continue;
    }
    if (isTableSeparator(raw)) continue;
    const text = isTableRow(raw) ? tableRowToLine(raw) : flattenMarkdownText(raw);
    if (!text.trim() && !keepEmpty) continue;
    current.lines.push({ text });
  }
  if (current.lines.length) pages.push(current);

  /* No recognisable break ⇒ ONE page, which falls out of the loop rather than
     needing a guard: nothing is pushed until a break matches, so an unmarked
     document accumulates into a single page by construction. Guessing at
     boundaries would put a wrong page number on every Review item and
     completeness row, and an estimator sent to page 7 of a document whose page 7
     holds something else stops trusting the tool.
     (An earlier version "collapsed" multi-page output when no break was seen.
     That branch could never run — the same condition that pushes a page sets
     sawExplicitBreak — and mutation testing caught it as dead code.) */
  return pages.map((p, i) => ({ page: p.page || i + 1, lines: p.lines }));
}

/* How much of the document looks like table rows. A DB schedule parsed well is
 * mostly table; a result that is nearly all prose means the parser read the
 * sheet as text and the take-off will be thin — worth reporting rather than
 * discovering from an empty workbook (§2.8). */
export function tableDensity(markdown) {
  const lines = String(markdown || '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return 0;
  const rows = lines.filter((l) => isTableRow(l) && !isTableSeparator(l)).length;
  return rows / lines.length;
}
