/* Extraction engine selector — one call site, three honest modes.
 *
 *   agent-team    NVIDIA keys configured (and AGENT_TEAM !== 'off'):
 *                 runAgentTeam — NVIDIA sub-agents extract + second-opinion,
 *                 Gemini masters the audit. If the whole NVIDIA extract chain
 *                 is exhausted (free-tier queue storm) and Gemini is
 *                 configured, falls back to the direct Gemini extractor and
 *                 SAYS SO in the output — silent degradation is forbidden.
 *   gemini        No NVIDIA keys: the existing Gemini-only extractor.
 *   unconfigured  Neither: routes 503 exactly as before.
 *
 * The routes/worker call extractSmart with the same shape they always used
 * plus the raw page fields (textLines/filename/pageNumber/hints) so the team
 * can prompt each agent itself. extractWithVerification ignores the extras.
 */
import { poolStatus, createPool } from './nvidia-pool.mjs';
import { runAgentTeam } from './agent-team.mjs';
import {
  providerStatus, extractWithVerification, callGeminiJson, buildInstruction,
  crossCheckExtractions,
} from './providers.mjs';

export function engineStatus(env = process.env) {
  const nvidia = poolStatus(env);
  const gemini = providerStatus();
  const teamOn = nvidia.configured && env.AGENT_TEAM !== 'off';
  return {
    mode: teamOn ? 'agent-team' : gemini.configured ? 'gemini' : 'unconfigured',
    configured: teamOn || gemini.configured,
    gemini: gemini.gemini,
    nvidia: nvidia.configured,
    verify: gemini.verify,
    primary: teamOn ? 'nvidia' : gemini.primary,
  };
}

let poolSingleton = null;

/* Factory (DI for tests). Production default is exported as extractSmart. */
export function makeExtractSmart(o = {}) {
  const status = o.status || engineStatus;
  const getPool = o.getPool || (() => (poolSingleton = poolSingleton || createPool()));
  const team = o.team || runAgentTeam;
  const gemini = o.gemini || extractWithVerification;
  const callMaster = o.callMaster || callGeminiJson;

  return async function extractSmart(req) {
    const st = status();
    if (st.mode !== 'agent-team') return gemini(req);
    try {
      return await team(
        {
          imageBase64: req.imageBase64, mediaType: req.mediaType,
          textLines: req.textLines, filename: req.filename,
          pageNumber: req.pageNumber, hints: req.hints,
          instruction: req.instruction,
        },
        {
          pool: getPool(),
          crossCheck: crossCheckExtractions,
          buildInstruction,
          geminiConfigured: st.gemini,
          callMaster,
        },
      );
    } catch (e) {
      if (e && e.code === 'role_exhausted' && st.gemini) {
        const out = await gemini(req);
        return { ...out, fallback: 'gemini_direct', fallback_reason: 'nvidia_chain_exhausted' };
      }
      throw e;
    }
  };
}

export const extractSmart = makeExtractSmart();
