import type { AgentRole } from "../shared/ipc";
import type { ContextMonitorSnapshot } from "./context-window-monitor";

/** Structured stderr diagnostics for context meter + subagent attribution (no raw prompts). */
export function isEcoDiagLogEnabled(): boolean {
  const value = process.env.ECO_DIAG_LOG?.trim().toLowerCase();
  if (value === "0" || value === "false" || value === "no") {
    return false;
  }
  if (value === "1" || value === "true" || value === "yes") {
    return true;
  }
  return process.env.NODE_ENV !== "production";
}

export function shortThreadId(threadId: string): string {
  const trimmed = threadId.replace(/^thr_/, "");
  return trimmed.length > 10 ? trimmed.slice(-10) : trimmed;
}

export function shortAgentId(agentId: string): string {
  return agentId.length > 12 ? agentId.slice(-12) : agentId;
}

const diagThrottleMs = new Map<string, number>();

export function logEcoDiag(topic: string, fields: Record<string, unknown>): void {
  if (!isEcoDiagLogEnabled()) {
    return;
  }
  const line = JSON.stringify({ topic, ...fields });
  const max = 4000;
  if (line.length <= max) {
    process.stderr.write(`[eco-diag] ${line}\n`);
    return;
  }
  process.stderr.write(
    `[eco-diag] ${JSON.stringify({ topic, truncated: true, length: line.length, preview: line.slice(0, max) })}\n`,
  );
}

/** Rate-limit high-frequency diagnostics (e.g. context meter stream updates). */
export function logEcoDiagThrottled(
  key: string,
  topic: string,
  fields: Record<string, unknown>,
  intervalMs = 750,
): void {
  if (!isEcoDiagLogEnabled()) {
    return;
  }
  const now = Date.now();
  const last = diagThrottleMs.get(key) ?? 0;
  if (now - last < intervalMs) {
    return;
  }
  diagThrottleMs.set(key, now);
  logEcoDiag(topic, fields);
}

export function snapshotContextFields(
  snapshot: ContextMonitorSnapshot | undefined,
): Record<string, unknown> {
  if (!snapshot) {
    return { empty: true };
  }
  return {
    displayRole: snapshot.displayRole,
    topOccupied: snapshot.occupied,
    topLimit: snapshot.limit,
    roles: (snapshot.roles ?? []).map((row) => ({
      role: row.role,
      occupied: row.occupied,
      limit: row.limit,
    })),
    instances: (snapshot.instances ?? []).map((row) => ({
      agentId: shortAgentId(row.agentId),
      role: row.role,
      occupied: row.occupied,
    })),
  };
}

export function formatSubagentResolveReason(input: {
  explicitSubagentId?: string;
  parentToolUseId?: string;
  linkedFromParent?: string;
  singletonActive?: string;
  activeCount?: number;
  isSubagentRole: boolean;
}): string {
  if (input.explicitSubagentId) {
    return "explicit_payload";
  }
  if (!input.isSubagentRole) {
    return "not_subagent_role";
  }
  if (input.linkedFromParent) {
    return "parent_tool_use_id";
  }
  if (input.singletonActive) {
    return "single_active_agent";
  }
  if ((input.activeCount ?? 0) > 1) {
    return "ambiguous_multiple_active";
  }
  if ((input.activeCount ?? 0) === 0) {
    return "no_active_subagent";
  }
  if (input.parentToolUseId) {
    return "parent_tool_use_unmapped";
  }
  return "unresolved";
}

export type SubagentResolveDiag = {
  role: AgentRole;
  resolved?: string;
  reason: string;
  explicitSubagentId?: string;
  parentToolUseId?: string;
  activeAgentIds?: string[];
};
