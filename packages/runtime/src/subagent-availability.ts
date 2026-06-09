export const SUBAGENT_ROLES = ["explore", "architect", "coder", "reviewer", "tester"] as const;

/** Legacy SDK built-in explore key accepted for old sessions/tool calls. */
export const SDK_EXPLORE_AGENT_KEY = "Explore";

/** Official Claude SDK built-in agent Eco allows through unchanged. */
export const SDK_GENERAL_PURPOSE_AGENT_KEY = "general-purpose";

/** Official Claude SDK built-in research agent available during Plan Mode. */
export const SDK_PLAN_AGENT_KEY = "Plan";

/**
 * Built-in subagent keys Claude Agent SDK injects into session init and the Agent/Task schema.
 * @see https://github.com/anthropics/claude-agent-sdk-typescript/issues/87
 */
export const SDK_BUILTIN_SUBAGENT_NAMES = [
  SDK_GENERAL_PURPOSE_AGENT_KEY,
  "statusline-setup",
  "Explore",
  SDK_PLAN_AGENT_KEY,
  "Bash",
] as const;

/** SDK built-ins that remain blocked because Eco does not expose them as user-selectable agents. */
export const SDK_BLOCKED_BUILTIN_SUBAGENT_NAMES = [
  "statusline-setup",
  "Explore",
  SDK_PLAN_AGENT_KEY,
  "Bash",
] as const;

export function sdkBuiltinSubagentDenyRules(allowedBuiltins: readonly string[] = []): readonly string[] {
  const allowed = new Set([SDK_GENERAL_PURPOSE_AGENT_KEY, ...allowedBuiltins]);
  return SDK_BLOCKED_BUILTIN_SUBAGENT_NAMES.filter((name) => !allowed.has(name)).map(
    (name) => `Agent(${name})`,
  );
}

export type SubagentRole = (typeof SUBAGENT_ROLES)[number];

export const ECO_SUBAGENT_KEY_BY_ROLE = {
  explore: "eco_explore",
  architect: "eco_architect",
  coder: "eco_coder",
  reviewer: "eco_reviewer",
  tester: "eco_tester",
} as const satisfies Record<SubagentRole, string>;

export type EcoSubagentKey = (typeof ECO_SUBAGENT_KEY_BY_ROLE)[SubagentRole];

export function ecoSubagentKeyForRole(role: SubagentRole): EcoSubagentKey {
  return ECO_SUBAGENT_KEY_BY_ROLE[role];
}

export type EcoOrchestrationMode = "autonomous" | "manual";

/** @deprecated Use autonomous | manual */
export type LegacyEcoOrchestrationMode = "analyze_plan_execute" | "sdk_default";

export function normalizeEcoOrchestrationMode(
  mode: EcoOrchestrationMode | LegacyEcoOrchestrationMode,
): EcoOrchestrationMode {
  if (mode === "analyze_plan_execute") {
    return "manual";
  }
  if (mode === "sdk_default") {
    return "autonomous";
  }
  return mode;
}

export function isAutonomousOrchestration(mode: EcoOrchestrationMode): boolean {
  return mode === "autonomous";
}

export function isSubagentRole(role: string): role is SubagentRole {
  return (SUBAGENT_ROLES as readonly string[]).includes(role);
}

export type SubagentAvailability = Record<SubagentRole, boolean>;

export function defaultSubagentAvailability(): SubagentAvailability {
  return Object.fromEntries(SUBAGENT_ROLES.map((role) => [role, true])) as SubagentAvailability;
}

export function normalizeSubagentAvailability(
  input?: Partial<Record<SubagentRole, boolean>>,
): SubagentAvailability {
  const availability = defaultSubagentAvailability();
  if (!input) {
    return availability;
  }
  for (const role of SUBAGENT_ROLES) {
    if (typeof input[role] === "boolean") {
      availability[role] = input[role];
    }
  }
  return availability;
}

export function isSubagentEnabled(availability: SubagentAvailability, role: SubagentRole): boolean {
  return availability[role];
}

export function listEnabledSubagents(availability: SubagentAvailability): SubagentRole[] {
  return SUBAGENT_ROLES.filter((role) => availability[role]);
}

export function agentDefinitionAvailabilityRole(key: string): SubagentRole | undefined {
  if (key === SDK_EXPLORE_AGENT_KEY) {
    return "explore";
  }
  for (const role of SUBAGENT_ROLES) {
    if (key === ECO_SUBAGENT_KEY_BY_ROLE[role]) {
      return role;
    }
  }
  return isSubagentRole(key) ? key : undefined;
}

export function filterAgentDefinitions<T extends Record<string, unknown>>(
  definitions: T,
  availability: SubagentAvailability,
): Partial<T> {
  const filtered: Partial<T> = {};
  for (const [key, value] of Object.entries(definitions)) {
    const role = agentDefinitionAvailabilityRole(key);
    if (!role) {
      (filtered as Record<string, unknown>)[key] = value;
      continue;
    }
    if (availability[role]) {
      (filtered as Record<string, unknown>)[key] = value;
    }
  }
  return filtered;
}
