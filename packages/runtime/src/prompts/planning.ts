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
    "You are in Plan Mode (session start).",
    "",
    "Required workflow (explore before ExitPlanMode — same assistant turn is allowed):",
    `1. Explore the repository first (${explore}).`,
    "2. For facts outside the repo (docs, API versions, third-party behavior), use WebSearch and WebFetch after step 1 — not instead of it.",
    "3. If material ambiguity remains, call AskUserQuestion — do not ask things discoverable from the repo.",
    "4. When the spec is decision-complete, present the full Markdown plan and call `ExitPlanMode`.",
    "Do not use Write/Edit/MultiEdit to create a plan file; Claude Code persists the plan internally and injects it into ExitPlanMode hooks.",
    "",
    "You may complete exploration, clarification, and plan submission in one assistant turn as long as exploration runs before `ExitPlanMode`.",
    "Optional: brief analysis summary in plain text after exploration.",
    "Do not implement or produce ## Coder Tasks.",
  ].join("\n");
}

/** Follow-up turns in the same Plan Mode SDK session (e.g. after user dismisses approval in Eco). */
export function buildPlanningContinuationPrompt(
  userPrompt: string,
  availability: SubagentAvailability = defaultSubagentAvailability(),
): string {
  return [
    "User follow-up (same Plan Mode session):",
    userPrompt.trim(),
    "",
    `You are still in Eco Plan Mode. ${buildPlanningContinuationExploreHint(availability)}`,
    "",
    "When the spec is decision-complete, present a **complete replacement** Markdown plan and call `ExitPlanMode` once (not a delta patch).",
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
