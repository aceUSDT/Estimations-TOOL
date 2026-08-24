import { del, get, list, put } from '@vercel/blob';

const PREFIX = 'ai-extractions/';
const pathnameFor = (jobId) => `${PREFIX}${jobId}.json`;

export async function writeResult(jobId, record) {
  return put(pathnameFor(jobId), JSON.stringify(record), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

export async function readResult(jobId) {
  const { blobs } = await list({ prefix: pathnameFor(jobId), limit: 1 });
  const blob = blobs.find((entry) => entry.pathname === pathnameFor(jobId));
  if (!blob) return null;
  const result = await get(blob.url, { access: 'private', useCache: false });
  if (!result || !result.stream) return null;
  return new Response(result.stream).json();
}

export async function deleteResult(jobId) {
  const { blobs } = await list({ prefix: pathnameFor(jobId), limit: 1 });
  const blob = blobs.find((entry) => entry.pathname === pathnameFor(jobId));
  if (blob) await del(blob.url);
}
