/** Short orchestrator rules for autonomous mode — routing lives in subagent descriptions. */

export function buildAutonomousOrchestratorAppend(): string {
  return [
    "Delegate using enabled subagent descriptions; do not force a fixed review or test order.",
    "Do not use the SDK Workflow tool.",
  ].join("\n");
}

export function buildAutonomousPlanningAppend(): string {
  return [
    "Session starts in Claude Plan Mode.",
    "While Plan Mode is active, do not implement, edit files, run Bash, run tests, run builds, or delegate implementation.",
    "While Plan Mode is active, use read-only exploration and planning subagents only.",
    "Use AskUserQuestion when a missing user decision materially changes the plan.",
    "When the spec is decision-complete, submit a complete Markdown plan with ExitPlanMode.",
    "The ExitPlanMode tool input must include the complete plan in the `plan` field. Do not call ExitPlanMode with `{}` or only `allowedPrompts`.",
    "After the user approves ExitPlanMode, continue in this same session and implement the approved plan.",
    "Do not use the SDK Workflow tool.",
  ].join("\n");
}

export function buildAutonomousPlanContinuationPrompt(input: {
  userPrompt: string;
  analysis: string;
  plan: string;
  planUserEdited?: boolean;
  followUp?: string;
  isResume?: boolean;
}): string {
  const includePlanText = input.planUserEdited === true || input.isResume === false;
  const lines = [
    "<system-reminder>",
    "The user approved your submitted plan. Continue in the same session and implement it.",
    "Use enabled Eco subagents when helpful; do not restart planning from scratch unless blocked.",
    "</system-reminder>",
    "",
    includePlanText
      ? input.planUserEdited
        ? "The user edited the plan in Eco before approval. Treat the approved plan below as authoritative."
        : "No resumable SDK planning session is available. Treat the approved plan below as authoritative."
      : "Use the approved plan already submitted in this SDK session. Do not ask the user to paste the plan again.",
  ];
  if (includePlanText) {
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
