export interface ThreadRunCleanupThread {
  status: string;
  message?: string;
}

export interface FinalizeThreadRunCleanupInput {
  threadId: string;
  worktreePath?: string | undefined;
  cancelClarificationsReason?: string;
  idleFallbackMessage?: string;
}

export interface ThreadRunCleanupDeps {
  cancelClarifications: (threadId: string, reason: string) => void;
  cancelBashApprovals?: (threadId: string, reason: string) => void;
  cancelPlanApprovals?: (threadId: string, reason: string) => void;
  shouldPreservePlanApprovals?: (threadId: string) => boolean;
  shouldPreserveClarifications?: (threadId: string) => boolean;
  shouldDeferRunCleanupFinish?: (threadId: string) => boolean;
  resetSdkStream: (threadId: string) => void;
  flushUsageUpdates: (threadId: string) => Promise<void>;
  finishActiveRun: (threadId: string) => void;
  afterRunContextRefresh: (threadId: string, worktreePath?: string) => void;
  getThread: (threadId: string) => ThreadRunCleanupThread | undefined;
  updateThreadIdle: (threadId: string, message: string) => void;
}

export function shouldPreservePlanApprovalsOnRunCleanup(input: {
  hasPendingBridgeApproval: boolean;
  threadStatus?: string;
  hasStoredPendingPlan: boolean;
}): boolean {
  if (input.hasPendingBridgeApproval) {
    return true;
  }
  return input.threadStatus === "awaiting_plan" && input.hasStoredPendingPlan;
}

export function shouldDeferRunCleanupFinish(input: {
  hasPendingBridgeApproval: boolean;
  hasPendingClarification: boolean;
}): boolean {
  return input.hasPendingBridgeApproval || input.hasPendingClarification;
}

export async function finalizeThreadRunCleanup(
  input: FinalizeThreadRunCleanupInput,
  deps: ThreadRunCleanupDeps,
): Promise<void> {
  if (input.cancelClarificationsReason) {
    if (!deps.shouldPreserveClarifications?.(input.threadId)) {
      deps.cancelClarifications(input.threadId, input.cancelClarificationsReason);
    }
    deps.cancelBashApprovals?.(input.threadId, input.cancelClarificationsReason);
    if (!deps.shouldPreservePlanApprovals?.(input.threadId)) {
      deps.cancelPlanApprovals?.(input.threadId, input.cancelClarificationsReason);
    }
  }
  if (deps.shouldDeferRunCleanupFinish?.(input.threadId)) {
    return;
  }
  deps.resetSdkStream(input.threadId);
  await deps.flushUsageUpdates(input.threadId);
  deps.finishActiveRun(input.threadId);
  deps.afterRunContextRefresh(input.threadId, input.worktreePath);

  if (!input.idleFallbackMessage) {
    return;
  }
  const currentThread = deps.getThread(input.threadId);
  if (currentThread?.status === "running") {
    deps.updateThreadIdle(input.threadId, currentThread.message || input.idleFallbackMessage);
  }
}
