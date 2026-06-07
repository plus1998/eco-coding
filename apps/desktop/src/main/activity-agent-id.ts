import { isSubagentRole } from "@eco/runtime";
import { inferActivityRole } from "@eco/runtime/sdk";
import type { AgentRole } from "@eco/shared";
import type { AgentEvent } from "@eco/shared";
import type { SubagentMetricsRegistry } from "./subagent-metrics-registry.js";

type ActivityAgentEvent = Pick<AgentEvent, "type" | "payload" | "role" | "agentId">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readParentToolUseId(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const direct = payload.parent_tool_use_id;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  return undefined;
}

function readBillingRole(role: string): AgentRole | undefined {
  return isSubagentRole(role) ? role : undefined;
}

function readDistinctSubagentSessionId(
  agentId: string | undefined,
  plannerSessionId: string | undefined,
): string | undefined {
  const explicitAgentId = agentId?.trim();
  if (
    !explicitAgentId ||
    explicitAgentId === "unknown-session" ||
    explicitAgentId === plannerSessionId
  ) {
    return undefined;
  }
  return explicitAgentId;
}

/** Resolve sub-agent instance id for activity persistence. */
export function resolveActivityAgentId(
  threadId: string,
  event: ActivityAgentEvent,
  options: {
    plannerSessionId?: string;
    metricsRegistry?: SubagentMetricsRegistry;
  },
): string | undefined {
  const displayRole = inferActivityRole(event);
  const billingRole = readBillingRole(displayRole);
  const distinctExplicit = readDistinctSubagentSessionId(
    event.agentId,
    options.plannerSessionId?.trim(),
  );
  const parentToolUseId = readParentToolUseId(event.payload);

  if (parentToolUseId && options.metricsRegistry) {
    const linked = options.metricsRegistry.resolveAgentIdByParentToolUse(threadId, parentToolUseId);
    if (linked) {
      return linked;
    }
  }

  if (distinctExplicit && billingRole) {
    return distinctExplicit;
  }

  if (distinctExplicit && options.metricsRegistry?.roleForAgentId(threadId, distinctExplicit)) {
    return distinctExplicit;
  }

  if (!billingRole) {
    return undefined;
  }

  if (distinctExplicit) {
    return distinctExplicit;
  }

  if (options.metricsRegistry) {
    const resolved = options.metricsRegistry.resolveAgentId(threadId, {
      role: billingRole,
      ...(parentToolUseId && { parentToolUseId }),
    });
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

/** Resolve sub-agent instance id for OTel tool / narrative activity lines. */
export function resolveOtelActivityAgentId(
  threadId: string,
  line: { role: string; message: string },
  options: {
    metricsRegistry?: SubagentMetricsRegistry;
  },
): string | undefined {
  const billingRole = readBillingRole(line.role);
  if (!billingRole || !options.metricsRegistry) {
    return undefined;
  }

  return options.metricsRegistry.resolveAgentId(threadId, {
    role: billingRole,
  });
}

export function activityStreamKey(threadId: string, agentId?: string, role?: string): string {
  if (agentId?.trim()) {
    return `${threadId}:${agentId.trim()}`;
  }
  return `${threadId}:${role ?? "planner"}`;
}
