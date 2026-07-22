import { handleStripeWebhook } from '../_lib/commerce/handlers/stripe-webhook.mjs';
import { commerceRoute, rawBodyConfig } from '../_lib/commerce/vercel.mjs';

export const config = { runtime: 'nodejs', ...rawBodyConfig };

export default commerceRoute('POST', handleStripeWebhook);
