export const SUBAGENT_ROLES = ["explore", "architect", "coder", "reviewer", "tester"] as const;

export type SubagentRole = (typeof SUBAGENT_ROLES)[number];

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
  availability.coder = true;
  return availability;
}

export function isSubagentEnabled(availability: SubagentAvailability, role: SubagentRole): boolean {
  return availability[role];
}

export function listEnabledSubagents(availability: SubagentAvailability): SubagentRole[] {
  return SUBAGENT_ROLES.filter((role) => availability[role]);
}

export function filterAgentDefinitions<T extends Record<string, unknown>>(
  definitions: T,
  availability: SubagentAvailability,
): Partial<T> {
  const filtered: Partial<T> = {};
  for (const [key, value] of Object.entries(definitions)) {
    if (!SUBAGENT_ROLES.includes(key as SubagentRole)) {
      (filtered as Record<string, unknown>)[key] = value;
      continue;
    }
    if (availability[key as SubagentRole]) {
      (filtered as Record<string, unknown>)[key] = value;
    }
  }
  return filtered;
}
