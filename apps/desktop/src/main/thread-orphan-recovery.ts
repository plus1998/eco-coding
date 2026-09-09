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

/**
 * Mid-session / continue-path: ActiveRun exists in memory but the ACP driver has
 * no in-flight turn (process died or turn already settled without cleanup).
 * Never treat awaiting_plan / pending-plan holds as ghosts — finalizeCleanup is
 * intentionally parked until the user decides.
 */
export function shouldClearGhostAcpActiveRun(input: {
  coreKind: string | undefined;
  status: string;
  hasActiveRun: boolean;
  acpTurnInFlight: boolean;
  hasPendingPlan: boolean;
  hasPendingPlanBridge?: boolean;
}): boolean {
  if (input.coreKind !== "acp" || !input.hasActiveRun || input.acpTurnInFlight) {
    return false;
  }
  if (input.status === "awaiting_plan" || input.hasPendingPlan || input.hasPendingPlanBridge) {
    return false;
  }
  return true;
}
