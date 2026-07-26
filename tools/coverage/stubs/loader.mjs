/* ESM loader hooks used by the netlify-function tests.
 *
 * The handlers must be exercised as shipped (real request validation, real
 * status codes, real blob-record shapes) without a Netlify runtime, an API key,
 * or a network call, so two specifiers are redirected to local stubs:
 *
 *   @netlify/blobs      → stubs/netlify-blobs.mjs   (in-memory store)
 *   ./lib/providers.mjs → stubs/providers.mjs       (scripted extraction result)
 *
 * Register with `module.register('./stubs/loader.mjs', import.meta.url)` before
 * importing a handler.
 */
const REDIRECTS = new Map([
  ['@netlify/blobs', new URL('./netlify-blobs.mjs', import.meta.url).href],
  ['./lib/providers.mjs', new URL('./providers.mjs', import.meta.url).href],
]);

export async function resolve(specifier, context, nextResolve) {
  const redirect = REDIRECTS.get(specifier);
  if (redirect) return { url: redirect, shortCircuit: true };
  return nextResolve(specifier, context);
}
