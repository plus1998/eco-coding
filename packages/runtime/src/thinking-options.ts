export type ThinkingEffort = "off" | "low" | "medium" | "high" | "xhigh" | "max";

const EFFORT_LEVELS = new Set<ThinkingEffort>(["low", "medium", "high", "xhigh", "max"]);

export function isThinkingEffort(value: string): value is ThinkingEffort {
  return value === "off" || EFFORT_LEVELS.has(value as ThinkingEffort);
}

export interface ThinkingQueryPatch {
  effort?: ThinkingEffort;
  thinking?: { type: "disabled" } | { type: "adaptive" };
  effortLevel?: ThinkingEffort;
  claudeCodeEffortLevel?: ThinkingEffort;
}

/** Apply thinking / effort options for Claude Agent SDK query() and upstream Messages API. */
export function buildThinkingQueryPatch(effort: ThinkingEffort | undefined): ThinkingQueryPatch {
  if (!effort) {
    return {};
  }
  if (effort === "off") {
    return { thinking: { type: "disabled" } };
  }
  return {
    effort,
    thinking: { type: "adaptive" },
    effortLevel: effort,
    claudeCodeEffortLevel: effort,
  };
}

export function applyThinkingToQueryOptions(
  queryOptions: Record<string, unknown>,
  effort: ThinkingEffort | undefined,
): void {
  const patch = buildThinkingQueryPatch(effort);
  if (patch.thinking) {
    queryOptions.thinking = patch.thinking;
  }
  if (patch.effort) {
    queryOptions.effort = patch.effort;
  }
  if (patch.effortLevel) {
    const settings = isRecord(queryOptions.settings) ? queryOptions.settings : {};
    queryOptions.settings = { ...settings, effortLevel: patch.effortLevel };
  }
}

export function applyThinkingToMessagesBody(
  body: Record<string, unknown>,
  effort: ThinkingEffort | undefined,
): void {
  if (!effort || body.thinking !== undefined || body.effort !== undefined) {
    return;
  }
  const patch = buildThinkingQueryPatch(effort);
  if (patch.thinking) {
    body.thinking = patch.thinking;
  }
  if (patch.effort) {
    body.effort = patch.effort;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function applyThinkingToProcessEnv(
  env: Record<string, string>,
  effort: ThinkingEffort | undefined,
): void {
  const patch = buildThinkingQueryPatch(effort);
  if (patch.claudeCodeEffortLevel) {
    env.CLAUDE_CODE_EFFORT_LEVEL = patch.claudeCodeEffortLevel;
  }
}
