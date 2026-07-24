import type { ThreadPendingFollowUp, ThreadStatus } from "../shared/ipc";
import { i18n } from "./i18n";

export function isLiveFollowUpThreadStatus(status?: ThreadStatus): boolean {
  return status === "running" || status === "queued";
}

export function sortThreadFollowUps(
  followUps: readonly ThreadPendingFollowUp[],
): ThreadPendingFollowUp[] {
  return [...followUps].sort(compareThreadFollowUps);
}

export function queuedThreadFollowUps(
  followUps: readonly ThreadPendingFollowUp[],
): ThreadPendingFollowUp[] {
  return sortThreadFollowUps(followUps).filter((followUp) => followUp.status === "queued");
}

export function mergeThreadFollowUp(
  current: readonly ThreadPendingFollowUp[],
  followUp: ThreadPendingFollowUp,
): ThreadPendingFollowUp[] {
  const next = current.filter((item) => item.id !== followUp.id);
  next.push(followUp);
  return sortThreadFollowUps(next);
}

export function formatThreadFollowUpPreview(followUp: ThreadPendingFollowUp): string {
  const prompt = followUp.prompt.trim();
  const imageCount = followUp.attachments?.length ?? 0;
  const clipped = prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt;
  const imageLabel = i18n.t("thread.followUpImages", { count: imageCount });
  if (clipped && imageCount > 0) {
    return `${clipped} (${imageLabel})`;
  }
  if (clipped) {
    return clipped;
  }
  return imageCount > 0 ? imageLabel : i18n.t("thread.followUpEmpty");
}

function compareThreadFollowUps(left: ThreadPendingFollowUp, right: ThreadPendingFollowUp): number {
  const positionDelta = (left.queuePosition ?? Number.MAX_SAFE_INTEGER) -
    (right.queuePosition ?? Number.MAX_SAFE_INTEGER);
  if (positionDelta !== 0) {
    return positionDelta;
  }
  const priorityDelta = priorityRank(left) - priorityRank(right);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  if (positionDelta !== 0) {
    return positionDelta;
  }
  const createdDelta = left.createdAt.localeCompare(right.createdAt);
  if (createdDelta !== 0) {
    return createdDelta;
  }
  return left.id.localeCompare(right.id);
}

function priorityRank(followUp: ThreadPendingFollowUp): number {
  return followUp.priority === "escalated" ? 0 : 1;
}
