import type { RuntimeAgentRole } from "../shared/ipc";

export interface SdkAgentTerminalEventLike {
  type: string;
  agentId?: string;
  role: RuntimeAgentRole;
  payload: unknown;
}

export interface SdkAgentTerminalReconciliationServices {
  resolveParentToolUseAgentId?(parentToolUseId: string): string | undefined;
  linkParentToolUse(parentToolUseId: string, agentId: string): void;
  settlePendingByParent(input: { agentId: string; role: RuntimeAgentRole; parentToolUseId: string }): number;
  logDiagnostic(topic: string, fields: Record<string, unknown>): void;
}

/**
 * Reconcile the exact AgentOutput identity with its delegating Agent tool.
 * Aggregate terminal usage is diagnostics-only; authoritative proxy billing is never mutated from it.
 */
export function reconcileSdkAgentTerminalEvent(
  threadId: string,
  event: SdkAgentTerminalEventLike,
  services: SdkAgentTerminalReconciliationServices,
): boolean {
  if (event.type !== "agent.completed" || !isRecord(event.payload)) {
    return false;
  }
  const payload = event.payload;
  if (payload.type !== "agent_output" || payload.status !== "completed") {
    return false;
  }

  const eventAgentId = event.agentId?.trim();
  const payloadAgentId = typeof payload.agentId === "string" ? payload.agentId.trim() : "";
  if (!eventAgentId || !payloadAgentId || eventAgentId !== payloadAgentId) {
    services.logDiagnostic("subagent.agent_output_reconciliation", {
      threadId,
      status: "identity_conflict",
      eventAgentId: eventAgentId || null,
      payloadAgentId: payloadAgentId || null,
      role: event.role,
      billingUsageApplied: false,
    });
    return true;
  }

  const parentToolUseId = typeof payload.tool_use_id === "string" ? payload.tool_use_id.trim() : "";
  let settledUsageCount = 0;
  if (parentToolUseId) {
    const existingAgentId = services.resolveParentToolUseAgentId?.(parentToolUseId)?.trim();
    if (existingAgentId && existingAgentId !== eventAgentId) {
      services.logDiagnostic("subagent.agent_output_reconciliation", {
        threadId,
        status: "parent_identity_conflict",
        agentId: eventAgentId,
        existingAgentId,
        role: event.role,
        parentToolUseId,
        billingUsageApplied: false,
      });
      return true;
    }
    services.linkParentToolUse(parentToolUseId, eventAgentId);
    settledUsageCount = services.settlePendingByParent({
      agentId: eventAgentId,
      role: event.role,
      parentToolUseId,
    });
  }

  services.logDiagnostic("subagent.agent_output_reconciliation", {
    threadId,
    status: parentToolUseId ? "reconciled" : "missing_parent_tool_use_id",
    agentId: eventAgentId,
    role: event.role,
    ...(parentToolUseId && { parentToolUseId }),
    ...(typeof payload.totalTokens === "number" && { terminalTotalTokens: payload.totalTokens }),
    ...(typeof payload.totalToolUseCount === "number" && {
      terminalToolUseCount: payload.totalToolUseCount,
    }),
    ...(typeof payload.totalDurationMs === "number" && {
      terminalDurationMs: payload.totalDurationMs,
    }),
    terminalUsage: isRecord(payload.usage) ? payload.usage : undefined,
    settledUsageCount,
    billingUsageApplied: false,
  });
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
