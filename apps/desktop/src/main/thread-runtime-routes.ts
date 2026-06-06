import type { ResolvedModelRoute } from "@eco/model-router";
import { resolveUpstreamApiCompat } from "../shared/api-compat";
import { AGENT_ROLES, type ModelSettingsSnapshot, type RoleRouteConfig } from "../shared/ipc";
import type { AnthropicProxyResolvedRoute } from "./anthropic-proxy";
import type { RuntimeRoute } from "./billing-resolver";
import type { ProviderConfigSecret } from "./provider-store";

export interface RuntimeConfig {
  routes: RuntimeRoute[];
}

export type RuntimeConfigResolution = { ok: true; routes: RuntimeRoute[] } | { ok: false; reason: string };

export function resolveThreadRuntimeConfig(
  _settings: ModelSettingsSnapshot,
  providersWithSecrets: readonly ProviderConfigSecret[],
  routesOverride?: readonly RoleRouteConfig[],
): RuntimeConfigResolution {
  const providersById = new Map(providersWithSecrets.map((provider) => [provider.id, provider]));
  const activeRoutes = routesOverride ?? [];
  const routes = activeRoutes.map((route): RuntimeRoute | undefined => {
    const provider = providersById.get(route.providerId);
    if (!provider) return undefined;
    return {
      role: route.role,
      provider,
      modelId: route.modelId,
      apiCompat: resolveUpstreamApiCompat(route.apiCompat, provider.apiCompat),
      ...(route.thinkingEffort && { thinkingEffort: route.thinkingEffort }),
      ...(route.modelsDevMapping && { modelsDevMapping: route.modelsDevMapping }),
      ...(route.manualSpec && { manualSpec: route.manualSpec }),
    };
  });

  const missingRoute = activeRoutes.find((route) => !providersById.has(route.providerId));
  if (missingRoute) {
    return { ok: false, reason: `Route ${missingRoute.role} references a missing provider.` };
  }

  for (const role of AGENT_ROLES) {
    const route = routes.find((candidate): candidate is RuntimeRoute => candidate?.role === role);
    if (!route) {
      return { ok: false, reason: `Configure a ${role} route before starting a coding thread.` };
    }
    if (!route.modelId.trim()) {
      return { ok: false, reason: `Model id is required for ${role}.` };
    }
    if (!route.provider.enabled) {
      return { ok: false, reason: `Provider "${route.provider.name}" for ${role} is disabled.` };
    }
  }

  return {
    ok: true,
    routes: routes.filter((route): route is RuntimeRoute => Boolean(route)),
  };
}

export function roleRoutesFromRuntime(routes: readonly RuntimeRoute[]): RoleRouteConfig[] {
  return routes.map((route) => ({
    role: route.role,
    providerId: route.provider.id,
    modelId: route.modelId,
    apiCompat: route.apiCompat,
    ...(route.thinkingEffort && { thinkingEffort: route.thinkingEffort }),
    ...(route.modelsDevMapping && { modelsDevMapping: route.modelsDevMapping }),
    ...(route.manualSpec && { manualSpec: route.manualSpec }),
  }));
}

export function buildDriverRoutes(routes: readonly AnthropicProxyResolvedRoute[]): ResolvedModelRoute[] {
  return routes.map((route) => ({
    role: route.role,
    primary: {
      id: `${route.role}:${route.provider.id}`,
      provider: "custom",
      displayName: `${route.provider.name} / ${route.modelId}`,
      baseUrl: route.provider.baseUrl,
      // Role-specific alias lets the local proxy attribute shared upstream models to the right context window.
      modelId: route.aliasModelId,
      capabilities: ["messages_api", "streaming", "tool_use", "subagent_compatible"],
      enabled: route.provider.enabled,
    },
    fallbacks: [],
    ...(route.thinkingEffort && { thinkingEffort: route.thinkingEffort }),
  }));
}

export function buildDriverRoutesFromRuntime(routes: readonly RuntimeRoute[]): ResolvedModelRoute[] {
  return routes.map((route) => ({
    role: route.role,
    primary: {
      id: `${route.role}:${route.provider.id}`,
      provider: "custom",
      displayName: `${route.provider.name} / ${route.modelId}`,
      baseUrl: route.provider.baseUrl,
      modelId: route.modelId,
      capabilities: ["messages_api", "streaming", "tool_use", "subagent_compatible"],
      enabled: route.provider.enabled,
    },
    fallbacks: [],
    ...(route.thinkingEffort && { thinkingEffort: route.thinkingEffort }),
  }));
}
