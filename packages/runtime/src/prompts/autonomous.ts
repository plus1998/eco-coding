/** Short orchestrator rules for autonomous mode — routing lives in subagent descriptions. */

import { ecoSubagentKeyForRole } from "../subagent-availability.js";
import { formatMandatoryEcoSubagentRule } from "./subagent-pipeline.js";

const ecoExplore = ecoSubagentKeyForRole("explore");
const ecoCoder = ecoSubagentKeyForRole("coder");
const ecoReviewer = ecoSubagentKeyForRole("reviewer");
const ecoTester = ecoSubagentKeyForRole("tester");

export const autonomousOrchestratorAppend = [
  [
    "Eco autonomous orchestration: you are the Planner. Judge task scope and delegate with Eco Agent keys:",
    `explore=${ecoExplore}, coder=${ecoCoder}, reviewer=${ecoReviewer}, tester=${ecoTester}.`,
  ].join(" "),
  formatMandatoryEcoSubagentRule(),
  [
    "Clarify vs plan (separate tools): After exploration, use AskUserQuestion for material ambiguity",
    "(preferences, scope, tradeoffs) that the repo cannot resolve — do not substitute a full plan for targeted questions.",
    "Do not call ExitPlanMode or finalize_plan in this mode; handle the task directly after the spec is clear.",
  ].join(" "),
  `Low risk: ${ecoExplore} → ${ecoCoder} → ${ecoTester}. Medium: add your own read-only review before ${ecoTester} (do not call ${ecoReviewer}).`,
  `High risk: ${ecoExplore} → ${ecoCoder} → ${ecoReviewer} → ${ecoTester}.`,
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
    "Use the Eco Agent keys as needed; do not restart planning from scratch unless blocked.",
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
