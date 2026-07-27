import {
  defaultSubagentAvailability,
  ecoSubagentKeyForRole,
  isSubagentEnabled,
  SDK_GENERAL_PURPOSE_AGENT_KEY,
  type SubagentAvailability,
  type SubagentRole,
} from "../subagent-availability.js";
import type { MainAgentHandsOnCapability } from "../agent-orchestration.js";

/**
 * Hands-on boundary for the main orchestrator, derived from the active orchestration tool policy.
 * The prompt must state the same rules the Eco PreToolUse policy enforces, so the
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
