import { buildPlanningPhaseSystemAppend, planningPhaseSystemAppend } from "./eco-plan-adapter.js";

export { buildPlanningPhaseSystemAppend, planningPhaseSystemAppend };

export function buildPlanningPhasePrompt(userPrompt: string): string {
  return [
    "User request:",
    userPrompt.trim(),
    "",
    "You are in Plan Mode (session start — this is turn 1).",
    "",
    "Required for this turn:",
    "1. Explore the worktree first (Read / Glob / Grep and/or Agent(explore)).",
    "2. Call AskUserQuestion with material clarifications — do not skip because the request looks detailed.",
    "3. Do NOT output ## Implementation Plan or ## 实现计划 on this turn.",
    "",
    "Optional: brief ## Analysis Result after exploration.",
    "Final ## Implementation Plan only on a later turn after questions are resolved (see Eco turn-order rules in system context).",
    "Do not implement or produce ## Coder Tasks.",
  ].join("\n");
}

/** @deprecated Use buildPlanningPhasePrompt */
export function buildAnalyzePhasePrompt(userPrompt: string): string {
  return buildPlanningPhasePrompt(userPrompt);
}

/** @deprecated Use buildPlanningPhasePrompt */
export function buildPlanPhasePrompt(userPrompt: string, _analysis: string): string {
  return buildPlanningPhasePrompt(userPrompt);
}
