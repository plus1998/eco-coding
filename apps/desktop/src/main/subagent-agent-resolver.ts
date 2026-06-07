import type { RuntimeAgentRole } from "../shared/ipc";

export type SubagentAgentResolveMissReason =
  | "no_thread_state"
  | "parent_tool_use_unmapped"
  | "ambiguous_multiple_active"
  | "no_active_subagent";

export interface SubagentAgentResolveInput {
  role: RuntimeAgentRole;
  explicitAgentId?: string;
  parentToolUseId?: string;
  linkedParentAgentId?: string;
  hasThreadState: boolean;
  activeAgentIds?: readonly string[];
  stoppedAgentIdsForRole?: readonly string[];
}

export interface SubagentAgentResolveResult {
  agentId?: string;
  missReason?: SubagentAgentResolveMissReason;
  activeAgentIds?: readonly string[];
}

export function resolveSubagentAgentId(
  input: SubagentAgentResolveInput,
): SubagentAgentResolveResult {
  const explicit = input.explicitAgentId?.trim();
  if (explicit) {
    return { agentId: explicit };
  }
  if (input.linkedParentAgentId) {
    return { agentId: input.linkedParentAgentId };
  }
  if (!isResolvableAgentRole(input.role)) {
    return {};
  }
  if (!input.hasThreadState) {
    return { missReason: "no_thread_state", activeAgentIds: [] };
  }

  const activeAgentIds = input.activeAgentIds ?? [];
  if (activeAgentIds.length === 1 && activeAgentIds[0]) {
    return { agentId: activeAgentIds[0] };
  }
  if (activeAgentIds.length > 1) {
    return {
      missReason: input.parentToolUseId
        ? "parent_tool_use_unmapped"
        : "ambiguous_multiple_active",
      activeAgentIds,
    };
  }

  const stoppedAgentIdsForRole = input.stoppedAgentIdsForRole ?? [];
  if (stoppedAgentIdsForRole.length === 1 && stoppedAgentIdsForRole[0]) {
    return { agentId: stoppedAgentIdsForRole[0] };
  }

  return {
    missReason: input.parentToolUseId ? "parent_tool_use_unmapped" : "no_active_subagent",
    activeAgentIds,
  };
}

function isResolvableAgentRole(role: RuntimeAgentRole): boolean {
  return !["assistant", "main", "planner", "system", "thinking", "tool", "user"].includes(role);
}
