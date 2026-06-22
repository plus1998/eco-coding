export type OrphanedThreadRecoveryAction = "awaiting_plan" | "idle" | "none";

export function resolveOrphanedThreadRecoveryAction(input: {
  status: string;
  hasActiveRun: boolean;
  hasPendingPlan: boolean;
}): OrphanedThreadRecoveryAction {
  if (input.hasActiveRun) {
    return "none";
  }
  if (input.hasPendingPlan && input.status !== "execution_failed" && input.status !== "awaiting_plan") {
    return "awaiting_plan";
  }
  if (input.status === "running" || input.status === "queued") {
    return "idle";
  }
  return "none";
}
