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

/** Follow-up turns in the same Plan Mode SDK session (e.g. after user dismisses approval in Eco). */
export function buildPlanningContinuationPrompt(userPrompt: string): string {
  return [
    "User follow-up (same Plan Mode session — not turn 1):",
    userPrompt.trim(),
    "",
    "You are still in Eco Plan Mode. Incorporate this message; explore or AskUserQuestion if material ambiguity remains.",
    "",
    "When the spec is decision-complete, output optional `## Analysis Result` / `## 分析结果` then a **complete replacement**",
    "`## Implementation Plan` / `## 实现计划` (full plan, not a delta patch vs any earlier draft).",
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
