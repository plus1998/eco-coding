import type { AgentRole } from "../shared/ipc";
import { isSubagentBillingRole } from "./billing-orchestration";

export interface SubagentMetricsRecordTargetResolver {
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

export interface ResolveSubagentMetricsRecordTargetInput {
  threadId: string;
  role: AgentRole;
  resolver: SubagentMetricsRecordTargetResolver;
  agentId?: string;
  parentToolUseId?: string;
}

export interface SubagentMetricsRecordTarget {
  agentId: string;
  role: AgentRole;
}

export function resolveSubagentMetricsRecordTarget(
  input: ResolveSubagentMetricsRecordTargetInput,
): SubagentMetricsRecordTarget | undefined {
  const agentId = input.resolver.resolveAgentId(input.threadId, {
    role: input.role,
    ...(input.agentId && { subagentAgentId: input.agentId }),
    ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
  });
  if (!agentId) {
    return undefined;
  }

  const role = input.resolver.roleForAgentId(input.threadId, agentId);
  if (!role || !isSubagentBillingRole(role)) {
    return undefined;
  }

  return { agentId, role };
}
