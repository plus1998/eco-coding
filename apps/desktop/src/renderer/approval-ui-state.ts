const BASH_APPROVAL_CLEARING_EVENT_TYPES = new Set([
  "bash_approval.approved",
  "bash_approval.rejected",
  "bash_approval.denied",
  "bash_approval.resolved",
  "plan_approval.denied",
  "thread.completed",
  "thread.failed",
  "thread.idle",
  "thread.stopped",
]);

export function shouldClearPendingBashApproval(eventType: string): boolean {
  return BASH_APPROVAL_CLEARING_EVENT_TYPES.has(eventType);
}

export function shouldClearPendingPlanApproval(eventType: string): boolean {
  return eventType === "plan_approval.approved" || eventType === "plan_approval.denied";
}

/**
 * Cross-device race: PC already resolved the parked card, mobile/desktop still shows it.
 * Treat "not found" as discardable so the UI can drop the stale approval.
 */
export function isStalePendingBashApprovalError(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }
  return (
    trimmed === "No pending Bash approval for this tool use." ||
    trimmed === "No pending approval request was found." ||
    trimmed === "找不到待处理的审批请求。" ||
    trimmed.includes("No pending Bash approval") ||
    trimmed.includes("pendingApprovalNotFound")
  );
}
