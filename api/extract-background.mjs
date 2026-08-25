import { randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { buildInstruction } from '../netlify/functions/lib/providers.mjs';
import { engineStatus, extractSmart } from '../netlify/functions/lib/extraction-engine.mjs';
import {
  extractionJobStore, extractionJobStoreConfigured,
} from './_lib/extraction-job-store.mjs';
import { guardRequest, readJsonBody, sendJson } from './_lib/request-guard.mjs';

function newJobId() {
  return `${Date.now().toString(36)}_${randomUUID()}`;
}

function extractionPayload(body) {
  const {
    filename, page_number: pageNumber, image_base64: imageBase64,
    media_type: mediaType, text_lines: textLines, layout_hint: layoutHint, hints,
  } = body || {};
  return { filename, pageNumber, imageBase64, mediaType, textLines, layoutHint, hints };
}

export async function processExtractionJob(jobId, body, deps = {}) {
  const store = deps.store || extractionJobStore;
  const extract = deps.extract || extractSmart;
  try {
    const payload = extractionPayload(body);
    if (!payload.imageBase64 && !(Array.isArray(payload.textLines) && payload.textLines.length)) {
      throw new TypeError('Provide image_base64 and/or text_lines');
    }
    const instruction = buildInstruction({
      filename: payload.filename,
      pageNumber: payload.pageNumber,
      hints: payload.hints,
      textLines: payload.textLines,
      layoutHint: payload.layoutHint,
    });
    const result = await extract({ ...payload, instruction, maxTokens: 12000 });
    await store.complete(jobId, result);
  } catch (error) {
    const message = error?.message || String(error);
    try { await store.fail(jobId, message); } catch { /* the status route will report a missing job */ }
  } finally {
    await store.finishProcessing(jobId);
  }
}

export async function handleBackgroundExtraction(req, res, deps = {}) {
  if (!guardRequest(req, res, { methods: ['POST'], scope: 'extract-background', limit: 60 })) return;
  const configured = deps.configured || (() => extractionJobStoreConfigured());
  const status = deps.engineStatus || engineStatus;
  if (!configured()) return sendJson(res, 503, { error: 'Background extraction storage is not configured' });
  if (!status().configured) {
    return sendJson(res, 503, { error: 'AI extraction is not configured in the hosting environment' });
  }

  let body;
  try { body = readJsonBody(req); } catch { return sendJson(res, 400, { error: 'Invalid JSON body' }); }
  const payload = extractionPayload(body);
  if (!payload.imageBase64 && !(Array.isArray(payload.textLines) && payload.textLines.length)) {
    return sendJson(res, 400, { error: 'Provide image_base64 and/or text_lines' });
  }

  const store = deps.store || extractionJobStore;
  const schedule = deps.waitUntil || waitUntil;
  const jobId = newJobId();
  try {
    await store.create(jobId);
    schedule(processExtractionJob(jobId, body, { ...deps, store }));
  } catch (error) {
    try { await store.remove(jobId); } catch { /* best effort */ }
    return sendJson(res, 503, { error: 'Background extraction could not be started' });
  }
  return sendJson(res, 202, { status: 'pending', jobId });
}

export default async function handler(req, res) {
  return handleBackgroundExtraction(req, res);
}
