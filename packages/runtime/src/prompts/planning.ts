import type { SubagentAvailability } from "../subagent-availability.js";
import { defaultSubagentAvailability } from "../subagent-availability.js";
import { buildPlanningPhaseSystemAppend, planningPhaseSystemAppend } from "./eco-plan-adapter.js";
import {
  buildPlanningContinuationExploreHint,
  buildPlanningExploreInstruction,
} from "./subagent-pipeline.js";

export { buildPlanningPhaseSystemAppend, planningPhaseSystemAppend };

export function buildPlanningPhasePrompt(
  userPrompt: string,
  availability: SubagentAvailability = defaultSubagentAvailability(),
): string {
  const explore = buildPlanningExploreInstruction(availability);
  return [
    "User request:",
    userPrompt.trim(),
    "",
    "You are in Plan Mode (session start — this is turn 1).",
    "",
    "Required for this turn:",
    `1. Explore the worktree first (${explore}).`,
    "2. Call AskUserQuestion with material clarifications — do not skip because the request looks detailed.",
    "3. Do NOT call FinalizePlan on this turn.",
    "",
    "Optional: brief analysis summary in plain text after exploration.",
    "Final plan submission is only allowed on a later turn via FinalizePlan (see Eco turn-order rules in system context).",
    "Do not implement or produce ## Coder Tasks.",
  ].join("\n");
}

/** Follow-up turns in the same Plan Mode SDK session (e.g. after user dismisses approval in Eco). */
export function buildPlanningContinuationPrompt(
  userPrompt: string,
  availability: SubagentAvailability = defaultSubagentAvailability(),
): string {
  return [
    "User follow-up (same Plan Mode session — not turn 1):",
    userPrompt.trim(),
    "",
    `You are still in Eco Plan Mode. ${buildPlanningContinuationExploreHint(availability)}`,
    "",
    "When the spec is decision-complete, call `FinalizePlan` once with a **complete replacement** plan (not a delta patch).",
    "FinalizePlan input must include `analysis` and `plan` as full strings.",
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
