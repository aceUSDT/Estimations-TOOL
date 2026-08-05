/* GET /api/checkout-status?session_id=… — the success page's poll.
 *
 * Verifies the checkout session DIRECTLY WITH STRIPE (the query parameter
 * proves nothing by itself), fulfils as a fallback in case the webhook has
 * not landed yet (fulfil is idempotent, so the race is harmless), and sets
 * the signed download cookie that authorises /api/download-link.
 */
import {
  commerceState, json, disabledResponse, clientIp, rateLimit,
  getStripe,
} from './lib/commerce.mjs';
import { realStore, fulfil, getBySessionId, isActive } from './lib/entitlements.mjs';
import { cookieHeader } from './lib/session-cookie.mjs';

export async function handleCheckoutStatus(req, deps) {
  const { env } = deps;
  if (!commerceState(env).enabled) return disabledResponse();

  const sessionId = new URL(req.url).searchParams.get('session_id');
  if (!sessionId || !/^cs_[A-Za-z0-9_]{8,120}$/.test(sessionId)) {
    return json(400, { error: 'invalid session id' });
  }

  const limited = await rateLimit(deps.store, 'status', clientIp(req), { limit: 60, windowSec: 3600 });
  if (!limited.ok) return json(429, { error: 'too many requests' });

  // Fast path: webhook already fulfilled this session.
  let record = await getBySessionId(deps.store, sessionId);

  if (!record) {
    const stripe = await deps.getStripe(env);
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] });
    } catch {
      return json(404, { error: 'unknown session' });
    }
    if (!session || session.payment_status !== 'paid') {
      return json(200, { status: 'pending' });
    }
    const items = (session.line_items && session.line_items.data) || [];
    if (!items.some((li) => li.price && li.price.id === env.STRIPE_PRICE_ID)) {
      return json(404, { error: 'unknown session' });
    }
    ({ record } = await fulfil(deps.store, session, env));
  }

  if (!isActive(record)) {
    return json(200, { status: record.status === 'refunded' ? 'refunded' : 'pending' });
  }
  return json(200, {
    status: 'paid',
    downloadsReady: true,
    email: null, // never echo the address; the page already knows what the user typed into Stripe
  }, { 'set-cookie': cookieHeader(sessionId, env) });
}

export default async function handler(req) {
  if (req.method !== 'GET') return json(405, { error: 'method not allowed' });
  return handleCheckoutStatus(req, { env: process.env, store: await realStore(), getStripe });
}

export const config = { path: '/api/checkout-status' };
