import { parseSdkContextUsage } from "@eco/runtime";
import type { RuntimeAgentRole } from "../shared/ipc";
import type { UsageBillingObservation } from "./billing-orchestration";
import type { RuntimeRoute } from "./billing-resolver";
import type { SdkUsageBillingBundle } from "./sdk-event-usage-billing";
import {
  resolveSdkRunBillingAttribution,
  type SdkRunBillingAttributionResolver,
} from "./sdk-run-billing-attribution";
import {
  resolveSdkRunBillingModels,
  type SdkRunBillingModels,
  type UsageBillingPricingLookup,
} from "./usage-billing-artifacts";
import type { ApplySdkRunBillingEffectsInput } from "./usage-billing-effects";

export interface ResolveSdkRunBillingResolutionInput {
  threadId: string;
  role: RuntimeAgentRole;
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
}

export interface SdkRunBillingResolution {
  billingModels: SdkRunBillingModels;
  billingRole: RuntimeAgentRole;
  contextUsage: ApplySdkRunBillingEffectsInput["contextUsage"];
  observations: UsageBillingObservation[];
  effectsInput: ApplySdkRunBillingEffectsInput;
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
  // SDK result.usage is cumulative billing — not current window fill. During a turn,
  // stream_partial keeps the meter live; getContextUsage() calibrates once per result.
  const effectsInput: ApplySdkRunBillingEffectsInput = {
    threadId: input.threadId,
    role: input.role,
    requestKey: input.requestKey,
    models,
    billingRole,
    contextUsage,
    updateContext: false,
    ...(input.bundle.totalCostUsd !== undefined && { totalCostUsd: input.bundle.totalCostUsd }),
    ...(input.billingModels.plannerModelLabel && {
      plannerModelLabel: input.billingModels.plannerModelLabel,
    }),
    ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
    ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
    ...(ledgerAgentId && { ledgerAgentId }),
    ...(resolvedSubagentId && { resolvedSubagentId }),
  };

  return {
    billingModels: input.billingModels,
    billingRole,
    contextUsage,
    observations,
    effectsInput,
    ...(resolvedSubagentId && { resolvedSubagentId }),
    ...(ledgerAgentId && { ledgerAgentId }),
  };
}

function buildSdkRunUsageObservations(input: {
  source: "sdk";
  billingRole: RuntimeAgentRole;
  requestKey: string;
  models: SdkRunBillingModels["models"];
  resolvedSubagentId?: string;
}): UsageBillingObservation[] {
  if (!input.resolvedSubagentId) {
    return [];
  }
  const agentId = input.resolvedSubagentId;
  return input.models.map((model) => ({
    source: input.source,
    role: input.billingRole,
    agentId,
    usage: model.usage,
    requestKey: input.requestKey,
    ...(model.modelId && { modelId: model.modelId }),
  }));
}
