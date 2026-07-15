import type { EcoToolPolicy } from "./agent-orchestration.js";
import {
  SDK_DELEGATION_SUPPORT_TOOL_NAMES,
  SDK_FILESYSTEM_READ_TOOL_NAMES,
  SDK_FILESYSTEM_WRITE_TOOL_NAMES,
  SDK_SKILL_TOOL_NAME,
  SDK_TASK_PROGRESS_TOOL_NAMES,
} from "./sdk-tool-names.js";

function uniqueToolPatterns(patterns: readonly string[]): string[] {
  return [...new Set(patterns.map((pattern) => pattern.trim()).filter(Boolean))];
}

const ECO_PHASE_CAPPED_TOOL_NAMES = [
  "Agent",
  "Task",
  ...SDK_DELEGATION_SUPPORT_TOOL_NAMES,
  SDK_SKILL_TOOL_NAME,
  ...SDK_FILESYSTEM_READ_TOOL_NAMES,
  ...SDK_FILESYSTEM_WRITE_TOOL_NAMES,
  "Bash",
  "WebSearch",
  "WebFetch",
  "AskUserQuestion",
  "Workflow",
  ...SDK_TASK_PROGRESS_TOOL_NAMES,
] as const;

/**
 * Expands explicit Eco structured flags into bare `disallowed` tool names.
 * Product rule: enforcement is driven by `disallowed`; structured fields only
 * materialize into that list (see docs/agent-sdk-tools-and-permissions.md).
 */
export function materializeEcoToolPolicy(policy: EcoToolPolicy): EcoToolPolicy {
  const allowedTools = Array.isArray(policy.allowed) ? policy.allowed : [];
  const disallowedTools = Array.isArray(policy.disallowed) ? policy.disallowed : [];
  const disallowed = new Set(disallowedTools.map((entry) => entry.trim()).filter(Boolean));

  if (policy.bash?.enabled === false) {
    disallowed.add("Bash");
  }
  if (policy.filesystem?.read === "none") {
    for (const tool of SDK_FILESYSTEM_READ_TOOL_NAMES) {
      disallowed.add(tool);
    }
  }
  if (policy.filesystem?.write === "none") {
    for (const tool of SDK_FILESYSTEM_WRITE_TOOL_NAMES) {
      disallowed.add(tool);
    }
  }
  if (policy.network?.webSearch === false) {
    disallowed.add("WebSearch");
  }
  if (policy.network?.webFetch === false) {
    disallowed.add("WebFetch");
  }
  if (policy.skills?.enabled === false) {
    disallowed.add("Skill");
  }
  if (policy.interaction?.askUser === false) {
    disallowed.add("AskUserQuestion");
  }
  if (policy.taskProgress?.enabled === false) {
    for (const tool of SDK_TASK_PROGRESS_TOOL_NAMES) disallowed.add(tool);
  }
  if (policy.delegation?.enabled === false) {
    disallowed.add("Agent");
    disallowed.add("Task");
    for (const tool of SDK_DELEGATION_SUPPORT_TOOL_NAMES) disallowed.add(tool);
  }
  for (const tool of policy.coreOverrides?.claude?.disallowedTools ?? []) {
    const trimmed = tool.trim();
    if (trimmed) disallowed.add(trimmed);
  }

  const bashAllowed = !disallowed.has("Bash") && policy.bash?.enabled !== false;

  const materialized: EcoToolPolicy = {
    ...policy,
    allowed: uniqueToolPatterns(allowedTools),
    disallowed: uniqueToolPatterns([...disallowed]),
    bash: {
      enabled: bashAllowed,
    },
    ...(policy.filesystem ? { filesystem: { ...policy.filesystem } } : {}),
    ...(policy.network ? { network: { ...policy.network } } : {}),
    ...(policy.mcp ? { mcp: { ...policy.mcp } } : {}),
    ...(policy.skills ? { skills: { ...policy.skills } } : {}),
    ...(policy.interaction ? { interaction: { ...policy.interaction } } : {}),
    ...(policy.taskProgress ? { taskProgress: { ...policy.taskProgress } } : {}),
    ...(policy.delegation ? { delegation: { ...policy.delegation } } : {}),
    ...(policy.coreOverrides ? {
      coreOverrides: {
        ...(policy.coreOverrides.claude ? {
          claude: { disallowedTools: [...policy.coreOverrides.claude.disallowedTools] },
        } : {}),
        ...(policy.coreOverrides.codex ? { codex: { ...policy.coreOverrides.codex } } : {}),
      },
    } : {}),
  };
  return materialized;
}

export function isToolDisallowed(toolName: string, policy: EcoToolPolicy): boolean {
  const materialized = materializeEcoToolPolicy(policy);
  const disallowed = new Set(materialized.disallowed.map((entry) => entry.trim()));
  return disallowed.has(toolName.trim());
}

/** Phase caps: tools not in the phase allow-list are added to `disallowed`. */
export function capEcoToolPolicyForPhase(
  base: EcoToolPolicy,
  phaseAllowedTools: readonly string[],
): EcoToolPolicy {
  const materialized = materializeEcoToolPolicy(base);
  const allowedSet = new Set(phaseAllowedTools);
  const phaseDisallowed: string[] = [];

  for (const tool of ECO_PHASE_CAPPED_TOOL_NAMES) {
    if (!allowedSet.has(tool)) {
      phaseDisallowed.push(tool);
    }
  }

  return materializeEcoToolPolicy({
    ...materialized,
    allowed: [],
    disallowed: uniqueToolPatterns([...materialized.disallowed, ...phaseDisallowed]),
  });
}

/** SDK availability layer: bare names removed from model context. */
export function mergeSdkDisallowedTools(...lists: readonly (readonly string[] | undefined)[]): string[] {
  const merged: string[] = [];
  for (const list of lists) {
    if (!list) {
      continue;
    }
    for (const tool of list) {
      const trimmed = tool.trim();
      if (trimmed) {
        merged.push(trimmed);
      }
    }
  }
  return uniqueToolPatterns(merged);
}

export function resolveMainAgentHandsOnFromPolicy(policy: EcoToolPolicy): {
  canEditFiles: boolean;
  canRunBash: boolean;
} {
  const materialized = materializeEcoToolPolicy(policy);
  const disallowed = new Set(materialized.disallowed.map((entry) => entry.trim()));
  const writeDisallowed = SDK_FILESYSTEM_WRITE_TOOL_NAMES.every((tool) => disallowed.has(tool));
  return {
    canEditFiles: !writeDisallowed,
    canRunBash: !disallowed.has("Bash"),
  };
}
