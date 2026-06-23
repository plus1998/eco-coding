import {
  defaultSubagentAvailability,
  ecoSubagentKeyForRole,
  isSubagentEnabled,
  listEnabledSubagents,
  SDK_GENERAL_PURPOSE_AGENT_KEY,
  SDK_PLAN_AGENT_KEY,
  type SubagentAvailability,
  type SubagentRole,
} from "../subagent-availability.js";
import type { MainAgentHandsOnCapability } from "../agent-orchestration.js";

/**
 * Hands-on boundary for the main orchestrator, derived from the active profile tool policy.
 * The prompt must state the same rules the Eco PreToolUse policy hook enforces, so the
 * model never has to discover them through denied tool calls.
 */
export function buildMainAgentHandsOnBoundaryAppend(
  capability: MainAgentHandsOnCapability,
  availability: SubagentAvailability = defaultSubagentAvailability(),
  options: { delegateTarget?: string } = {},
): string {
  const coderEnabled = isSubagentEnabled(availability, "coder");
  const coderTarget =
    options.delegateTarget ??
    (coderEnabled ? agentCall("coder") : `Agent(${SDK_GENERAL_PURPOSE_AGENT_KEY})`);
  const lines: string[] = ["Hands-on boundary (enforced by Eco tool policy):"];
  if (capability.canEditFiles) {
    lines.push(
      "- You may edit files directly. Prefer direct edits for small, localized changes (a focused fix within 1-2 files, config/copy/type tweaks).",
      ...(coderEnabled
        ? [`- Delegate larger or parallelizable implementation to ${coderTarget} when that helps.`]
        : []),
      "- Do not revert changes you did not make. If you see unexpected edits you did not make, STOP and report them.",
      "- Never use destructive git commands (`git reset --hard`, `git checkout --`) unless explicitly requested.",
    );
  } else {
    lines.push(
      `- Filesystem writes (Write/Edit) are DISABLED for you. Do not attempt them; every code change must be delegated to ${coderTarget}.`,
    );
  }
  if (capability.canRunBash) {
    lines.push("- You may run shell commands via Bash.");
  } else {
    lines.push(
      `- Bash is DISABLED for you. Do not attempt it; have ${coderTarget} run commands and report results.`,
    );
  }
  return lines.join("\n");
}

function agentCall(role: SubagentRole): string {
  return `Agent(${ecoSubagentKeyForRole(role)})`;
}

/** Shared rule: Eco role delegation must use Eco subagent keys; SDK built-in exceptions are explicit. */
export function formatMandatoryEcoSubagentRule(options: { allowPlanAgent?: boolean } = {}): string {
  const blockedExamples = options.allowPlanAgent ? "Explore, Bash" : "Explore, Plan, Bash";
  return [
    "Mandatory subagent policy: when delegating to an Eco role via Agent(), set subagent_type to the exact eco_* key for that role.",
    `Allowed SDK built-in exception: Agent(${SDK_GENERAL_PURPOSE_AGENT_KEY}) for complex, multi-step tasks that require both exploration and action.`,
    ...(options.allowPlanAgent
      ? [
          `Plan Mode exception: Agent(${SDK_PLAN_AGENT_KEY}) is also allowed for read-only codebase research before ExitPlanMode.`,
        ]
      : []),
    `Do not use other SDK built-in agents (e.g. ${blockedExamples}), plain role names (coder/reviewer/explore/...), or Agent(<role>).`,
  ].join(" ");
}

export function formatAvailableSubagentsLine(
  availability: SubagentAvailability,
  options: { allowPlanAgent?: boolean } = {},
): string {
  const enabled = listEnabledSubagents(availability);
  const names = enabled.map((role) => `${role}: ${ecoSubagentKeyForRole(role)}`).join(", ");
  return [
    `Available Eco subagents in this session: ${names}.`,
    `Available SDK built-in subagent: ${SDK_GENERAL_PURPOSE_AGENT_KEY} (inherits the main conversation model and all tools).`,
    ...(options.allowPlanAgent
      ? [
          `Available SDK Plan Mode subagent: ${SDK_PLAN_AGENT_KEY} (inherits the main conversation model; read-only).`,
        ]
      : []),
    formatMandatoryEcoSubagentRule(options),
  ].join("\n");
}

export function buildQuestionExploreInstruction(availability: SubagentAvailability): string {
  return isSubagentEnabled(availability, "explore")
    ? `For broad codebase questions, use ${agentCall("explore")} with thoroughness quick|medium|very thorough.`
    : `For broad codebase questions, use Read, Glob, and Grep — do not call ${agentCall("explore")}.`;
}

export function buildQuestionAnswerTaskLine(availability: SubagentAvailability): string {
  return isSubagentEnabled(availability, "explore")
    ? `Task: Answer read-only. Use ${agentCall("explore")} if the question requires repo-wide context.`
    : "Task: Answer read-only. Use Read/Glob/Grep for repo-wide context.";
}
