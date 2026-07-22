import { handleCheckoutStatus } from '../_lib/commerce/handlers/checkout-status.mjs';
import { commerceRoute, rawBodyConfig } from '../_lib/commerce/vercel.mjs';

export const config = { runtime: 'nodejs', ...rawBodyConfig };

export default commerceRoute('GET', handleCheckoutStatus);
