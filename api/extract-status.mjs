import { isSameOrigin, isValidJobId } from './_lib/request-guard.mjs';
import { deleteResult, readResult } from './_lib/results.mjs';

const json = (status, body) => Response.json(body, { status });

export default async function handler(req) {
  if (!isSameOrigin(req)) return json(403, { error: 'Cross-origin requests are not accepted' });
  const id = new URL(req.url).searchParams.get('id');
  if (!isValidJobId(id)) return json(400, { error: 'missing or malformed id' });
  try {
    const record = await readResult(id);
    if (!record) return json(200, { status: 'pending' });
    if (record.status === 'done' || record.status === 'error') await deleteResult(id).catch(() => {});
    return json(200, record);
  } catch {
    return json(200, { status: 'pending' });
  }
}
