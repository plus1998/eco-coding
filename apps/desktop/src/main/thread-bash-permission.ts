import type { EcoAgentRuntimeConfig } from "@eco/runtime";
import { materializeEcoToolPolicy, resolveEffectiveBashPolicy } from "@eco/runtime";
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
  phaseAllowsBash?: boolean;
}

export function evaluateThreadBashPermission(input: ThreadBashPermissionInput): BashPolicyDecision {
  if (input.phaseAllowsBash === false) {
    return {
      action: "deny",
      reason: "Bash is disabled for this Eco agent.",
      riskScore: 100,
      riskLevel: "critical",
      matchedRule: "phase_bash_disabled",
    };
  }
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
): ReturnType<typeof resolveEffectiveBashPolicy> {
  const actor = resolveBashPolicyActor(agentId, agentType);
  if (actor === "main") {
    return resolveEffectiveBashPolicy(materializeEcoToolPolicy(profile.mainAgent.tools));
  }
  const agent = profile.agents.find((entry) => entry.agentKey === actor);
  if (!agent) {
    return resolveEffectiveBashPolicy(materializeEcoToolPolicy(profile.mainAgent.tools));
  }
  const template = templates.find((entry) => entry.id === agent.templateId);
  const policy =
    agent.tools.bash !== undefined ||
    agent.tools.allowed.length > 0 ||
    agent.tools.disallowed.some((entry) => entry.trim() === "Bash")
      ? agent.tools
      : (template?.defaultTools ?? profile.mainAgent.tools);
  return resolveEffectiveBashPolicy(materializeEcoToolPolicy(policy));
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
