import { handleStatus } from '../_lib/handlers.mjs';
import { runRoute } from '../_lib/route.mjs';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  return runRoute(handleStatus, req, res);
}
