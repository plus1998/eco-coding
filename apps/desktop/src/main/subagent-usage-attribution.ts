import type { AgentRole } from "../shared/ipc";
import { isSubagentBillingRole } from "./billing-orchestration";

export interface SubagentUsageAttributionResolver {
  resolveAgentId(
    threadId: string,
    input: {
      role: AgentRole;
      subagentAgentId?: string;
      parentToolUseId?: string;
    },
  ): string | undefined;
  roleForAgentId(threadId: string, agentId: string): AgentRole | undefined;
}

export interface ResolveSubagentUsageAttributionInput {
  threadId: string;
  role: AgentRole;
  resolver: SubagentUsageAttributionResolver;
  explicitSubagentId?: string;
  parentToolUseId?: string;
}

export interface SubagentUsageAttribution {
  billingRole: AgentRole;
  attempted: boolean;
  subagentAgentId?: string;
}

export function resolveSubagentUsageAttribution(
  input: ResolveSubagentUsageAttributionInput,
): SubagentUsageAttribution {
  let billingRole = input.role;
  const shouldResolve =
    isSubagentBillingRole(input.role) ||
    Boolean(input.explicitSubagentId) ||
    Boolean(input.parentToolUseId);

  if (!shouldResolve) {
    return { billingRole, attempted: false };
  }

  const subagentAgentId = input.resolver.resolveAgentId(input.threadId, {
    role: billingRole,
    ...(input.explicitSubagentId && { subagentAgentId: input.explicitSubagentId }),
    ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
  });

  if (subagentAgentId) {
    const entryRole = input.resolver.roleForAgentId(input.threadId, subagentAgentId);
    if (entryRole && isSubagentBillingRole(entryRole)) {
      billingRole = entryRole;
    }
  }

  return {
    billingRole,
    attempted: true,
    ...(subagentAgentId && { subagentAgentId }),
  };
}
