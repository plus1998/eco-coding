/** Short orchestrator rules for autonomous mode — routing lives in subagent descriptions. */

export const autonomousOrchestratorAppend = [
  "Eco autonomous orchestration: you are the Planner. Judge task risk and delegate with Agent(<role>).",
  "Low risk: explore → coder → tester. Medium: add your own read-only review before tester (do not call reviewer).",
  "High risk: explore → coder → reviewer → tester; call finalize_plan when the user should approve before large changes.",
  "Do not use the SDK Workflow tool.",
].join("\n");

export function buildAutonomousOrchestratorAppend(): string {
  return autonomousOrchestratorAppend;
}

export function buildAutonomousPlanContinuationPrompt(input: {
  userPrompt: string;
  analysis: string;
  plan: string;
  followUp?: string;
}): string {
  const lines = [
    "<system-reminder>",
    "The user approved your submitted plan. Continue in the same session and implement it.",
    "Use Agent(role) as needed; do not restart planning from scratch unless blocked.",
    "</system-reminder>",
    "",
    "User request:",
    input.userPrompt.trim(),
    "",
    "Approved analysis:",
    input.analysis.trim() || "(none)",
    "",
    "Approved plan:",
    input.plan.trim() || "(none)",
  ];
  const followUp = input.followUp?.trim();
  if (followUp && followUp !== input.userPrompt.trim()) {
    lines.push("", "Latest user message:", followUp);
  }
  return lines.join("\n");
}
