export function buildAutonomousPlanContinuationPrompt(input: {
  userPrompt: string;
  analysis: string;
  plan: string;
  planUserEdited?: boolean;
  followUp?: string;
  isResume?: boolean;
}): string {
  const includePlanText = input.planUserEdited === true || input.isResume === false;
  const followUp = input.followUp?.trim();
  if (!includePlanText) {
    return followUp && followUp !== input.userPrompt.trim() ? followUp : "Implement the plan.";
  }
  const lines = ["Implement the following approved plan:", "", input.plan.trim() || "(none)"];
  if (includePlanText) {
    const userPrompt = input.userPrompt.trim();
    if (userPrompt) lines.push("", "Original user request:", userPrompt);
  }
  if (followUp && followUp !== input.userPrompt.trim()) {
    lines.push("", "Latest user message:", followUp);
  }
  return lines.join("\n");
}
