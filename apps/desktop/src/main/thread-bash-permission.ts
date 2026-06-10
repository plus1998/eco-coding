import type { EcoAgentRuntimeConfig } from "@eco/runtime";
import {
  evaluateBashPolicy,
  type AgentBashPolicy,
  type BashPolicyDecision,
  type BashReviewMode,
} from "../../../../packages/bash-policy/src";
export interface ThreadBashPermissionInput {
  command: string;
  cwd: string;
  workspacePath: string;
  bashReviewMode: BashReviewMode;
  agentRegistry?: EcoAgentRuntimeConfig | undefined;
  agentId?: string;
  agentType?: string;
}

export function evaluateThreadBashPermission(input: ThreadBashPermissionInput): BashPolicyDecision {
  const agentBash = resolveAgentBashPolicy(input.agentRegistry, input.agentId, input.agentType);
  return evaluateBashPolicy({
    command: input.command,
    cwd: input.cwd,
    workspacePath: input.workspacePath,
    mode: input.bashReviewMode,
    ...(agentBash ? { agentBash } : {}),
  });
}

function resolveAgentBashPolicy(
  registry: EcoAgentRuntimeConfig | undefined,
  agentId?: string,
  agentType?: string,
): AgentBashPolicy | undefined {
  if (!registry) {
    return undefined;
  }
  const bash = resolveToolBashPolicy(registry.profile, registry.templates, agentId, agentType);
  if (!bash) {
    return undefined;
  }
  return {
    enabled: bash.enabled,
    ...(bash.commandAllowlist ? { commandAllowlist: bash.commandAllowlist } : {}),
    ...(bash.commandDenylist ? { commandDenylist: bash.commandDenylist } : {}),
  };
}

function resolveToolBashPolicy(
  profile: EcoAgentRuntimeConfig["profile"],
  templates: EcoAgentRuntimeConfig["templates"],
  agentId?: string,
  agentType?: string,
): NonNullable<EcoAgentRuntimeConfig["profile"]["mainAgent"]["tools"]["bash"]> | undefined {
  const actor = resolveBashPolicyActor(agentId, agentType);
  if (actor === "main") {
    return profile.mainAgent.tools.bash;
  }
  const agent = profile.agents.find((entry) => entry.agentKey === actor);
  if (!agent) {
    return profile.mainAgent.tools.bash;
  }
  if (agent.tools.bash) {
    return agent.tools.bash;
  }
  const template = templates.find((entry) => entry.id === agent.templateId);
  return template?.defaultTools.bash ?? profile.mainAgent.tools.bash;
}

function resolveBashPolicyActor(agentId?: string, agentType?: string): "main" | string {
  const raw = agentId?.trim() || agentType?.trim();
  if (!raw || raw === "main") {
    return "main";
  }
  if (raw.startsWith("eco_")) {
    return raw.slice("eco_".length);
  }
  return raw;
}
