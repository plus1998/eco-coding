import type { PromptImageAttachment, ThreadPendingFollowUp, ThreadStatus } from "./ipc";

const DRAINABLE_FOLLOW_UP_STATUSES = ["completed", "failed", "blocked", "awaiting_plan"] as const;

export function shouldDrainThreadFollowUps(status: ThreadStatus): boolean {
  return (DRAINABLE_FOLLOW_UP_STATUSES as readonly string[]).includes(status);
}

export function buildThreadFollowUpDrainPrompt(followUps: readonly ThreadPendingFollowUp[]): string {
  const queued = followUps.filter((followUp) => followUp.status === "delivered");
  if (queued.length === 0) {
    return "";
  }
  if (queued.length === 1) {
    return normalizeFollowUpPrompt(queued[0]!);
  }
  return queued
    .map((followUp, index) => {
      const label = followUp.priority === "escalated" ? "立即后续消息" : "后续消息";
      return `${label} ${index + 1}：\n${normalizeFollowUpPrompt(followUp)}`;
    })
    .join("\n\n");
}

export function collectThreadFollowUpAttachments(
  followUps: readonly ThreadPendingFollowUp[],
): PromptImageAttachment[] {
  const attachments: PromptImageAttachment[] = [];
  for (const followUp of followUps) {
    if (followUp.status !== "delivered" || !followUp.attachments?.length) {
      continue;
    }
    attachments.push(...followUp.attachments);
  }
  return attachments;
}

function normalizeFollowUpPrompt(followUp: ThreadPendingFollowUp): string {
  const prompt = followUp.prompt.trim();
  if (prompt) {
    return prompt;
  }
  const imageCount = followUp.attachments?.length ?? 0;
  return imageCount > 0 ? `请查看并分析我附上的 ${imageCount} 张图片。` : "请继续。";
}
