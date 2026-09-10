import type { PromptImageAttachment, ThreadPendingFollowUp, ThreadStatus } from "./ipc";

// `idle` is drainable so queue Resume after a user stop can send. Stop itself must
// auto-pause first; otherwise cancel cleanup would silently drain remaining follow-ups.
const DRAINABLE_FOLLOW_UP_STATUSES = [
  "completed",
  "failed",
  "blocked",
  "awaiting_plan",
  "idle",
] as const;

export function shouldDrainThreadFollowUps(status: ThreadStatus): boolean {
  return (DRAINABLE_FOLLOW_UP_STATUSES as readonly string[]).includes(status);
}

/** Block auto-drain while plan approval, clarification, editing, or user/error pause is active. */
export function shouldBlockThreadFollowUpDrain(input: {
  hasPendingBridgeApproval: boolean;
  hasPendingClarification: boolean;
  hasEditingFollowUp?: boolean;
  /** User or session-error pause; escalate force-drain may bypass via caller. */
  hasFollowUpQueuePaused?: boolean;
  threadStatus?: ThreadStatus;
  hasStoredPendingPlan: boolean;
}): boolean {
  if (
    input.hasPendingBridgeApproval ||
    input.hasPendingClarification ||
    input.hasEditingFollowUp ||
    input.hasFollowUpQueuePaused
  ) {
    return true;
  }
  return input.threadStatus === "awaiting_plan" && input.hasStoredPendingPlan;
}

/**
 * Whether the thread can accept a new queued follow-up row.
 * Live run statuses always accept; paused queues also accept on drainable
 * statuses so new messages join the pause instead of starting a run ahead of
 * remaining items.
 */
export function threadAcceptsQueuedFollowUp(input: {
  status: ThreadStatus;
  followUpQueuePaused?: boolean;
  hasPendingBridgeApproval?: boolean;
  hasPendingClarification?: boolean;
  hasPendingBashApproval?: boolean;
  hasPendingPlanApproval?: boolean;
}): boolean {
  if (input.status === "running" || input.status === "queued" || input.status === "awaiting_plan") {
    return true;
  }
  if (input.followUpQueuePaused && shouldDrainThreadFollowUps(input.status)) {
    return true;
  }
  return Boolean(
    input.hasPendingBridgeApproval ||
      input.hasPendingClarification ||
      input.hasPendingBashApproval ||
      input.hasPendingPlanApproval,
  );
}

/**
 * Auto-pause (session error / user stop) only protects rows that exist. An empty queue
 * must stay sendable: arming the pause there would silently queue the next message the
 * user composes, with no queued row explaining why.
 */
export function shouldAutoPauseFollowUpQueue(queuedCount: number): boolean {
  return queuedCount > 0;
}

/**
 * A pause with no queued rows left has no subject (the rows it held are gone), so it must
 * lift itself instead of holding back newly composed messages.
 */
export function shouldReleaseFollowUpQueuePause(input: {
  paused: boolean;
  queuedCount: number;
}): boolean {
  return input.paused && input.queuedCount === 0;
}

/**
 * Mid-turn inject leaves the row `queued` when it was skipped (paused queue,
 * interrupted turn, blocking approval, or no accepting port). That is not a
 * delivery, so callers must not treat it as a handled row.
 */
export function isFollowUpMidTurnResultDelivered(
  result: ThreadPendingFollowUp | undefined,
): result is ThreadPendingFollowUp {
  return Boolean(result && result.status !== "queued");
}

/**
 * Escalated ("handle now") may bypass a user-paused queue, but it still needs
 * something that can move: an active run to interrupt, or a drainable boundary.
 * Used after a skipped mid-turn inject so a paused queue cannot swallow the
 * Guide click while a starting run keeps the row queued instead of failing it.
 */
export function canEscalatedFollowUpProgressNow(input: {
  hasActiveRun: boolean;
  status?: ThreadStatus;
}): boolean {
  if (input.hasActiveRun) {
    return true;
  }
  return Boolean(input.status && shouldDrainThreadFollowUps(input.status));
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
