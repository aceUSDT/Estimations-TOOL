/* In-memory stand-in for @netlify/blobs.
 *
 * State and failure injection live on globalThis so the test can inspect what a
 * handler wrote and force store outages:
 *
 *   globalThis.__blobs.records            Map<storeName, Map<key, value>>
 *   globalThis.__blobs.fail               { setJSON, get, delete } booleans
 */
const blobs = globalThis.__blobs || (globalThis.__blobs = {
  records: new Map(),
  fail: { setJSON: false, get: false, delete: false },
});

export function getStore(name) {
  const storeName = typeof name === 'string' ? name : name && name.name;
  if (!blobs.records.has(storeName)) blobs.records.set(storeName, new Map());
  const records = blobs.records.get(storeName);
  const guard = (operation) => {
    if (blobs.fail[operation]) throw new Error(`blob store ${operation} unavailable`);
  };
  return {
    async setJSON(key, value) { guard('setJSON'); records.set(key, value); },
    async get(key) { guard('get'); return records.has(key) ? records.get(key) : null; },
    async delete(key) { guard('delete'); records.delete(key); },
  };
}
