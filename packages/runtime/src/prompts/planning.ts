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
    "Use WebSearch/WebFetch only for facts outside the repo.",
    "",
    "Before proposing a plan, ensure you understand: the goal, success criteria, scope boundaries, constraints, and key tradeoffs.",
    "Use `AskUserQuestion` proactively when any high-impact ambiguity remains — do not guess. Ask after exploring, not before.",
    "Each question must materially change the plan, confirm an assumption, or choose between meaningful tradeoffs.",
    "When asking, include enough context for the user to make an informed decision. Explain the consequence of each option.",
    "",
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
    "If the user's follow-up reveals new ambiguity, explore first then ask targeted questions before updating the plan.",
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
