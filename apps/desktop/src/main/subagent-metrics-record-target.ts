import type { RuntimeAgentRole } from "../shared/ipc";

export interface SubagentMetricsRecordTargetResolver {
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

export interface ResolveSubagentMetricsRecordTargetInput {
  threadId: string;
  role: RuntimeAgentRole;
  resolver: SubagentMetricsRecordTargetResolver;
  agentId?: string;
  parentToolUseId?: string;
}

export interface SubagentMetricsRecordTarget {
  agentId: string;
  role: RuntimeAgentRole;
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
  if (!role) {
    return undefined;
  }

  return { agentId, role };
}
