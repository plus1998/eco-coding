import type { PromptImageAttachment, ThreadPendingFollowUp, ThreadStatus } from "./ipc";

const DRAINABLE_FOLLOW_UP_STATUSES = ["completed", "failed", "blocked", "awaiting_plan"] as const;

export function shouldDrainThreadFollowUps(status: ThreadStatus): boolean {
  return (DRAINABLE_FOLLOW_UP_STATUSES as readonly string[]).includes(status);
}

/** Block auto-drain while plan approval or clarification is still waiting on the user. */
export function shouldBlockThreadFollowUpDrain(input: {
  hasPendingBridgeApproval: boolean;
  hasPendingClarification: boolean;
  hasEditingFollowUp?: boolean;
  threadStatus?: ThreadStatus;
  hasStoredPendingPlan: boolean;
}): boolean {
  if (input.hasPendingBridgeApproval || input.hasPendingClarification || input.hasEditingFollowUp) {
    return true;
  }
  return input.threadStatus === "awaiting_plan" && input.hasStoredPendingPlan;
}

export function buildThreadFollowUpDisplayPrompt(followUps: readonly ThreadPendingFollowUp[]): string {
  const next = nextDeliveredFollowUp(followUps);
  return next ? normalizeFollowUpPrompt(next) : "";
}

export function buildThreadFollowUpDrainPrompt(followUps: readonly ThreadPendingFollowUp[]): string {
  const next = nextDeliveredFollowUp(followUps);
  return next ? normalizeFollowUpPrompt(next) : "";
}

export function collectThreadFollowUpAttachments(
  followUps: readonly ThreadPendingFollowUp[],
): PromptImageAttachment[] {
  return [...(nextDeliveredFollowUp(followUps)?.attachments ?? [])];
}

function nextDeliveredFollowUp(
  followUps: readonly ThreadPendingFollowUp[],
): ThreadPendingFollowUp | undefined {
  return followUps.find((followUp) => followUp.status === "delivered");
}

function normalizeFollowUpPrompt(followUp: ThreadPendingFollowUp): string {
  const prompt = followUp.prompt.trim();
  if (prompt) {
    return prompt;
  }
  const imageCount = followUp.attachments?.length ?? 0;
  return imageCount > 0 ? `请查看并分析我附上的 ${imageCount} 张图片。` : "请继续。";
}
