import {
  buildModelPricingSummary,
  formatModelPricingLabel,
  unresolvedModelCapabilities,
  type ModelCostRates,
  type ModelPricingLookup,
} from "@eco/runtime";
import { createModelAlias, resolveProxyRoute, type AnthropicProxyResolvedRoute } from "./anthropic-proxy";
import type { ProviderConfigSecret } from "./provider-store";
import { resolveUpstreamApiCompat } from "../shared/api-compat";
import {
  type AgentRole,
  type ModelSettingsSnapshot,
  type ModelsDevMapping,
  type RoleRouteConfig,
  type UpstreamApiCompat,
  type RouteCapabilityHint,
  type RouteManualSpec,
  type RoutePricingHint,
  type ThinkingEffort,
} from "../shared/ipc";
import type { ModelsDevPricingCache } from "./models-dev-pricing-cache";

export interface RuntimeRoute {
  role: AgentRole;
  provider: ProviderConfigSecret;
  modelId: string;
  apiCompat: UpstreamApiCompat;
  thinkingEffort?: ThinkingEffort;
  modelsDevMapping?: ModelsDevMapping;
  manualSpec?: RouteManualSpec;
}

export interface ResolvedUsageRoute {
  role: AgentRole;
  provider: ProviderConfigSecret;
  modelId: string;
  modelsDevMapping?: ModelsDevMapping;
  manualSpec?: RouteManualSpec;
}

export function manualSpecToRates(spec?: RouteManualSpec): ModelCostRates | null {
  if (spec?.inputPerM === undefined || spec.outputPerM === undefined) {
    return null;
  }
  return {
    input: spec.inputPerM,
    output: spec.outputPerM,
    ...(spec.cacheReadPerM !== undefined && { cacheRead: spec.cacheReadPerM }),
    ...(spec.cacheWritePerM !== undefined && { cacheWrite: spec.cacheWritePerM }),
  };
}

export function resolveRatesForRoute(
  lookup: ModelPricingLookup | null,
  manualSpec?: RouteManualSpec,
): ModelCostRates | null {
  return lookup?.rates ?? manualSpecToRates(manualSpec);
}

export function formatManualPricingLabel(spec: RouteManualSpec): string {
  const parts: string[] = [];
  if (spec.inputPerM !== undefined && spec.outputPerM !== undefined) {
    parts.push(`输入 $${spec.inputPerM}/M · 输出 $${spec.outputPerM}/M`);
  }
  if (spec.cacheReadPerM !== undefined) {
    parts.push(`缓存读 $${spec.cacheReadPerM}/M`);
  }
  if (spec.cacheWritePerM !== undefined) {
    parts.push(`缓存写 $${spec.cacheWritePerM}/M`);
  }
  return parts.length > 0 ? `手动单价：${parts.join(" · ")}` : "手动单价";
}

export function buildResolvedProxyRoutes(routes: readonly RuntimeRoute[]): AnthropicProxyResolvedRoute[] {
  return routes.map((route) => ({
    role: route.role,
    provider: route.provider,
    modelId: route.modelId,
    apiCompat: route.apiCompat,
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
  const toResolved = (route: RuntimeRoute): ResolvedUsageRoute => ({
    role: route.role,
    provider: route.provider,
    modelId: route.modelId,
    ...(route.modelsDevMapping && { modelsDevMapping: route.modelsDevMapping }),
    ...(route.manualSpec && { manualSpec: route.manualSpec }),
  });
  const fromProxyRoute = (route: AnthropicProxyResolvedRoute): ResolvedUsageRoute => {
    const runtimeRoute = routes.find(
      (entry) =>
        entry.role === route.role &&
        entry.provider.id === route.provider.id &&
        entry.modelId === route.modelId,
    );
    return runtimeRoute
      ? toResolved(runtimeRoute)
      : {
          role: route.role,
          provider: route.provider,
          modelId: route.modelId,
        };
  };

  if (!requestedModel?.trim()) {
    return roleRoute ? toResolved(roleRoute) : undefined;
  }

  const trimmed = requestedModel.trim();

  const byAlias = resolved.find((route) => route.aliasModelId === trimmed);
  if (byAlias) {
    return fromProxyRoute(byAlias);
  }

  const byModelId = routes.filter((route) => route.modelId === trimmed);
  if (byModelId.length === 1) {
    const route = byModelId[0]!;
    if (roleRoute && route.role !== role) {
      const plannerRoute = routes.find((entry) => entry.role === "planner");
      // SDK/OTel often reports the planner upstream id for subagent calls — prefer the billing role's route.
      if (plannerRoute && route.modelId === plannerRoute.modelId && role !== "planner") {
        return toResolved(roleRoute);
      }
      // Unique upstream id identifies a specific role (e.g. explore haiku when billing role wrongly says planner).
      return toResolved(route);
    }
    return toResolved(route);
  }

  // SDK/OTel often reports the planner upstream id for every role; prefer this role's route.
  if (byModelId.length > 1 && roleRoute) {
    const roleMatch = byModelId.find((route) => route.role === role);
    if (roleMatch) {
      return toResolved(roleMatch);
    }
    return toResolved(roleRoute);
  }

  if (roleRoute) {
    return toResolved(roleRoute);
  }

  const byModel = resolveProxyRoute(resolved, trimmed);
  if (byModel) {
    return fromProxyRoute(byModel);
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
  const lookup = await cache.lookupForRoute({
    baseUrl: route.provider.baseUrl,
    modelId: route.modelId,
    ...(route.modelsDevMapping && { mapping: route.modelsDevMapping }),
  });
  return resolveRatesForRoute(lookup, route.manualSpec);
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
  const sourceRoutes = routesOverride ?? [];
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
        apiCompat: resolveUpstreamApiCompat(route.apiCompat, provider.apiCompat),
        ...(route.thinkingEffort && { thinkingEffort: route.thinkingEffort }),
        ...(route.modelsDevMapping && { modelsDevMapping: route.modelsDevMapping }),
        ...(route.manualSpec && { manualSpec: route.manualSpec }),
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

function manualContextTokens(spec?: RouteManualSpec): number | undefined {
  const tokens = spec?.contextTokens;
  return tokens !== undefined && tokens > 0 ? tokens : undefined;
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
    const manualContext = manualContextTokens(route.manualSpec);
    hints.push({
      role: route.role,
      modelId: route.modelId,
      providerName: route.provider.name,
      supportsImageInput: capabilities.supportsImageInput,
      supportsReasoning: capabilities.supportsReasoning,
      capabilitiesResolved: capabilities.capabilitiesResolved || Boolean(manualContext),
      ...(limitsLookup
        ? {
            contextTokens: limitsLookup.limits.contextTokens,
            ...(limitsLookup.limits.maxOutputTokens !== undefined && {
              maxOutputTokens: limitsLookup.limits.maxOutputTokens,
            }),
          }
        : manualContext !== undefined && { contextTokens: manualContext }),
      contextLimitResolved: Boolean(limitsLookup) || manualContext !== undefined,
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
    const manualRates = manualSpecToRates(route.manualSpec);
    const manualSummary =
      manualRates && route.manualSpec
        ? {
            inputPerM: manualRates.input,
            outputPerM: manualRates.output,
            ...(manualRates.cacheRead !== undefined && { cacheReadPerM: manualRates.cacheRead }),
            ...(manualRates.cacheWrite !== undefined && { cacheWritePerM: manualRates.cacheWrite }),
          }
        : null;
    hints.push({
      role: route.role,
      modelId: route.modelId,
      providerName: route.provider.name,
      ...(summary
        ? {
            rates: {
              inputPerM: summary.inputPerM,
              outputPerM: summary.outputPerM,
              ...(summary.cacheReadPerM !== undefined && { cacheReadPerM: summary.cacheReadPerM }),
              ...(summary.cacheWritePerM !== undefined && { cacheWritePerM: summary.cacheWritePerM }),
            },
            pricingLabel: formatModelPricingLabel(lookup!),
          }
        : manualSummary && {
            rates: manualSummary,
            pricingLabel: formatManualPricingLabel(route.manualSpec!),
          }),
      pricingResolved: Boolean(lookup) || Boolean(manualSummary),
      ...(route.modelsDevMapping && {
        modelsDevMapping: route.modelsDevMapping,
        modelsDevLabel: formatModelsDevLabel(route.modelsDevMapping, lookup?.displayName),
      }),
    });
  }

  return hints;
}
