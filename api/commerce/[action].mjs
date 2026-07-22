/* One serverless function for the whole commerce API (Vercel Hobby caps a
 * deployment at 12 functions — seven separate routes would blow the budget).
 * vercel.json rewrites keep the public paths the store front-end calls
 * (/api/store-config etc.) pointing here; unknown actions 404. */
import { handleStoreConfig } from '../_lib/commerce/handlers/store-config.mjs';
import { handleCreateCheckout } from '../_lib/commerce/handlers/create-checkout-session.mjs';
import { handleCheckoutStatus } from '../_lib/commerce/handlers/checkout-status.mjs';
import { handleStripeWebhook } from '../_lib/commerce/handlers/stripe-webhook.mjs';
import { handleDownloadLink } from '../_lib/commerce/handlers/download-link.mjs';
import { handleRequestDownloadLink } from '../_lib/commerce/handlers/request-download-link.mjs';
import { handleRedeemDownloadToken } from '../_lib/commerce/handlers/redeem-download-token.mjs';
import { commerceRoute, rawBodyConfig } from '../_lib/commerce/vercel.mjs';

export const config = { runtime: 'nodejs', ...rawBodyConfig };

const ROUTES = {
  'store-config':           commerceRoute('GET',  handleStoreConfig),
  'create-checkout-session':commerceRoute('POST', handleCreateCheckout),
  'checkout-status':        commerceRoute('GET',  handleCheckoutStatus),
  'stripe-webhook':         commerceRoute('POST', handleStripeWebhook),
  'download-link':          commerceRoute('POST', handleDownloadLink),
  'request-download-link':  commerceRoute('POST', handleRequestDownloadLink),
  'redeem-download-token':  commerceRoute('GET',  handleRedeemDownloadToken),
};

export default function handler(req, res) {
  const action = req.query && req.query.action;
  const route = ROUTES[action];
  if (!route) { res.status(404).json({ error: 'not found' }); return; }
  return route(req, res);
}
