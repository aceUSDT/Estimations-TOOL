import { extractionJobStore, validExtractionJobId } from './_lib/extraction-job-store.mjs';
import { guardRequest, sendJson } from './_lib/request-guard.mjs';

function requestedId(req) {
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || 'localhost').split(',')[0].trim();
  const protocol = String(req.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return new URL(req.url || '/api/extract-status', `${protocol}://${host}`).searchParams.get('id');
}

export async function handleExtractionStatus(req, res, deps = {}) {
  if (!guardRequest(req, res, { methods: ['GET', 'DELETE'], scope: 'extract-status', limit: 360, maxBodyBytes: 0 })) return;
  const id = requestedId(req);
  if (!validExtractionJobId(id)) return sendJson(res, 400, { error: 'Invalid extraction job id' });
  const store = deps.store || extractionJobStore;

  if (req.method === 'DELETE') {
    try { await store.remove(id); } catch { return sendJson(res, 503, { error: 'Extraction job could not be acknowledged' }); }
    return sendJson(res, 200, { status: 'deleted' });
  }

  let record;
  try { record = await store.status(id); } catch { return sendJson(res, 503, { error: 'Extraction status is temporarily unavailable' }); }
  if (record.status === 'missing') return sendJson(res, 404, record);
  return sendJson(res, 200, record);
}

export default async function handler(req, res) {
  return handleExtractionStatus(req, res);
}
