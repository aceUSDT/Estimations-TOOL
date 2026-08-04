import { handlePublicConfig } from './_lib/handlers.mjs';
import { runRoute } from './_lib/route.mjs';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  return runRoute((input, deps) => handlePublicConfig(deps), req, res);
}
