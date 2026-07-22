import { handleStoreConfig } from '../_lib/commerce/handlers/store-config.mjs';
import { commerceRoute, rawBodyConfig } from '../_lib/commerce/vercel.mjs';

export const config = { runtime: 'nodejs', ...rawBodyConfig };

export default commerceRoute('GET', handleStoreConfig);
