/* Poll endpoint for the background extraction (extract-background.mjs).
 * Returns {status:'pending'} until the background job writes its result to the
 * Blobs store, then {status:'done', result, ...} or {status:'error', error}.
 * Reads are one-shot from the client's perspective; the record is deleted after
 * a terminal state is returned so the store doesn't accumulate.
 */
import { getStore } from '@netlify/blobs';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default async function handler(req) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return json(400, { error: 'missing id' });
  const store = getStore('extractions');
  let rec = null;
  try { rec = await store.get(id, { type: 'json' }); } catch (e) { return json(200, { status: 'pending' }); }
  if (!rec) return json(200, { status: 'pending' });
  if (rec.status === 'done' || rec.status === 'error') {
    // terminal — clean up the record (best effort)
    try { await store.delete(id); } catch { /* ignore */ }
  }
  return json(200, rec);
}
