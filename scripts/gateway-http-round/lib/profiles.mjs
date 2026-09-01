/**
 * Gateway HTTP round recording profiles.
 * Secrets are read from env at runtime — never hardcode keys in repo.
 */
export const GATEWAY_HTTP_PROFILES = {
  packy_responses: {
    id: "packy_responses",
    label: "Luna OpenAI Responses (Pomener)",
    upstreamKind: "responses",
    baseUrl: "https://gpt.pomener.ru",
    apiKeyEnv: "GATEWAY_RECORD_RESPONSES_KEY",
    model: "gpt-5.6-luna",
    gatewayFace: "/v1/responses",
    clientAuthHeader: "authorization",
    upstreamAuthHeader: "authorization",
    upstreamAuthPrefix: "Bearer ",
    extraUpstreamHeaders: {
      "openai-beta": "responses=v1",
    },
  },
  packy_anthropic: {
    id: "packy_anthropic",
    label: "Packy Anthropic Messages",
    upstreamKind: "anthropic-messages",
    baseUrl: "https://www.packyapi.ai",
    apiKeyEnv: "GATEWAY_RECORD_PACKY_ANTHROPIC_KEY",
    model: "claude-sonnet-5",
    gatewayFace: "/v1/messages",
    clientAuthHeader: "x-api-key",
    upstreamAuthHeader: "x-api-key",
    extraUpstreamHeaders: {
      "anthropic-version": "2023-06-01",
    },
  },
  longcat_chat: {
    id: "longcat_chat",
    label: "LongCat OpenAI Chat Completions",
    upstreamKind: "openai-chat",
    baseUrl: "https://api.longcat.chat/openai",
    apiKeyEnv: "GATEWAY_RECORD_LONGCAT_CHAT_KEY",
    model: "LongCat-2.0",
    gatewayFace: "/v1/chat/completions",
    clientAuthHeader: "authorization",
    upstreamAuthHeader: "authorization",
    upstreamAuthPrefix: "Bearer ",
  },
  longcat_responses: {
    id: "longcat_responses",
    label: "LongCat OpenAI Responses",
    upstreamKind: "responses",
    baseUrl: "https://api.longcat.chat/openai",
    apiKeyEnv: "GATEWAY_RECORD_LONGCAT_CHAT_KEY",
    model: "LongCat-2.0",
    gatewayFace: "/v1/responses",
    clientAuthHeader: "authorization",
    upstreamAuthHeader: "authorization",
    upstreamAuthPrefix: "Bearer ",
    extraUpstreamHeaders: {
      "openai-beta": "responses=v1",
    },
  },
};

export function resolveProfile(profileId) {
  const profile = GATEWAY_HTTP_PROFILES[profileId];
  if (!profile) {
    throw new Error(`Unknown profile: ${profileId}`);
  }
  const apiKey =
    process.env[profile.apiKeyEnv]?.trim() ||
    (profile.id === "packy_responses"
      ? process.env.GATEWAY_RECORD_PACKY_RESPONSES_KEY?.trim()
      : "") ||
    "";
  if (!apiKey) {
    throw new Error(`Missing env ${profile.apiKeyEnv} for profile ${profileId}`);
  }
  return { ...profile, apiKey };
}

export function listProfileIds(arg) {
  if (arg && arg !== "all") {
    return [arg];
  }
  return Object.keys(GATEWAY_HTTP_PROFILES);
}
