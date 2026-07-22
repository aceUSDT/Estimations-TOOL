import { handleDownloadLink } from '../_lib/commerce/handlers/download-link.mjs';
import { commerceRoute, rawBodyConfig } from '../_lib/commerce/vercel.mjs';

export const config = { runtime: 'nodejs', ...rawBodyConfig };

export default commerceRoute('POST', handleDownloadLink);
