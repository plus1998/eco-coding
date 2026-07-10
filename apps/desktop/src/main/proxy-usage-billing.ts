import { computeWindowOccupancy, type ParsedUsage } from "@eco/runtime";
import type { UpstreamApiCompat } from "../shared/api-compat";
import type { RuntimeAgentRole } from "../shared/ipc";
import type { AnthropicProxyUsageInfo } from "./anthropic-proxy";
import {
  type UsageBillingObservation,
} from "./billing-orchestration";
import {
  resolveSubagentUsageAttribution,
  type SubagentUsageAttributionResolver,
} from "./subagent-usage-attribution";
import { normalizeTelemetryBillingRole } from "./telemetry-billing-role";

export interface ProxyUsageBillingInput {
  threadId: string;
  role: RuntimeAgentRole;
  source: "proxy";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  modelId: string;
  requestKey: string;
  sourceEventId: string;
  providerRequestId?: string;
  messageId?: string;
  runAttemptId?: string;
  plannerAgentId?: string;
  reconciliationOnly: true;
  fillSdkPrimaryForSubagent: boolean;
  updateContext?: boolean;
  agentId?: string;
  parentToolUseId?: string;
  routeRole?: RuntimeAgentRole;
  attributionPending?: boolean;
  aliasModelId?: string;
  providerId?: string;
  apiCompat?: UpstreamApiCompat;
}

export interface ResolveProxyUsageBillingInput {
  info: AnthropicProxyUsageInfo & { threadId: string };
  currentRequestSeq?: number;
  runAttemptId?: string;
  plannerAgentId?: string;
  resolver: SubagentUsageAttributionResolver;
  stampedAgentId?: string;
  stampedBillingRole?: RuntimeAgentRole;
  stampedParentToolUseId?: string;
}

export interface ProxyUsageBillingResolution {
  nextRequestSeq: number;
  contextRole: RuntimeAgentRole;
  contextOccupied: number;
  requestKey: string;
  billingRole: RuntimeAgentRole;
  usage: ParsedUsage;
  observation: UsageBillingObservation;
  billingInput: ProxyUsageBillingInput;
  subagentAgentId?: string;
  attributionAttempted: boolean;
  attributionPending: boolean;
}

export function resolveProxyUsageBilling(
  input: ResolveProxyUsageBillingInput,
): ProxyUsageBillingResolution {
  const { info } = input;
  const nextRequestSeq = (input.currentRequestSeq ?? 0) + 1;
  const requestKey = buildProxyUsageRequestKey(info, nextRequestSeq);
  const initialBillingRole = normalizeTelemetryBillingRole(info.role);
  const attribution = resolveSubagentUsageAttribution({
    threadId: info.threadId,
    role: initialBillingRole,
    resolver: input.resolver,
    ...(input.stampedAgentId && { stampedAgentId: input.stampedAgentId }),
    ...(input.stampedBillingRole && { stampedBillingRole: input.stampedBillingRole }),
    ...(input.stampedParentToolUseId && { parentToolUseId: input.stampedParentToolUseId }),
  });
  const { billingRole, subagentAgentId, attempted: attributionAttempted } = attribution;
  const attributionPending = attributionAttempted && !subagentAgentId;
  const usage: ParsedUsage = {
    inputTokens: info.usage.inputTokens,
    outputTokens: info.usage.outputTokens,
    cacheReadTokens: info.usage.cacheReadTokens,
    cacheCreationTokens: info.usage.cacheCreationTokens,
  };

  return {
    nextRequestSeq,
    contextRole: info.role,
    contextOccupied: computeWindowOccupancy(usage),
    requestKey,
    billingRole,
    usage,
    observation: {
      source: "proxy",
      role: billingRole,
      usage,
      requestKey,
      modelId: info.modelId,
      ...(subagentAgentId && { agentId: subagentAgentId }),
    },
    billingInput: {
      threadId: info.threadId,
      role: billingRole,
      source: "proxy",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      modelId: info.modelId,
      requestKey,
      sourceEventId: requestKey,
      ...(info.requestId && { providerRequestId: info.requestId }),
      ...(info.downstreamMessageId && { messageId: info.downstreamMessageId }),
      ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
      ...(input.plannerAgentId && { plannerAgentId: input.plannerAgentId }),
      reconciliationOnly: true,
      fillSdkPrimaryForSubagent: false,
      apiCompat: info.apiCompat,
      routeRole: info.role,
      ...(input.stampedParentToolUseId && { parentToolUseId: input.stampedParentToolUseId }),
      ...(info.aliasModelId && { aliasModelId: info.aliasModelId }),
      ...(info.providerId && { providerId: info.providerId }),
      ...(attributionPending && { attributionPending: true }),
      ...(subagentAgentId && { agentId: subagentAgentId }),
    },
    attributionAttempted,
    attributionPending,
    ...(subagentAgentId && { subagentAgentId }),
  };
}

export function buildProxyUsageRequestKey(
  info: AnthropicProxyUsageInfo,
  requestSeq: number,
): string {
  return [
    "proxy",
    info.role,
    info.modelId,
    info.requestId ?? String(requestSeq),
    info.usage.inputTokens,
    info.usage.outputTokens,
    info.usage.cacheReadTokens,
    info.usage.cacheCreationTokens,
  ].join(":");
}
