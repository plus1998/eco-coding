import { computeWindowOccupancy, type ParsedUsage } from "@eco/runtime";
import type { RuntimeAgentRole } from "../shared/ipc";
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
