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
    "Use Claude Code native Plan Mode. Explore the repository as needed before proposing changes.",
    `Available planning exploration tools include ${explore}.`,
    "Use WebSearch/WebFetch only for facts outside the repo. Use AskUserQuestion only for material ambiguity.",
    "When the spec is decision-complete, present the full Markdown plan and call `ExitPlanMode`.",
    "Do not use Write/Edit/MultiEdit to create a plan file; Claude Code persists the plan internally and injects it into ExitPlanMode hooks.",
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
    `Continue using Claude Code native Plan Mode. ${buildPlanningContinuationExploreHint(availability)}`,
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
