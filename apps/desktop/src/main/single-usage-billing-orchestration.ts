import type { UpstreamApiCompat } from "../shared/api-compat";
import type { BillingUsageSource, RuntimeAgentRole } from "../shared/ipc";
import { shouldUpdateContextFromUsageSource } from "./billing-orchestration";
import type { RuntimeRoute } from "./billing-resolver";
import type { UpstreamProxyCallBilling } from "./upstream-proxy-log";
import {
  resolveSingleUsageBillingArtifacts,
  type UsageBillingPricingLookup,
} from "./usage-billing-artifacts";
import type { ApplySingleUsageBillingEffectsInput } from "./usage-billing-effects";

export interface SingleUsageBillingRequest {
  threadId: string;
  role: RuntimeAgentRole;
  agentId?: string;
  source?: BillingUsageSource;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  sourceReportedCostUsd?: number;
  modelId?: string;
  messageId?: string;
  runAttemptId?: string;
  plannerAgentId?: string;
  parentToolUseId?: string;
  requestKey?: string;
  sourceEventId?: string;
  providerRequestId?: string;
  sourceDedupId?: string;
  updateContext?: boolean;
  reconciliationOnly?: boolean;
  fillSdkPrimaryForSubagent?: boolean;
  routeRole?: RuntimeAgentRole;
  attributionPending?: boolean;
  aliasModelId?: string;
  providerId?: string;
  apiCompat?: UpstreamApiCompat;
}

export interface ResolveSingleUsageBillingOrchestrationInput {
  request: SingleUsageBillingRequest;
  runtimeRoutes: readonly RuntimeRoute[];
  lookupPricing: UsageBillingPricingLookup;
}

export interface SingleUsageBillingOrchestration {
  requestBillingLog: UpstreamProxyCallBilling;
  effectsInput: ApplySingleUsageBillingEffectsInput;
}

export async function resolveSingleUsageBillingOrchestration(
  input: ResolveSingleUsageBillingOrchestrationInput,
): Promise<SingleUsageBillingOrchestration | null> {
  const { request } = input;
  const delta = {
    inputTokens: request.inputTokens,
    outputTokens: request.outputTokens,
    cacheReadTokens: request.cacheReadTokens,
    cacheCreationTokens: request.cacheCreationTokens,
  };

  if (
    delta.inputTokens === 0 &&
    delta.outputTokens === 0 &&
    delta.cacheReadTokens === 0 &&
    delta.cacheCreationTokens === 0 &&
    request.sourceReportedCostUsd === undefined
  ) {
    return null;
  }

  const artifacts = await resolveSingleUsageBillingArtifacts({
    threadId: request.threadId,
    role: request.role,
    usage: delta,
    runtimeRoutes: input.runtimeRoutes,
    lookupPricing: input.lookupPricing,
    ...(request.source && { source: request.source }),
    ...(request.sourceReportedCostUsd !== undefined && {
      sourceReportedCostUsd: request.sourceReportedCostUsd,
    }),
    ...(request.modelId && { modelId: request.modelId }),
    ...(request.messageId && { messageId: request.messageId }),
    ...(request.runAttemptId && { runAttemptId: request.runAttemptId }),
    ...(request.plannerAgentId && { plannerAgentId: request.plannerAgentId }),
    ...(request.agentId && { agentId: request.agentId }),
    ...(request.parentToolUseId && { parentToolUseId: request.parentToolUseId }),
    ...(request.requestKey && { requestKey: request.requestKey }),
    ...(request.sourceEventId && { sourceEventId: request.sourceEventId }),
    ...(request.providerRequestId && { providerRequestId: request.providerRequestId }),
    ...(request.sourceDedupId && { sourceDedupId: request.sourceDedupId }),
    ...(request.routeRole && { routeRole: request.routeRole }),
    ...(request.attributionPending && { attributionPending: true }),
    ...(request.aliasModelId && { aliasModelId: request.aliasModelId }),
    ...(request.providerId && { providerId: request.providerId }),
  });
  const updateContext =
    request.updateContext ?? shouldUpdateContextFromUsageSource(request.source, request.role);

  return {
    requestBillingLog: artifacts.requestBillingLog,
    effectsInput: {
      threadId: request.threadId,
      artifacts,
      updateContext,
      ...(request.agentId && { agentId: request.agentId }),
      ...(request.messageId && { messageId: request.messageId }),
      ...(request.sourceReportedCostUsd !== undefined && {
        sourceReportedCostUsd: request.sourceReportedCostUsd,
      }),
      ...(request.reconciliationOnly && { reconciliationOnly: true }),
      ...(request.fillSdkPrimaryForSubagent && { fillSdkPrimaryForSubagent: true }),
    },
  };
}
