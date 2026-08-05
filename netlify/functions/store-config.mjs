/* GET /api/store-config — public store state for the /download/ page.
 *
 * The ONLY price the UI ever shows comes from here, read server-side from
 * Stripe. The browser can neither supply nor influence a price anywhere in
 * the flow. When commerce is disabled the page shows a "coming soon" state,
 * driven by commerceEnabled:false from this endpoint — nothing half-works.
 */
import { commerceState, productName, json, getStripe } from './lib/commerce.mjs';
import { SUPPORTED_BUILDS } from './lib/release-store.mjs';

// Module-scope price cache: Stripe prices change rarely; avoid an API call
// per page view. Netlify may recycle the instance at any time — that is fine.
let priceCache = { value: null, at: 0 };
const PRICE_CACHE_MS = 5 * 60 * 1000;

export async function handleStoreConfig(req, deps) {
  const { env } = deps;
  const state = commerceState(env);
  const base = {
    commerceEnabled: state.enabled,
    product: {
      name: productName(env),
      builds: SUPPORTED_BUILDS.map(({ id, platform, arch, minimumOs }) => ({ id, platform, arch, minimumOs })),
    },
    supportEmail: env.SUPPORT_EMAIL || null,
    sellerName: env.LEGAL_SELLER_NAME || null,
  };
  if (!state.enabled) {
    return json(200, { ...base, reason: 'coming-soon' });
  }
  try {
    if (!priceCache.value || Date.now() - priceCache.at > PRICE_CACHE_MS) {
      const stripe = await deps.getStripe(env);
      const price = await stripe.prices.retrieve(env.STRIPE_PRICE_ID);
      if (!price || price.active !== true || typeof price.unit_amount !== 'number') {
        throw new Error('price unavailable');
      }
      priceCache = {
        value: { amount: price.unit_amount, currency: price.currency, type: price.type },
        at: Date.now(),
      };
    }
    return json(200, { ...base, price: priceCache.value });
  } catch {
    // Never render a store with an unknown price — degrade to disabled.
    return json(200, { ...base, commerceEnabled: false, reason: 'price-unavailable' });
  }
}

export default async function handler(req) {
  if (req.method !== 'GET') return json(405, { error: 'method not allowed' });
  return handleStoreConfig(req, { env: process.env, getStripe });
}

export const config = { path: '/api/store-config' };
