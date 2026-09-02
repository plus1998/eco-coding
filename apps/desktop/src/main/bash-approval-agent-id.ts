import type { SdkToolPermissionRequest } from "@eco/runtime";
import { isSubagentRole, normalizeSdkSubagentType } from "@eco/runtime";
import type { RuntimeAgentRole } from "../shared/ipc";

export function resolveBashApprovalAgentId(
  threadId: string,
  request: Pick<SdkToolPermissionRequest, "agentId" | "agentType">,
  deps: {
    plannerAgentId: string | undefined;
    roleForAgentId: (threadId: string, agentId: string) => RuntimeAgentRole | undefined;
    resolveSubagentId: (
      threadId: string,
      input: { role: RuntimeAgentRole; subagentAgentId?: string },
    ) => string | undefined;
  },
): string | undefined {
  const explicitAgentId = request.agentId?.trim();
  const plannerAgentId = deps.plannerAgentId?.trim();
  const agentTypeRole = request.agentType ? normalizeSdkSubagentType(request.agentType) : undefined;

  if (explicitAgentId) {
    if (deps.roleForAgentId(threadId, explicitAgentId)) {
      return explicitAgentId;
    }
  }

  if (agentTypeRole && isSubagentRole(agentTypeRole)) {
    return deps.resolveSubagentId(threadId, {
      role: agentTypeRole,
      ...(explicitAgentId && { subagentAgentId: explicitAgentId }),
    });
  }

  return plannerAgentId;
}
