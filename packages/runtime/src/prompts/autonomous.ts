/** Short orchestrator rules for autonomous mode — routing lives in subagent descriptions. */

import { formatMandatoryEcoSubagentRule, formatAvailableSubagentsLine } from "./subagent-pipeline.js";
import { defaultSubagentAvailability, SDK_GENERAL_PURPOSE_AGENT_KEY } from "../subagent-availability.js";

export const autonomousOrchestratorAppend = [
  "Eco orchestration: you are the main agent for this thread.",
  formatMandatoryEcoSubagentRule(),
  formatAvailableSubagentsLine(defaultSubagentAvailability()),
  [
    "Delegate to enabled Eco subagents only when their descriptions fit the task.",
    "Do not force a fixed subagent order or mandatory review/test passes.",
  ].join(" "),
  [
    "Clarify vs plan: use AskUserQuestion for material ambiguity",
    "(preferences, scope, tradeoffs) that the repo cannot resolve.",
    "Use ExitPlanMode only when a formal plan needs user approval before implementation.",
  ].join(" "),
  `SDK Agent(${SDK_GENERAL_PURPOSE_AGENT_KEY}) is available for complex multi-step work that requires both exploration and action.`,
  "Do not declare the task complete until the requested scope is implemented and you have proportionate verification evidence.",
  "Do not use the SDK Workflow tool.",
].join("\n");

export function buildAutonomousOrchestratorAppend(): string {
  return autonomousOrchestratorAppend;
}

export function buildAutonomousPlanContinuationPrompt(input: {
  userPrompt: string;
  analysis: string;
  plan: string;
  planUserEdited?: boolean;
  followUp?: string;
}): string {
  const lines = [
    "<system-reminder>",
    "The user approved your submitted plan. Continue in the same session and implement it.",
    "Use enabled Eco subagents when helpful; do not restart planning from scratch unless blocked.",
    "</system-reminder>",
    "",
    input.planUserEdited
      ? "The user edited the plan in Eco before approval. Treat the approved plan below as authoritative."
      : "Use the approved plan already submitted in this SDK session. Do not ask the user to paste the plan again.",
  ];
  if (input.planUserEdited) {
    lines.push(
      "",
      "User request:",
      input.userPrompt.trim(),
      "",
      "Approved analysis:",
      input.analysis.trim() || "(none)",
      "",
      "Approved plan:",
      input.plan.trim() || "(none)",
    );
  }
  const followUp = input.followUp?.trim();
  if (followUp && followUp !== input.userPrompt.trim()) {
    lines.push("", "Latest user message:", followUp);
  }
  return lines.join("\n");
}
