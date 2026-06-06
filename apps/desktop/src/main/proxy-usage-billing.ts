import { computeWindowOccupancy, type ParsedUsage } from "@eco/runtime";
import type { AgentRole } from "../shared/ipc";
import type { AnthropicProxyUsageInfo } from "./anthropic-proxy";
import {
  isSubagentBillingRole,
  type UsageBillingObservation,
} from "./billing-orchestration";
import {
  resolveSubagentUsageAttribution,
  type SubagentUsageAttributionResolver,
} from "./subagent-usage-attribution";
import { normalizeTelemetryBillingRole } from "./telemetry-billing-role";

export interface ProxyUsageBillingInput {
  threadId: string;
  role: AgentRole;
  source: "proxy";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  modelId: string;
  requestKey: string;
  sourceEventId: string;
  providerRequestId?: string;
  runAttemptId?: string;
  plannerAgentId?: string;
  reconciliationOnly: true;
  fillSdkPrimaryForSubagent: boolean;
  agentId?: string;
}

export interface ResolveProxyUsageBillingInput {
  info: AnthropicProxyUsageInfo & { threadId: string };
  currentRequestSeq?: number;
  runAttemptId?: string;
  plannerAgentId?: string;
  resolver: SubagentUsageAttributionResolver;
}

export interface ProxyUsageBillingResolution {
  nextRequestSeq: number;
  contextRole: AgentRole;
  contextOccupied: number;
  requestKey: string;
  billingRole: AgentRole;
  usage: ParsedUsage;
  observation: UsageBillingObservation;
  billingInput: ProxyUsageBillingInput;
  subagentAgentId?: string;
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
  });
  const { billingRole, subagentAgentId } = attribution;
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
      ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
      ...(input.plannerAgentId && { plannerAgentId: input.plannerAgentId }),
      reconciliationOnly: true,
      fillSdkPrimaryForSubagent: isSubagentBillingRole(billingRole),
      ...(subagentAgentId && { agentId: subagentAgentId }),
    },
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
