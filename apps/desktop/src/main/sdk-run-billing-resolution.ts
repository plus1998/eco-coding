import { parseSdkContextUsage } from "@eco/runtime";
import type { AgentRole } from "../shared/ipc";
import {
  isSubagentBillingRole,
  shouldUpdateContextFromUsageSource,
  type UsageBillingObservation,
} from "./billing-orchestration";
import { resolveUsageRoute, type RuntimeRoute } from "./billing-resolver";
import {
  resolveSdkRunBillingAttribution,
  type SdkRunBillingAttributionResolver,
} from "./sdk-run-billing-attribution";
import type { SdkUsageBillingBundle } from "./sdk-event-usage-billing";
import type { ApplySdkRunBillingEffectsInput } from "./usage-billing-effects";
import {
  resolveSdkRunBillingModels,
  type SdkRunBillingModels,
  type UsageBillingContextUpdate,
  type UsageBillingPricingLookup,
  type WorkflowStepUsageMetadata,
} from "./usage-billing-artifacts";

export interface ResolveSdkRunBillingResolutionInput {
  threadId: string;
  role: AgentRole;
  requestKey: string;
  bundle: SdkUsageBillingBundle;
  runtimeRoutes: readonly RuntimeRoute[];
  lookupPricing: UsageBillingPricingLookup;
  resolver: SdkRunBillingAttributionResolver;
  usagePayload?: unknown;
  runAttemptId?: string;
  plannerAgentId?: string;
  subagentAgentId?: string;
  parentToolUseId?: string;
  workflowStep?: WorkflowStepUsageMetadata;
}

export interface SdkRunBillingResolution {
  billingModels: SdkRunBillingModels;
  billingRole: AgentRole;
  contextUsage: ApplySdkRunBillingEffectsInput["contextUsage"];
  observations: UsageBillingObservation[];
  effectsInput: ApplySdkRunBillingEffectsInput;
  contextUpdate?: UsageBillingContextUpdate;
  resolvedSubagentId?: string;
  ledgerAgentId?: string;
}

export async function resolveSdkRunBillingResolution(
  input: ResolveSdkRunBillingResolutionInput,
): Promise<SdkRunBillingResolution> {
  const billingModels = await resolveSdkRunBillingModels({
    role: input.role,
    models: input.bundle.models,
    runtimeRoutes: input.runtimeRoutes,
    lookupPricing: input.lookupPricing,
  });
  return resolveSdkRunBillingResolutionFromModels({
    ...input,
    billingModels,
  });
}

export function resolveSdkRunBillingResolutionFromModels(
  input: ResolveSdkRunBillingResolutionInput & { billingModels: SdkRunBillingModels },
): SdkRunBillingResolution {
  const { models } = input.billingModels;
  const primaryModel = models[0];
  const attribution = resolveSdkRunBillingAttribution({
    threadId: input.threadId,
    role: input.role,
    models,
    resolver: input.resolver,
    ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
    ...(input.subagentAgentId && { subagentAgentId: input.subagentAgentId }),
    ...(input.plannerAgentId && { plannerAgentId: input.plannerAgentId }),
  });
  const { billingRole, resolvedSubagentId, ledgerAgentId } = attribution;
  const observations = buildSdkRunUsageObservations({
    source: "sdk",
    billingRole,
    requestKey: input.requestKey,
    models,
    ...(resolvedSubagentId && { resolvedSubagentId }),
  });
  const contextUsage =
    resolvedSubagentId && primaryModel?.modelId && input.usagePayload
      ? (parseSdkContextUsage(input.usagePayload, { subagentModelId: primaryModel.modelId }) ??
        input.bundle.contextUsage)
      : input.bundle.contextUsage;
  const contextUpdate = resolveSdkRunContextUpdate({
    billingRole,
    runtimeRoutes: input.runtimeRoutes,
    ...(primaryModel?.modelId && { primaryModelId: primaryModel.modelId }),
  });
  const effectsInput: ApplySdkRunBillingEffectsInput = {
    threadId: input.threadId,
    role: input.role,
    requestKey: input.requestKey,
    models,
    billingRole,
    contextUsage,
    updateContext: Boolean(contextUpdate),
    ...(input.bundle.totalCostUsd !== undefined && { totalCostUsd: input.bundle.totalCostUsd }),
    ...(input.billingModels.plannerModelLabel && {
      plannerModelLabel: input.billingModels.plannerModelLabel,
    }),
    ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
    ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
    ...(input.workflowStep && { workflowStep: input.workflowStep }),
    ...(ledgerAgentId && { ledgerAgentId }),
    ...(resolvedSubagentId && { resolvedSubagentId }),
    ...(contextUpdate && { contextUpdate }),
  };

  return {
    billingModels: input.billingModels,
    billingRole,
    contextUsage,
    observations,
    effectsInput,
    ...(contextUpdate && { contextUpdate }),
    ...(resolvedSubagentId && { resolvedSubagentId }),
    ...(ledgerAgentId && { ledgerAgentId }),
  };
}

function buildSdkRunUsageObservations(input: {
  source: "sdk";
  billingRole: AgentRole;
  requestKey: string;
  models: SdkRunBillingModels["models"];
  resolvedSubagentId?: string;
}): UsageBillingObservation[] {
  if (!input.resolvedSubagentId || !isSubagentBillingRole(input.billingRole)) {
    return [];
  }
  return input.models.map((model) => ({
    source: input.source,
    role: input.billingRole,
    agentId: input.resolvedSubagentId!,
    usage: model.usage,
    requestKey: input.requestKey,
    ...(model.modelId && { modelId: model.modelId }),
  }));
}

function resolveSdkRunContextUpdate(input: {
  billingRole: AgentRole;
  runtimeRoutes: readonly RuntimeRoute[];
  primaryModelId?: string;
}): UsageBillingContextUpdate | undefined {
  const usageRoute = resolveUsageRoute(input.billingRole, input.primaryModelId, input.runtimeRoutes);
  if (!usageRoute || !shouldUpdateContextFromUsageSource("sdk", input.billingRole)) {
    return undefined;
  }
  return {
    role: input.billingRole,
    modelId: usageRoute.modelId,
    providerBaseUrl: usageRoute.provider.baseUrl,
    ...(usageRoute.modelsDevMapping && { modelsDevMapping: usageRoute.modelsDevMapping }),
  };
}
