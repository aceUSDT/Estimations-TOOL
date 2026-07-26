/* Deterministic coverage metrics shared by the coverage reports.
 * Counting stays in code here — never in a model (CLAUDE.md). */

/* Canonical board-reference normalisation used for ground-truth matching. */
export const normRef = (s) => String(s).toUpperCase().replace(/[\s.\-_/]+/g, '');

const countable = (row) => row.kind !== 'mention' && row.way != null;

/* Distinct (board, way) slots captured by an analysis. */
export function waySlots(rows) {
  const slots = new Set();
  for (const row of rows) {
    if (!countable(row)) continue;
    slots.add((row.boardNorm || '?') + '#' + row.way);
  }
  return slots;
}

/* Distinct ways captured for one normalised board reference. */
export function boardWays(rows, boardNorm) {
  const ways = new Set();
  for (const row of rows) {
    if (!countable(row) || row.boardNorm !== boardNorm) continue;
    ways.add(row.way);
  }
  return ways;
}
