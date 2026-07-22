import { handleRedeemDownloadToken } from '../_lib/commerce/handlers/redeem-download-token.mjs';
import { commerceRoute, rawBodyConfig } from '../_lib/commerce/vercel.mjs';

export const config = { runtime: 'nodejs', ...rawBodyConfig };

export default commerceRoute('GET', handleRedeemDownloadToken);
