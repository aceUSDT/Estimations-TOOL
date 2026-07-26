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
  // A store read failure may be transient, so the client keeps polling — but it
  // is reported so a permanent outage surfaces instead of an endless 'pending'.
  try {
    rec = await store.get(id, { type: 'json' });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error(`extract-status: could not read job ${id}:`, err);
    return json(200, { status: 'pending', error: `result store unavailable: ${message}` });
  }
  if (!rec) return json(200, { status: 'pending' });
  if (rec.status === 'done' || rec.status === 'error') {
    // terminal — clean up the record (best effort)
    try { await store.delete(id); } catch (err) { console.warn(`extract-status: could not delete job ${id}:`, err); }
  }
  return json(200, rec);
}
