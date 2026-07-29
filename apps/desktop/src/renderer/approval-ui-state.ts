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
