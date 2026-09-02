import type { RuntimeAgentRole } from "../shared/ipc";
import { isSubagentBillingRole } from "./billing-orchestration";

export interface SubagentUsageAttributionResolver {
  resolveAgentId(
    threadId: string,
    input: {
      role: RuntimeAgentRole;
      subagentAgentId?: string;
      parentToolUseId?: string;
    },
  ): string | undefined;
  roleForAgentId(threadId: string, agentId: string): RuntimeAgentRole | undefined;
}

export interface ResolveSubagentUsageAttributionInput {
  threadId: string;
  role: RuntimeAgentRole;
  resolver: SubagentUsageAttributionResolver;
  explicitSubagentId?: string;
  parentToolUseId?: string;
  stampedAgentId?: string;
  stampedBillingRole?: RuntimeAgentRole;
}

export interface SubagentUsageAttribution {
  billingRole: RuntimeAgentRole;
  attempted: boolean;
  subagentAgentId?: string;
}

export function resolveSubagentUsageAttribution(
  input: ResolveSubagentUsageAttributionInput,
): SubagentUsageAttribution {
  let billingRole = input.stampedBillingRole ?? input.role;
  const stampedAgentId = input.stampedAgentId?.trim();
  if (stampedAgentId) {
    const entryRole = input.resolver.roleForAgentId(input.threadId, stampedAgentId);
    if (entryRole) {
      billingRole = entryRole;
    }
    return {
      billingRole,
      attempted: true,
      subagentAgentId: stampedAgentId,
    };
  }

  const explicitSubagentId = input.explicitSubagentId?.trim();
  if (explicitSubagentId) {
    const entryRole = input.resolver.roleForAgentId(input.threadId, explicitSubagentId);
    if (entryRole) {
      billingRole = entryRole;
    }
    return {
      billingRole,
      attempted: true,
      subagentAgentId: explicitSubagentId,
    };
  }

  const shouldResolve =
    isSubagentBillingRole(input.role) || Boolean(input.explicitSubagentId) || Boolean(input.parentToolUseId);

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
    if (entryRole) {
      billingRole = entryRole;
    }
  }

  return {
    billingRole,
    attempted: true,
    ...(subagentAgentId && { subagentAgentId }),
  };
}
