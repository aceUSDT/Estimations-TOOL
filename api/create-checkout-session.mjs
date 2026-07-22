import { handleCreateCheckout } from '../_lib/commerce/handlers/create-checkout-session.mjs';
import { commerceRoute, rawBodyConfig } from '../_lib/commerce/vercel.mjs';

export const config = { runtime: 'nodejs', ...rawBodyConfig };

export default commerceRoute('POST', handleCreateCheckout);
