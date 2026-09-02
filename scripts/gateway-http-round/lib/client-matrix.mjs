/**
 * Gateway client-round recording matrix: client × protocol profile.
 *
 * Each cell runs the full conversation-round scenario (skills, files, MCP, subagent)
 * through Eco Bridge → embedded Gateway → upstream provider.
 */
import { GATEWAY_HTTP_PROFILES } from "./profiles.mjs";

/** @typedef {"codex" | "claude" | "pi"} GatewayClientId */
/** @typedef {keyof typeof GATEWAY_HTTP_PROFILES} GatewayProfileId */

export const GATEWAY_CLIENTS = /** @type {const} */ (["codex", "claude", "pi"]);

export const FULL_ROUND_SCENARIO_ID = "full_round";

/**
 * 3×3 recording matrix: client × protocol upstream.
 *
 * Responses: Luna @ Pomener (`packy_responses`) for all clients.
 * Anthropic: Packy Messages. Chat: LongCat Chat Completions.
 *
 * @type {Array<{ client: GatewayClientId, profileId: GatewayProfileId }>}
 */
export const RECORDING_CELL_SPECS = [
  { client: "codex", profileId: "packy_responses" },
  { client: "codex", profileId: "packy_anthropic" },
  { client: "codex", profileId: "longcat_chat" },
  { client: "claude", profileId: "packy_responses" },
  { client: "claude", profileId: "packy_anthropic" },
  { client: "claude", profileId: "longcat_chat" },
  { client: "pi", profileId: "packy_responses" },
  { client: "pi", profileId: "packy_anthropic" },
  { client: "pi", profileId: "longcat_chat" },
];

/**
 * Client → gateway HTTP face used for routing.
 * @type {Record<GatewayClientId, "responses" | "messages" | "pi-native">}
 */
export const CLIENT_GATEWAY_FACE = {
  codex: "responses",
  claude: "messages",
  pi: "pi-native",
};

/**
 * Map gateway upstreamKind to Eco apiCompat for PI bridge models.
 * @param {string} upstreamKind
 */
export function upstreamKindToApiCompat(upstreamKind) {
  switch (upstreamKind) {
    case "responses":
      return "openai_responses";
    case "anthropic-messages":
      return "anthropic";
    case "openai-chat":
      return "openai_chat_completions";
    default:
      throw new Error(`Unsupported upstreamKind: ${upstreamKind}`);
  }
}

/**
 * @param {string | undefined} clientArg
 * @returns {GatewayClientId[]}
 */
export function listClientIds(clientArg) {
  if (clientArg && clientArg !== "all") {
    if (!GATEWAY_CLIENTS.includes(clientArg)) {
      throw new Error(`Unknown client: ${clientArg}. Expected ${GATEWAY_CLIENTS.join(", ")} or all`);
    }
    return [clientArg];
  }
  return [...GATEWAY_CLIENTS];
}

/**
 * @param {string | undefined} profileArg
 * @param {{ requireApiKey?: boolean }} [options]
 * @returns {GatewayProfileId[]}
 */
export function listRecordableProfileIds(profileArg, options = {}) {
  const requireApiKey = options.requireApiKey !== false;
  const ids = profileArg && profileArg !== "all" ? [profileArg] : Object.keys(GATEWAY_HTTP_PROFILES);

  const out = [];
  for (const id of ids) {
    if (!GATEWAY_HTTP_PROFILES[id]) {
      throw new Error(`Unknown profile: ${id}`);
    }
    const profile = GATEWAY_HTTP_PROFILES[id];
    const apiKey = process.env[profile.apiKeyEnv]?.trim() || "";
    if (requireApiKey && !apiKey) {
      continue;
    }
    out.push(id);
  }
  return out;
}

/**
 * @param {GatewayClientId[]} clients
 * @param {GatewayProfileId[]} profiles
 */
export function buildRecordingCells(clients, profiles) {
  const clientSet = new Set(clients);
  const profileSet = new Set(profiles);
  return RECORDING_CELL_SPECS.filter(
    (spec) => clientSet.has(spec.client) && profileSet.has(spec.profileId),
  ).map((spec) => ({
    ...spec,
    scenarioId: FULL_ROUND_SCENARIO_ID,
  }));
}

/**
 * Cells in RECORDING_CELL_SPECS that were filtered out by client/profile flags.
 * @param {GatewayClientId[]} clients
 * @param {GatewayProfileId[]} profiles
 */
export function listSkippedRecordingCells(clients, profiles) {
  const clientSet = new Set(clients);
  const profileSet = new Set(profiles);
  return RECORDING_CELL_SPECS.filter(
    (spec) => !clientSet.has(spec.client) || !profileSet.has(spec.profileId),
  );
}
