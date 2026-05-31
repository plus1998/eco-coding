import {
  buildModelPricingSummary,
  formatModelPricingLabel,
  unresolvedModelCapabilities,
  type ModelCostRates,
} from "@eco/runtime";
import { createModelAlias, resolveProxyRoute, type AnthropicProxyResolvedRoute } from "./anthropic-proxy";
import type { ProviderConfigSecret } from "./provider-store";
import {
  getActiveRoutes,
  type AgentRole,
  type ModelSettingsSnapshot,
  type ModelsDevMapping,
  type RoleRouteConfig,
  type RouteCapabilityHint,
  type RoutePricingHint,
  type ThinkingEffort,
} from "../shared/ipc";
import type { ModelsDevPricingCache } from "./models-dev-pricing-cache";

export interface RuntimeRoute {
  role: AgentRole;
  provider: ProviderConfigSecret;
  modelId: string;
  thinkingEffort?: ThinkingEffort;
  modelsDevMapping?: ModelsDevMapping;
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
  const roleRoute = routes.find((route) => route.role === role);

  if (!requestedModel?.trim()) {
    return roleRoute;
  }

  const trimmed = requestedModel.trim();

  const byAlias = resolved.find((route) => route.aliasModelId === trimmed);
  if (byAlias) {
    return {
      role: byAlias.role,
      provider: byAlias.provider,
      modelId: byAlias.modelId,
    };
  }

  const byModelId = resolved.filter((route) => route.modelId === trimmed);
  if (byModelId.length === 1) {
    const route = byModelId[0]!;
    if (roleRoute && route.role !== role) {
      const plannerRoute = routes.find((entry) => entry.role === "planner");
      // SDK/OTel often reports the planner upstream id for subagent calls — prefer the billing role's route.
      if (plannerRoute && route.modelId === plannerRoute.modelId && role !== "planner") {
        return {
          role: roleRoute.role,
          provider: roleRoute.provider,
          modelId: roleRoute.modelId,
        };
      }
      // Unique upstream id identifies a specific role (e.g. explore haiku when billing role wrongly says planner).
      return {
        role: route.role,
        provider: route.provider,
        modelId: route.modelId,
      };
    }
    return {
      role: route.role,
      provider: route.provider,
      modelId: route.modelId,
    };
  }

  // SDK/OTel often reports the planner upstream id for every role; prefer this role's route.
  if (byModelId.length > 1 && roleRoute) {
    const roleMatch = byModelId.find((route) => route.role === role);
    if (roleMatch) {
      return {
        role: roleMatch.role,
        provider: roleMatch.provider,
        modelId: roleMatch.modelId,
      };
    }
    return {
      role: roleRoute.role,
      provider: roleRoute.provider,
      modelId: roleRoute.modelId,
    };
  }

  if (roleRoute) {
    return {
      role: roleRoute.role,
      provider: roleRoute.provider,
      modelId: roleRoute.modelId,
    };
  }

  const byModel = resolveProxyRoute(resolved, trimmed);
  if (byModel) {
    return {
      role: byModel.role,
      provider: byModel.provider,
      modelId: byModel.modelId,
    };
  }

  return undefined;
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
  routesOverride?: readonly RoleRouteConfig[],
): RuntimeRoute[] {
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  const sourceRoutes = routesOverride ?? getActiveRoutes(settings);
  return sourceRoutes.flatMap((route) => {
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
        ...(route.modelsDevMapping && { modelsDevMapping: route.modelsDevMapping }),
      },
    ];
  });
}

function formatModelsDevLabel(mapping: ModelsDevMapping, displayName?: string): string {
  if (displayName?.trim()) {
    return `${displayName.trim()} · ${mapping.providerKey}/${mapping.modelId}`;
  }
  return `${mapping.providerKey}/${mapping.modelId}`;
}

function resolvedMappingFromLookup(
  lookup?: { providerKey: string; modelId: string; displayName?: string } | null,
): { mapping: ModelsDevMapping; label: string } | undefined {
  if (!lookup) {
    return undefined;
  }
  const mapping = { providerKey: lookup.providerKey, modelId: lookup.modelId };
  return {
    mapping,
    label: formatModelsDevLabel(mapping, lookup.displayName),
  };
}

function routeLookupFromRuntime(route: RuntimeRoute) {
  return {
    baseUrl: route.provider.baseUrl,
    modelId: route.modelId,
    ...(route.modelsDevMapping && { mapping: route.modelsDevMapping }),
  };
}

export async function lookupRouteCapabilityHints(
  cache: ModelsDevPricingCache,
  settings: ModelSettingsSnapshot,
  providers: readonly ProviderConfigSecret[],
  routesOverride?: readonly RoleRouteConfig[],
): Promise<RouteCapabilityHint[]> {
  const routes = resolveRuntimeRoutesFromSettings(settings, providers, routesOverride);
  const hints: RouteCapabilityHint[] = [];

  for (const route of routes) {
    const routeLookup = routeLookupFromRuntime(route);
    const lookup = await cache.lookupCapabilitiesForRoute(routeLookup);
    const limitsLookup = await cache.lookupLimitsForRoute(routeLookup);
    const pricingLookup = await cache.lookupForRoute(routeLookup);
    const capabilities = lookup?.capabilities ?? unresolvedModelCapabilities();
    const resolved =
      resolvedMappingFromLookup(lookup) ??
      resolvedMappingFromLookup(limitsLookup) ??
      resolvedMappingFromLookup(pricingLookup);
    hints.push({
      role: route.role,
      modelId: route.modelId,
      providerName: route.provider.name,
      supportsImageInput: capabilities.supportsImageInput,
      supportsReasoning: capabilities.supportsReasoning,
      capabilitiesResolved: capabilities.capabilitiesResolved,
      ...(limitsLookup && {
        contextTokens: limitsLookup.limits.contextTokens,
        ...(limitsLookup.limits.maxOutputTokens !== undefined && {
          maxOutputTokens: limitsLookup.limits.maxOutputTokens,
        }),
      }),
      contextLimitResolved: Boolean(limitsLookup),
      ...(resolved && {
        resolvedModelsDevMapping: resolved.mapping,
        resolvedModelsDevLabel: resolved.label,
      }),
      ...(route.modelsDevMapping && {
        modelsDevMapping: route.modelsDevMapping,
        modelsDevLabel: formatModelsDevLabel(
          route.modelsDevMapping,
          lookup?.capabilities.displayName ?? limitsLookup?.displayName ?? pricingLookup?.displayName,
        ),
      }),
    });
  }

  return hints;
}

export async function lookupRoutePricingHints(
  cache: ModelsDevPricingCache,
  settings: ModelSettingsSnapshot,
  providers: readonly ProviderConfigSecret[],
  routesOverride?: readonly RoleRouteConfig[],
): Promise<RoutePricingHint[]> {
  const routes = resolveRuntimeRoutesFromSettings(settings, providers, routesOverride);
  const hints: RoutePricingHint[] = [];

  for (const route of routes) {
    const lookup = await cache.lookupForRoute(routeLookupFromRuntime(route));
    const summary = lookup ? buildModelPricingSummary(lookup) : null;
    hints.push({
      role: route.role,
      modelId: route.modelId,
      providerName: route.provider.name,
      ...(summary && {
        rates: {
          inputPerM: summary.inputPerM,
          outputPerM: summary.outputPerM,
          ...(summary.cacheReadPerM !== undefined && { cacheReadPerM: summary.cacheReadPerM }),
          ...(summary.cacheWritePerM !== undefined && { cacheWritePerM: summary.cacheWritePerM }),
        },
        pricingLabel: formatModelPricingLabel(lookup!),
      }),
      pricingResolved: Boolean(lookup),
      ...(route.modelsDevMapping && {
        modelsDevMapping: route.modelsDevMapping,
        modelsDevLabel: formatModelsDevLabel(route.modelsDevMapping, lookup?.displayName),
      }),
    });
  }

  return hints;
}
