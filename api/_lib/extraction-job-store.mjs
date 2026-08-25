import { del, get, put } from '@vercel/blob';

const JOB_PREFIX = 'estimation-extraction-jobs/v1';
const ACCESS = 'private';

export const JOB_TTL_MS = 15 * 60 * 1000;

export function extractionJobStoreConfigured(env = process.env) {
  return Boolean(env.BLOB_READ_WRITE_TOKEN || (env.BLOB_STORE_ID && env.VERCEL_OIDC_TOKEN));
}

export function validExtractionJobId(value) {
  return /^[a-z0-9_-]{32,96}$/i.test(String(value || ''));
}

function jobPath(id, state) {
  if (!validExtractionJobId(id)) throw new TypeError('Invalid extraction job id');
  return `${JOB_PREFIX}/${id}/${state}.json`;
}

async function streamText(stream) {
  if (!stream) return '';
  if (typeof Response === 'function') return new Response(stream).text();
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export function makeExtractionJobStore(options = {}) {
  const putBlob = options.putBlob || put;
  const getBlob = options.getBlob || get;
  const deleteBlob = options.deleteBlob || del;
  const now = options.now || (() => Date.now());

  async function write(id, state, record) {
    await putBlob(jobPath(id, state), JSON.stringify(record), {
      access: ACCESS,
      addRandomSuffix: false,
      contentType: 'application/json',
      cacheControlMaxAge: 60,
    });
  }

  async function read(id, state) {
    const blob = await getBlob(jobPath(id, state), { access: ACCESS, useCache: false });
    if (!blob?.stream) return null;
    return JSON.parse(await streamText(blob.stream));
  }

  async function remove(id) {
    await deleteBlob([
      jobPath(id, 'pending'),
      jobPath(id, 'result'),
      jobPath(id, 'error'),
    ]);
  }

  return {
    async create(id) {
      const createdAt = new Date(now()).toISOString();
      await write(id, 'pending', {
        status: 'pending',
        jobId: id,
        createdAt,
        expiresAt: new Date(now() + JOB_TTL_MS).toISOString(),
      });
    },
    async complete(id, result) {
      await write(id, 'result', {
        status: 'done',
        jobId: id,
        completedAt: new Date(now()).toISOString(),
        expiresAt: new Date(now() + JOB_TTL_MS).toISOString(),
        result,
      });
    },
    async fail(id, error) {
      await write(id, 'error', {
        status: 'error',
        jobId: id,
        completedAt: new Date(now()).toISOString(),
        expiresAt: new Date(now() + JOB_TTL_MS).toISOString(),
        error: String(error || 'Extraction failed').slice(0, 1000),
      });
    },
    async finishProcessing(id) {
      try { await deleteBlob(jobPath(id, 'pending')); } catch { /* best effort */ }
    },
    async status(id) {
      const completed = await read(id, 'result');
      if (completed) {
        if (Date.parse(completed.expiresAt) <= now()) {
          try { await remove(id); } catch { /* best effort */ }
          return { status: 'missing', jobId: id };
        }
        return completed;
      }
      const failed = await read(id, 'error');
      if (failed) {
        if (Date.parse(failed.expiresAt) <= now()) {
          try { await remove(id); } catch { /* best effort */ }
          return { status: 'missing', jobId: id };
        }
        return failed;
      }
      const pending = await read(id, 'pending');
      if (!pending) return { status: 'missing', jobId: id };
      if (Date.parse(pending.expiresAt) <= now()) {
        try { await remove(id); } catch { /* best effort */ }
        return { status: 'error', jobId: id, error: 'Extraction job expired before completion' };
      }
      return pending;
    },
    remove,
  };
}

export const extractionJobStore = makeExtractionJobStore();
