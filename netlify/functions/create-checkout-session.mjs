/* POST /api/create-checkout-session — start a Stripe-hosted Checkout.
 *
 * The browser sends NOTHING that affects money. The price is pinned
 * server-side to STRIPE_PRICE_ID; any request that tries to smuggle a
 * price, amount, or currency is rejected outright. Card details never touch
 * this origin — Stripe hosts the payment page.
 */
import {
  commerceState, json, disabledResponse, sameOrigin, clientIp,
  rateLimit, getStripe, readSmallJson,
} from './lib/commerce.mjs';
import { realStore } from './lib/entitlements.mjs';

const FORBIDDEN_FIELDS = ['price', 'priceId', 'price_id', 'amount', 'currency', 'unit_amount', 'line_items'];

export async function handleCreateCheckout(req, deps) {
  const { env } = deps;
  if (!commerceState(env).enabled) return disabledResponse();
  if (!sameOrigin(req, env)) return json(403, { error: 'forbidden' });

  const body = await readSmallJson(req);
  if (body === null) return json(400, { error: 'invalid request body' });
  const smuggled = FORBIDDEN_FIELDS.filter((f) => f in body);
  if (smuggled.length > 0) {
    return json(400, { error: 'price is not client-configurable' });
  }

  const limited = await rateLimit(deps.store, 'checkout', clientIp(req), { limit: 10, windowSec: 3600 });
  if (!limited.ok) return json(429, { error: 'too many requests, try again later' });

  const stripe = await deps.getStripe(env);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${env.SITE_URL}/download/success/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.SITE_URL}/download/?cancelled=1`,
    automatic_tax: { enabled: env.STRIPE_TAX_ENABLED === 'true' },
    allow_promotion_codes: true,
    metadata: { product: 'estimation-tools-desktop' },
  });
  return json(200, { url: session.url });
}

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  return handleCreateCheckout(req, { env: process.env, store: await realStore(), getStripe });
}

export const config = { path: '/api/create-checkout-session' };
