import type { EcoAgentRuntimeConfig } from "@eco/runtime";
import {
  evaluateBashConfirmation,
  resolveAgentBashPolicyForConfirmation,
  type ExecutionConfirmationMode,
  type ToolConfirmationDecision,
} from "@eco/runtime";

export type { ExecutionConfirmationMode, ToolConfirmationDecision };

export interface ThreadToolConfirmationInput {
  command: string;
  cwd: string;
  workspacePath: string;
  confirmationMode: ExecutionConfirmationMode;
  agentRegistry?: EcoAgentRuntimeConfig | undefined;
  agentId?: string;
  agentType?: string;
  phaseAllowsExecution?: boolean;
}

/** Desktop canUseTool：Bash 的单一确认决策入口。 */
export function evaluateThreadToolConfirmation(
  input: ThreadToolConfirmationInput,
): ToolConfirmationDecision {
  const agentBash = resolveAgentBashPolicyForConfirmation({
    ...(input.agentRegistry ? { registry: input.agentRegistry } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.agentType ? { agentType: input.agentType } : {}),
  });
  return evaluateBashConfirmation({
    command: input.command,
    cwd: input.cwd,
    workspacePath: input.workspacePath,
    confirmationMode: input.confirmationMode,
    ...(input.phaseAllowsExecution !== undefined
      ? { phaseAllowsExecution: input.phaseAllowsExecution }
      : {}),
    ...(agentBash ? { agentBash } : {}),
  });
}

/** @deprecated 使用 evaluateThreadToolConfirmation */
export const evaluateThreadBashPermission = evaluateThreadToolConfirmation;
