import {
  type AgentEvent,
  normalizeSdkSubagentType,
  SDK_GENERAL_PURPOSE_AGENT_KEY,
  SDK_PLAN_AGENT_KEY,
} from "@eco/runtime";
import { inferActivityRole } from "@eco/runtime/sdk";
import type { RuntimeAgentRole } from "../shared/ipc";
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

function readBillingRole(role: string): RuntimeAgentRole | undefined {
  const trimmed = role.trim();
  if (trimmed === SDK_GENERAL_PURPOSE_AGENT_KEY || trimmed === SDK_PLAN_AGENT_KEY) {
    return trimmed;
  }
  const normalized = normalizeSdkSubagentType(role);
  if (normalized) {
    return normalized;
  }
  if (!trimmed || isReservedActivityRole(trimmed)) {
    return undefined;
  }
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(trimmed) ? trimmed : undefined;
}

function isReservedActivityRole(role: string): boolean {
  return ["assistant", "main", "planner", "system", "thinking", "tool", "user"].includes(role);
}

function readDistinctSubagentSessionId(
  agentId: string | undefined,
  plannerSessionId: string | undefined,
): string | undefined {
  const explicitAgentId = agentId?.trim();
  if (!explicitAgentId || explicitAgentId === "unknown-session" || explicitAgentId === plannerSessionId) {
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
  const distinctExplicit = readDistinctSubagentSessionId(event.agentId, options.plannerSessionId?.trim());
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

  return undefined;
}

export function activityStreamKey(
  threadId: string,
  agentId?: string,
  role?: string,
  parentToolUseId?: string,
  streamBlockKey?: string,
): string {
  let key: string;
  if (agentId?.trim()) {
    key = `${threadId}:${agentId.trim()}`;
  } else if (parentToolUseId?.trim()) {
    key = `${threadId}:parent:${parentToolUseId.trim()}`;
  } else {
    key = `${threadId}:${role ?? "planner"}`;
  }
  return streamBlockKey?.trim() ? `${key}:block:${streamBlockKey.trim()}` : key;
}
