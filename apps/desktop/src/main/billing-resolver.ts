import {
  formatModelPricingLabel,
  unresolvedModelCapabilities,
  type ModelCostRates,
} from "@eco/runtime";
import { createModelAlias, resolveProxyRoute, type AnthropicProxyResolvedRoute } from "./anthropic-proxy";
import type { ProviderConfigSecret } from "./provider-store";
import type {
  AgentRole,
  ModelSettingsSnapshot,
  RouteCapabilityHint,
  RoutePricingHint,
  ThinkingEffort,
} from "../shared/ipc";
import type { ModelsDevPricingCache } from "./models-dev-pricing-cache";

export interface RuntimeRoute {
  role: AgentRole;
  provider: ProviderConfigSecret;
  modelId: string;
  thinkingEffort?: ThinkingEffort;
}

export interface ResolvedUsageRoute {
  role: AgentRole;
  provider: ProviderConfigSecret;
  modelId: string;
}

export function buildResolvedProxyRoutes(routes: readonly RuntimeRoute[]): AnthropicProxyResolvedRoute[] {
  return routes.map((route) => ({
    role: route.role,
    provider: route.provider,
    modelId: route.modelId,
    aliasModelId: createModelAlias(route.role, route.provider.id, route.modelId),
    ...(route.thinkingEffort && { thinkingEffort: route.thinkingEffort }),
  }));
}

export function resolveUsageRoute(
  role: AgentRole,
  requestedModel: string | undefined,
  routes: readonly RuntimeRoute[],
): ResolvedUsageRoute | undefined {
  const resolved = buildResolvedProxyRoutes(routes);
  if (requestedModel?.trim()) {
    const byModel = resolveProxyRoute(resolved, requestedModel.trim());
    if (byModel) {
      return {
        role: byModel.role,
        provider: byModel.provider,
        modelId: byModel.modelId,
      };
    }
  }

  return routes.find((route) => route.role === role);
}

export async function lookupRatesForRoute(
  cache: ModelsDevPricingCache,
  route: ResolvedUsageRoute | undefined,
): Promise<ModelCostRates | null> {
  if (!route) {
    return null;
  }
  const lookup = await cache.lookup(route.provider.baseUrl, route.modelId);
  return lookup?.rates ?? null;
}

export function buildPlannerModelLabel(
  route: ResolvedUsageRoute | undefined,
  displayName?: string,
): string | undefined {
  if (!route) {
    return undefined;
  }
  const model = displayName ?? route.modelId;
  return `${model} · ${route.provider.name}`;
}

export function resolveRuntimeRoutesFromSettings(
  settings: ModelSettingsSnapshot,
  providers: readonly ProviderConfigSecret[],
): RuntimeRoute[] {
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  return settings.routes.flatMap((route) => {
    const provider = providersById.get(route.providerId);
    if (!provider) {
      return [];
    }
    return [
      {
        role: route.role,
        provider,
        modelId: route.modelId,
        ...(route.thinkingEffort && { thinkingEffort: route.thinkingEffort }),
      },
    ];
  });
}

export async function lookupRouteCapabilityHints(
  cache: ModelsDevPricingCache,
  settings: ModelSettingsSnapshot,
  providers: readonly ProviderConfigSecret[],
): Promise<RouteCapabilityHint[]> {
  const routes = resolveRuntimeRoutesFromSettings(settings, providers);
  const hints: RouteCapabilityHint[] = [];

  for (const route of routes) {
    const lookup = await cache.lookupCapabilities(route.provider.baseUrl, route.modelId);
    const capabilities = lookup?.capabilities ?? unresolvedModelCapabilities();
    hints.push({
      role: route.role,
      modelId: route.modelId,
      providerName: route.provider.name,
      supportsImageInput: capabilities.supportsImageInput,
      supportsReasoning: capabilities.supportsReasoning,
      capabilitiesResolved: capabilities.capabilitiesResolved,
    });
  }

  return hints;
}

export async function lookupRoutePricingHints(
  cache: ModelsDevPricingCache,
  settings: ModelSettingsSnapshot,
  providers: readonly ProviderConfigSecret[],
): Promise<RoutePricingHint[]> {
  const routes = resolveRuntimeRoutesFromSettings(settings, providers);
  const hints: RoutePricingHint[] = [];

  for (const route of routes) {
    const lookup = await cache.lookup(route.provider.baseUrl, route.modelId);
    hints.push({
      role: route.role,
      modelId: route.modelId,
      providerName: route.provider.name,
      ...(lookup && {
        pricingLabel: formatModelPricingLabel(lookup),
      }),
      pricingResolved: Boolean(lookup),
    });
  }

  return hints;
}
