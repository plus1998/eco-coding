import type { EcoToolPolicy } from "./agent-orchestration.js";
import {
  SDK_FILESYSTEM_READ_TOOL_NAMES,
  SDK_FILESYSTEM_WRITE_TOOL_NAMES,
} from "./agent-orchestration.js";

function uniqueToolPatterns(patterns: readonly string[]): string[] {
  return [...new Set(patterns.map((pattern) => pattern.trim()).filter(Boolean))];
}

function hasAnyToolPattern(allowed: ReadonlySet<string>, tools: readonly string[]): boolean {
  return tools.some((tool) => allowed.has(tool));
}

/**
 * Expands explicit Eco structured flags into bare `disallowed` tool names.
 * Product rule: enforcement is driven by `disallowed`; structured fields only
 * materialize into that list (see docs/agent-sdk-tools-and-permissions.md).
 */
export function materializeEcoToolPolicy(policy: EcoToolPolicy): EcoToolPolicy {
  const disallowed = new Set(policy.disallowed.map((entry) => entry.trim()).filter(Boolean));

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

  const bashAllowed = !disallowed.has("Bash") && policy.bash?.enabled !== false;
  const commandAllowlist = policy.bash?.commandAllowlist;
  const commandDenylist = policy.bash?.commandDenylist;

  const materialized: EcoToolPolicy = {
    ...policy,
    allowed: uniqueToolPatterns(policy.allowed),
    disallowed: uniqueToolPatterns([...disallowed]),
    bash: {
      enabled: bashAllowed,
      ...(bashAllowed && commandAllowlist?.length ? { commandAllowlist: [...commandAllowlist] } : {}),
      ...(bashAllowed && commandDenylist?.length ? { commandDenylist: [...commandDenylist] } : {}),
    },
    ...(policy.filesystem ? { filesystem: { ...policy.filesystem } } : {}),
    ...(policy.network ? { network: { ...policy.network } } : {}),
    ...(policy.mcp ? { mcp: { ...policy.mcp } } : {}),
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

  if (!allowedSet.has("Bash")) {
    phaseDisallowed.push("Bash");
  }
  for (const tool of SDK_FILESYSTEM_WRITE_TOOL_NAMES) {
    if (!hasAnyToolPattern(allowedSet, [tool])) {
      phaseDisallowed.push(tool);
    }
  }
  if (materialized.network?.webSearch !== false && !allowedSet.has("WebSearch")) {
    phaseDisallowed.push("WebSearch");
  }
  if (materialized.network?.webFetch !== false && !allowedSet.has("WebFetch")) {
    phaseDisallowed.push("WebFetch");
  }

  return materializeEcoToolPolicy({
    ...materialized,
    allowed: [],
    disallowed: uniqueToolPatterns([...materialized.disallowed, ...phaseDisallowed]),
  });
}

/** SDK availability layer: bare names removed from model context. */
export function mergeSdkDisallowedTools(
  ...lists: readonly (readonly string[] | undefined)[]
): string[] {
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
