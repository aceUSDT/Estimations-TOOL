import { poolStatus, createPool } from './nvidia-pool.mjs';
import { runAgentTeam } from './agent-team.mjs';
import {
  providerStatus, extractPage, callGeminiJson, buildInstruction, crossCheckExtractions,
} from './providers.mjs';

export function engineStatus(env = process.env) {
  const nvidia = poolStatus(env);
  const gemini = providerStatus(env);
  const teamOn = nvidia.configured && env.AGENT_TEAM !== 'off';
  return {
    mode: teamOn ? 'agent-team' : gemini.configured ? 'gemini' : 'unconfigured',
    configured: teamOn || gemini.configured,
    gemini: gemini.gemini,
    nvidia: nvidia.configured,
    primary: teamOn ? 'nvidia' : gemini.primary,
  };
}

let poolSingleton = null;

export function makeExtractSmart(options = {}) {
  const status = options.status || engineStatus;
  const getPool = options.getPool || (() => (poolSingleton = poolSingleton || createPool()));
  const team = options.team || runAgentTeam;
  const gemini = options.gemini || extractPage;
  const callMaster = options.callMaster || callGeminiJson;
  return async function extractSmart(request) {
    const current = status();
    if (current.mode !== 'agent-team') return gemini(request);
    try {
      return await team(request, {
        pool: getPool(), crossCheck: crossCheckExtractions, buildInstruction,
        geminiConfigured: current.gemini, callMaster,
      });
    } catch (error) {
      if (error?.code === 'role_exhausted' && current.gemini) {
        const output = await gemini(request);
        return { ...output, fallback: 'gemini_direct', fallback_reason: 'nvidia_chain_exhausted' };
      }
      throw error;
    }
  };
}

export const extractSmart = makeExtractSmart();
