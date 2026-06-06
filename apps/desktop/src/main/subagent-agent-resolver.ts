import type { AgentRole } from "../shared/ipc";
import { isSubagentBillingRole } from "./billing-orchestration";

export type SubagentAgentResolveMissReason =
  | "no_thread_state"
  | "parent_tool_use_unmapped"
  | "ambiguous_multiple_active"
  | "no_active_subagent";

export interface SubagentAgentResolveInput {
  role: AgentRole;
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
  if (!isSubagentBillingRole(input.role)) {
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
