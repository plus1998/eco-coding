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
  if (!next) {
    return "";
  }
  const instruction = buildDrainInstruction(next);
  const label = next.priority === "escalated" ? "立即后续消息" : "后续消息";
  return `${instruction}\n\n${label}${formatFollowUpMetadata(next)}：\n${normalizeFollowUpPrompt(next)}`;
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

function buildDrainInstruction(followUp: ThreadPendingFollowUp): string {
  const forced = followUp.deliveryBoundary === "forced_interrupt";
  return [
    forced
      ? "以下是用户要求立即处理的后续消息，当前运行已在清理后恢复。"
      : "以下是用户在运行过程中追加的后续消息，当前已到达安全处理边界。",
    "请先判断用户意图：如果只是询问状态或进展，简洁回答当前进展，不要重规划；如果要求继续并增加约束，将其合并到后续执行；如果要求停止、换方向、先别做某部分或重新规划，先明确调整计划再继续。",
  ].join("\n");
}

function formatFollowUpMetadata(followUp: ThreadPendingFollowUp): string {
  const parts = [
    followUp.queuedDuringPhase ? `queuedDuringPhase=${followUp.queuedDuringPhase}` : undefined,
    followUp.deliveryBoundary ? `boundary=${followUp.deliveryBoundary}` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}
