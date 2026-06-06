import {
  computeRequestBilling,
  computeSavings,
  type ModelCostRates,
  type ModelPricingLookup,
  type ParsedUsage,
  type RequestBillingDelta,
} from "@eco/runtime";
import type {
  AgentRole,
  BillingUsageSource,
  ModelsDevMapping,
  RouteManualSpec,
} from "../shared/ipc";
import {
  buildPlannerModelLabel,
  resolvePublicModelId,
  resolveRatesForRoute,
  resolveUsageRoute,
  type ResolvedUsageRoute,
  type RuntimeRoute,
} from "./billing-resolver";
import type { UpstreamProxyCallBilling } from "./upstream-proxy-log";
import { buildUsageRequestKey } from "./thread-usage-accumulator";
import {
  buildSingleUsageLedgerEvent,
} from "./usage-ledger-adapters";
import type { UsageLedgerEvent } from "./usage-ledger";

export interface UsageBillingPricingRoute {
  provider: { baseUrl: string };
  modelId: string;
  modelsDevMapping?: ModelsDevMapping;
  manualSpec?: RouteManualSpec;
}

export type UsageBillingPricingLookup = (
  route: UsageBillingPricingRoute,
) => Promise<ModelPricingLookup | null>;

export interface UsageBillingContextUpdate {
  role: AgentRole;
  modelId: string;
  providerBaseUrl: string;
  modelsDevMapping?: ModelsDevMapping;
  manualSpec?: RouteManualSpec;
}

export interface SingleUsageBillingArtifacts {
  delta: ParsedUsage;
  source: BillingUsageSource;
  billingRole: AgentRole;
  requestKey: string;
  requestBilling: RequestBillingDelta;
  requestBillingLog: UpstreamProxyCallBilling;
  actualRates: ModelCostRates | null;
  plannerRates: ModelCostRates | null;
  ledgerEvent: UsageLedgerEvent;
  parsedUsage: ParsedUsage;
  plannerModelLabel?: string;
  resolvedModelId?: string;
  contextUpdate?: UsageBillingContextUpdate;
}

export interface ResolveSingleUsageBillingArtifactsInput {
  threadId: string;
  role: AgentRole;
  usage: ParsedUsage;
  runtimeRoutes: readonly RuntimeRoute[];
  lookupPricing: UsageBillingPricingLookup;
  source?: BillingUsageSource;
  otelCostUsd?: number;
  modelId?: string;
  messageId?: string;
  runAttemptId?: string;
  plannerAgentId?: string;
  agentId?: string;
  parentToolUseId?: string;
  requestKey?: string;
  sourceEventId?: string;
  providerRequestId?: string;
  otelDedupId?: string;
}

export async function resolveSingleUsageBillingArtifacts(
  input: ResolveSingleUsageBillingArtifactsInput,
): Promise<SingleUsageBillingArtifacts> {
  const usageRoute = resolveUsageRoute(input.role, input.modelId, input.runtimeRoutes);
  const plannerRoute = input.runtimeRoutes.find((route) => route.role === "planner");
  const actualLookup = usageRoute ? await input.lookupPricing(usageRoute) : null;
  const plannerLookup = plannerRoute ? await input.lookupPricing(plannerRoute) : null;
  const actualRates = resolveRatesForRoute(actualLookup, usageRoute?.manualSpec);
  const plannerRates = resolveRatesForRoute(plannerLookup, plannerRoute?.manualSpec);
  const requestKey =
    input.requestKey ??
    buildUsageRequestKey({
      role: input.role,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      cacheReadTokens: input.usage.cacheReadTokens,
      cacheCreationTokens: input.usage.cacheCreationTokens,
      ...(input.modelId && { modelId: input.modelId }),
      ...(input.otelDedupId && { dedupId: input.otelDedupId }),
    });

  const source = input.source ?? "otel";
  const resolvedModelId =
    resolvePublicModelId(input.role, input.modelId, input.runtimeRoutes) ?? input.modelId;
  const billingRole = usageRoute?.role ?? input.role;
  const requestBilling = computeRequestBilling(input.usage, actualRates, plannerRates);
  const { savedUsd } = computeSavings(
    requestBilling.plannerTokenCostUsd,
    requestBilling.ecoCostUsd,
  );
  const ledgerAgentId =
    input.agentId ??
    (billingRole === "planner" ? input.plannerAgentId : undefined);
  const parsedUsage: ParsedUsage = {
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cacheReadTokens: input.usage.cacheReadTokens,
    cacheCreationTokens: input.usage.cacheCreationTokens,
    ...(resolvedModelId && { modelId: resolvedModelId }),
  };
  const plannerModelLabel = buildPlannerModelLabel(
    plannerRoute,
    plannerLookup?.displayName ?? plannerRoute?.modelId,
  );
  const contextUpdate = resolveSingleUsageContextUpdate({
    billingRole,
    runtimeRoutes: input.runtimeRoutes,
    ...(resolvedModelId && { resolvedModelId }),
    ...(usageRoute && { usageRoute }),
    ...(plannerRoute && { plannerRoute }),
  });

  return {
    delta: input.usage,
    source,
    billingRole,
    requestKey,
    requestBilling,
    requestBillingLog: {
      ecoCostUsd: requestBilling.ecoCostUsd,
      plannerTokenCostUsd: requestBilling.plannerTokenCostUsd,
      savedUsd,
      otelCostUsd: input.otelCostUsd ?? 0,
    },
    actualRates,
    plannerRates,
    ledgerEvent: buildSingleUsageLedgerEvent({
      threadId: input.threadId,
      role: billingRole,
      source,
      sourceEventId: input.sourceEventId ?? requestKey,
      usageKind: source === "sdk" && input.messageId ? "assistant_fallback" : "request_final",
      usage: input.usage,
      computedBilling: requestBilling,
      requestKey,
      ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
      ...(ledgerAgentId && { agentId: ledgerAgentId }),
      ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
      ...(input.providerRequestId && { providerRequestId: input.providerRequestId }),
      ...(input.messageId && { sdkMessageId: input.messageId }),
      ...(resolvedModelId && { modelId: resolvedModelId }),
      ...(input.otelCostUsd !== undefined && { reportedCostUsd: input.otelCostUsd }),
      metadata: {
        path: "processUsageBilling",
        ...(input.otelDedupId && { otelDedupId: input.otelDedupId }),
      },
    }),
    parsedUsage,
    ...(plannerModelLabel && { plannerModelLabel }),
    ...(resolvedModelId && { resolvedModelId }),
    ...(contextUpdate && { contextUpdate }),
  };
}

export interface SdkStreamPartialBillingArtifacts {
  ledgerEvent: UsageLedgerEvent;
  resolvedModelId?: string;
  contextUpdate?: UsageBillingContextUpdate;
}

export interface ResolveSdkStreamPartialBillingArtifactsInput {
  threadId: string;
  eventId: string;
  role: AgentRole;
  usage: ParsedUsage;
  runtimeRoutes: readonly RuntimeRoute[];
  lookupPricing: UsageBillingPricingLookup;
  modelId?: string;
  runAttemptId?: string;
  plannerAgentId?: string;
  subagentAgentId?: string;
  parentToolUseId?: string;
}

export async function resolveSdkStreamPartialBillingArtifacts(
  input: ResolveSdkStreamPartialBillingArtifactsInput,
): Promise<SdkStreamPartialBillingArtifacts> {
  const usageRoute = resolveUsageRoute(input.role, input.modelId, input.runtimeRoutes);
  const plannerRoute = input.runtimeRoutes.find((route) => route.role === "planner");
  const actualLookup = usageRoute ? await input.lookupPricing(usageRoute) : null;
  const plannerLookup = plannerRoute ? await input.lookupPricing(plannerRoute) : null;
  const actualRates = resolveRatesForRoute(actualLookup, usageRoute?.manualSpec);
  const plannerRates = resolveRatesForRoute(plannerLookup, plannerRoute?.manualSpec);
  const computedBilling = computeRequestBilling(input.usage, actualRates, plannerRates);
  const resolvedModelId = usageRoute?.modelId ?? input.modelId;
  const ledgerAgentId =
    input.subagentAgentId ??
    (input.role === "planner" ? input.plannerAgentId : undefined);
  const requestKey = `sdk-stream:${input.eventId}`;
  const contextUpdate = usageRoute
    ? contextUpdateFromRoute(input.role, usageRoute)
    : undefined;

  return {
    ledgerEvent: buildSingleUsageLedgerEvent({
      threadId: input.threadId,
      role: usageRoute?.role ?? input.role,
      source: "sdk",
      sourceEventId: requestKey,
      usageKind: "request_partial",
      usage: input.usage,
      computedBilling,
      requestKey,
      ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
      ...(ledgerAgentId && { agentId: ledgerAgentId }),
      ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
      ...(resolvedModelId && { modelId: resolvedModelId }),
      metadata: {
        path: "processSdkStreamPartialUsage",
        settlement: "partial",
      },
    }),
    ...(resolvedModelId && { resolvedModelId }),
    ...(contextUpdate && { contextUpdate }),
  };
}

export interface SdkRunUsageInputModel {
  modelId: string;
  usage: ParsedUsage;
  sdkCostUsd?: number;
}

export interface ResolvedSdkRunBillingModel {
  role?: AgentRole;
  modelId: string;
  usage: ParsedUsage;
  actualRates: ModelCostRates | null;
  plannerRates: ModelCostRates | null;
  sdkCostUsd?: number;
  computedBilling: RequestBillingDelta;
}

export interface SdkRunBillingModels {
  models: ResolvedSdkRunBillingModel[];
  plannerRates: ModelCostRates | null;
  plannerModelLabel?: string;
}

export interface ResolveSdkRunBillingModelsInput {
  role: AgentRole;
  models: readonly SdkRunUsageInputModel[];
  runtimeRoutes: readonly RuntimeRoute[];
  lookupPricing: UsageBillingPricingLookup;
}

export async function resolveSdkRunBillingModels(
  input: ResolveSdkRunBillingModelsInput,
): Promise<SdkRunBillingModels> {
  const plannerRoute = input.runtimeRoutes.find((route) => route.role === "planner");
  const plannerLookup = plannerRoute ? await input.lookupPricing(plannerRoute) : null;
  const plannerRates = resolveRatesForRoute(plannerLookup, plannerRoute?.manualSpec);
  const models = await Promise.all(
    input.models.map(async (entry) => {
      const usageRoute = resolveUsageRoute(input.role, entry.modelId, input.runtimeRoutes);
      const billingRole = usageRoute?.role ?? input.role;
      const actualLookup = usageRoute ? await input.lookupPricing(usageRoute) : null;
      const actualRates = resolveRatesForRoute(actualLookup, usageRoute?.manualSpec);
      const computedBilling = computeRequestBilling(entry.usage, actualRates, plannerRates);
      return {
        role: billingRole,
        modelId: usageRoute?.modelId ?? entry.modelId,
        usage: entry.usage,
        actualRates,
        plannerRates,
        computedBilling,
        ...(entry.sdkCostUsd !== undefined && { sdkCostUsd: entry.sdkCostUsd }),
      };
    }),
  );
  const plannerModelLabel = buildPlannerModelLabel(
    plannerRoute,
    plannerLookup?.displayName ?? plannerRoute?.modelId,
  );
  return {
    models,
    plannerRates,
    ...(plannerModelLabel && { plannerModelLabel }),
  };
}

function resolveSingleUsageContextUpdate(input: {
  billingRole: AgentRole;
  resolvedModelId?: string;
  runtimeRoutes: readonly RuntimeRoute[];
  usageRoute?: ResolvedUsageRoute;
  plannerRoute?: RuntimeRoute;
}): UsageBillingContextUpdate | undefined {
  const monitorModelId =
    input.usageRoute?.modelId ?? input.plannerRoute?.modelId ?? input.resolvedModelId;
  const monitorBaseUrl = input.usageRoute?.provider.baseUrl ?? input.plannerRoute?.provider.baseUrl;
  const monitorRoute = resolveUsageRoute(input.billingRole, input.resolvedModelId, input.runtimeRoutes);
  const modelId = monitorRoute?.modelId ?? monitorModelId;
  const providerBaseUrl = monitorRoute?.provider.baseUrl ?? monitorBaseUrl;
  if (!modelId || !providerBaseUrl) {
    return undefined;
  }
  return {
    role: input.billingRole,
    modelId,
    providerBaseUrl,
    ...(monitorRoute?.modelsDevMapping && { modelsDevMapping: monitorRoute.modelsDevMapping }),
    ...(monitorRoute?.manualSpec && { manualSpec: monitorRoute.manualSpec }),
  };
}

function contextUpdateFromRoute(
  role: AgentRole,
  route: ResolvedUsageRoute,
): UsageBillingContextUpdate {
  return {
    role,
    modelId: route.modelId,
    providerBaseUrl: route.provider.baseUrl,
    ...(route.modelsDevMapping && { modelsDevMapping: route.modelsDevMapping }),
    ...(route.manualSpec && { manualSpec: route.manualSpec }),
  };
}
