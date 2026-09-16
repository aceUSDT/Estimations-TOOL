// Entirely synthetic. The quantities reproduce the reported state, not the
// private document's text, layout, page distribution or expected extraction.
export function createOrphanedTakeoff({ count = 238, pageCount = 573, unresolvedRows = 16 } = {}) {
  const rows = Array.from({ length: count + unresolvedRows }, (_, index) => ({
    id: `ownership-${index}`, kind: 'schedule', fileId: 'ownership-synthetic',
    page: index < count / 2 ? 1 : 2, line: index, way: (index % 119) + 1,
    boardNorm: 'DBMISSING', boardRef: 'DB-MISSING',
    device: index < count ? 'MCB' : null, rating: index < count ? 20 : null,
    qty: 1, status: 'confirmed', desc: `Synthetic circuit ${index + 1}`,
    srcText: `Synthetic way ${(index % 119) + 1} ${index < count ? 'MCB 20A' : 'unreadable protection'}`,
    bbox: [10, 10 + (index % 20) * 15, 200, 12],
  }));
  return { boards: {}, rows,
    pages: Array.from({ length: pageCount }, (_, index) => ({ fileId: 'ownership-synthetic', page: index + 1,
      type: 'unknown', textLines: index < 2 ? 119 : 1, rowsParsed: rows.filter(row => row.page === index + 1).length })),
    files: [{ id: 'ownership-synthetic', name: 'synthetic-ownership.pdf', status: 'ready' }] };
}

export const resolvedSyntheticBoard = { norm: 'DB1', orig: 'DB-1', parent: 'MAIN',
  inScope: true, scheduleEvidence: true, takeoffEligible: true,
  pages: [{ fileId: 'ownership-synthetic', page: 1, primary: true, sourceRole: 'schedule' }] };
