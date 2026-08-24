import { del, get, put } from '@vercel/blob';

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
  const result = await get(pathnameFor(jobId), { access: 'private', useCache: false });
  if (!result || !result.stream) return null;
  return new Response(result.stream).json();
}

export async function deleteResult(jobId) {
  await del(pathnameFor(jobId));
}
