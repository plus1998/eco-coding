import { computeWindowOccupancy, type ParsedUsage, type RequestBillingDelta } from "@eco/runtime";
import type { RuntimeAgentRole } from "../shared/ipc";
import type { SubagentLegacyMetricsRecordInput } from "./subagent-legacy-metrics-fallback-effects";
import type { SubagentContextObservationInput } from "./subagent-metrics-state";
import type { UsageContextService } from "./usage-context-effects";

export type UsageContextSnapshot = ReturnType<UsageContextService["getSnapshot"]>;

export interface SubagentBillingMetricsContext {
  role: RuntimeAgentRole;
  agentId: string;
  contextOccupied: number;
  contextLimit?: number;
}

export function resolveSubagentBillingMetricsContext(input: {
  role: RuntimeAgentRole;
  agentId?: string;
  snapshot: UsageContextSnapshot;
  fallbackUsage: ParsedUsage;
}): SubagentBillingMetricsContext | undefined {
  if (!input.agentId) {
    return undefined;
  }

  const instance = input.snapshot?.instances?.find((row) => row.agentId === input.agentId);
  return {
    role: input.role,
    agentId: input.agentId,
    contextOccupied: instance?.occupied ?? computeWindowOccupancy(input.fallbackUsage),
    ...(instance?.limit !== undefined && { contextLimit: instance.limit }),
  };
}

export function buildSubagentContextObservationInput(
  context: SubagentBillingMetricsContext,
  input: {
    parentToolUseId?: string;
    modelId?: string;
    requestKey?: string;
  } = {},
): SubagentContextObservationInput {
  return {
    role: context.role,
    agentId: context.agentId,
    ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
    contextOccupied: context.contextOccupied,
    ...(context.contextLimit !== undefined && { contextLimit: context.contextLimit }),
    ...(input.modelId && { modelId: input.modelId }),
    ...(input.requestKey && { requestKey: input.requestKey }),
  };
}

export function buildSubagentLegacyMetricsRecordInput(
  context: SubagentBillingMetricsContext,
  input: {
    role?: RuntimeAgentRole;
    parentToolUseId?: string;
    usage: ParsedUsage;
    billing: RequestBillingDelta;
    modelId?: string;
    requestKey: string;
  },
): SubagentLegacyMetricsRecordInput {
  return {
    role: input.role ?? context.role,
    agentId: context.agentId,
    ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
    usage: input.usage,
    contextOccupied: context.contextOccupied,
    ...(context.contextLimit !== undefined && { contextLimit: context.contextLimit }),
    billing: input.billing,
    ...(input.modelId && { modelId: input.modelId }),
    requestKey: input.requestKey,
  };
}
