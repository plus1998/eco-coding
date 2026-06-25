/** Short orchestrator rules for autonomous mode — routing lives in subagent descriptions. */

export function buildAutonomousOrchestratorAppend(): string {
  return [
    "Delegate using enabled subagent descriptions; do not force a fixed review or test order.",
    "Do not use the SDK Workflow tool.",
  ].join("\n");
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
