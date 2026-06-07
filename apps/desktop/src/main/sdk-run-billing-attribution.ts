import type { RuntimeAgentRole } from "../shared/ipc";
import type { ResolvedSdkRunBillingModel } from "./usage-billing-artifacts";

export interface SdkRunBillingAttributionResolver {
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

export interface ResolveSdkRunBillingAttributionInput {
  threadId: string;
  role: RuntimeAgentRole;
  models: readonly ResolvedSdkRunBillingModel[];
  resolver: SdkRunBillingAttributionResolver;
  parentToolUseId?: string;
  subagentAgentId?: string;
  plannerAgentId?: string;
}

export interface SdkRunBillingAttribution {
  billingRole: RuntimeAgentRole;
  allLedgerRowsArePlanner: boolean;
  resolvedSubagentId?: string;
  ledgerAgentId?: string;
}

export function resolveSdkRunBillingAttribution(
  input: ResolveSdkRunBillingAttributionInput,
): SdkRunBillingAttribution {
  const primaryModel = input.models[0];
  let billingRole = primaryModel?.role ?? input.role;
  const resolvedSubagentId =
    input.subagentAgentId ??
    input.resolver.resolveAgentId(input.threadId, {
      role: billingRole,
      ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
    });

  if (resolvedSubagentId) {
    const entryRole = input.resolver.roleForAgentId(input.threadId, resolvedSubagentId);
    if (entryRole) {
      billingRole = entryRole;
    }
  }

  const allLedgerRowsArePlanner = input.models.every((model) => (model.role ?? input.role) === "planner");
  const ledgerAgentId =
    resolvedSubagentId ??
    (allLedgerRowsArePlanner ? input.plannerAgentId : undefined);

  return {
    billingRole,
    allLedgerRowsArePlanner,
    ...(resolvedSubagentId && { resolvedSubagentId }),
    ...(ledgerAgentId && { ledgerAgentId }),
  };
}
