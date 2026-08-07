import { normalizeRequestPath, normalizeApiVersion } from "./provider-router.js";
import type { GatewayConfig, GatewayProvider } from "./types.js";

const DEFAULT_PORT = 18_765;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseProvidersFromEnv(): GatewayProvider[] | null {
  const raw = process.env.ECO_GATEWAY_PROVIDERS?.trim();
  if (!raw) {
    return null;
  }
  const parsed = JSON.parse(raw) as GatewayProvider[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("ECO_GATEWAY_PROVIDERS must be a non-empty JSON array");
  }
  return parsed.map(normalizeProvider);
}

export function normalizeProvider(provider: GatewayProvider): GatewayProvider {
  if (!provider.id?.trim()) {
    throw new Error("Gateway provider id is required");
  }
  if (!provider.baseUrl?.trim()) {
    throw new Error(`Gateway provider ${provider.id}: baseUrl is required`);
  }
  if (!provider.upstreamModelId?.trim()) {
    throw new Error(`Gateway provider ${provider.id}: upstreamModelId is required`);
  }
  const models = provider.models?.length
    ? provider.models
    : [provider.upstreamModelId];
  const modelMaxOutputTokens = normalizeModelMaxOutputTokens(provider.modelMaxOutputTokens);
  const requestPath = normalizeRequestPath(provider.requestPath);
  const version = normalizeApiVersion(provider.version);
  return {
    ...provider,
    baseUrl: trimTrailingSlash(provider.baseUrl),
    requestPath: requestPath || undefined,
    version,
    models,
    ...(modelMaxOutputTokens ? { modelMaxOutputTokens } : {}),
  };
}

function normalizeModelMaxOutputTokens(
  value: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!value) {
    return undefined;
  }
  const normalized: Record<string, number> = {};
  for (const [modelId, tokens] of Object.entries(value)) {
    const trimmedModelId = modelId.trim();
    if (!trimmedModelId || !Number.isFinite(tokens) || tokens <= 0) {
      continue;
    }
    normalized[trimmedModelId] = Math.floor(tokens);
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/** Phase 0 static table used when ECO_GATEWAY_PROVIDERS is unset (tests / local dev). */
export function defaultProviders(): GatewayProvider[] {
  return [
    {
      id: "anthropic",
      name: "Anthropic (fixture)",
      upstreamKind: "anthropic-messages",
      baseUrl: "https://api.anthropic.com",
      apiKey: "fixture-key",
      upstreamModelId: "claude-sonnet-4-20250514",
      models: ["claude-sonnet-4-20250514"],
    },
    {
      id: "openai",
      name: "OpenAI Responses (fixture)",
      upstreamKind: "responses",
      baseUrl: "https://api.openai.com",
      apiKey: "fixture-key",
      upstreamModelId: "gpt-4.1",
      models: ["gpt-4.1"],
    },
  ];
}

export function loadGatewayConfig(): GatewayConfig {
  const host = process.env.ECO_GATEWAY_HOST?.trim() || "127.0.0.1";
  const port = Number.parseInt(process.env.ECO_GATEWAY_PORT ?? String(DEFAULT_PORT), 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid ECO_GATEWAY_PORT: ${process.env.ECO_GATEWAY_PORT}`);
  }

  const providers = parseProvidersFromEnv() ?? defaultProviders();
  const proxyRaw = process.env.ECO_GATEWAY_PROXY_URL?.trim();
  return {
    host,
    port,
    providers,
    ...(proxyRaw ? { upstreamProxyUrl: proxyRaw } : {}),
  };
}
