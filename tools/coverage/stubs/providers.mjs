/* Stand-in for netlify/functions/lib/providers.mjs.
 *
 * The pure helpers are the real ones — only the model call is scripted, so the
 * handler tests never touch the network. The test controls the outcome with:
 *
 *   globalThis.__extraction = { result } | { error: Error }
 *   globalThis.__extractionCalls = [args, ...]
 */
const real = await import(new URL('../../../netlify/functions/lib/providers.mjs', import.meta.url).href);

export const CLAUDE_MODEL = real.CLAUDE_MODEL;
export const GEMINI_MODEL = real.GEMINI_MODEL;
export const providerStatus = real.providerStatus;
export const buildInstruction = real.buildInstruction;
export const crossCheckExtractions = real.crossCheckExtractions;
export const geminiSchema = real.geminiSchema;

export async function extractWithVerification(args) {
  (globalThis.__extractionCalls || (globalThis.__extractionCalls = [])).push(args);
  const scripted = globalThis.__extraction || {};
  if (scripted.error) throw scripted.error;
  return scripted.result || { result: { devices: [] }, provider: 'anthropic', verification: null };
}
