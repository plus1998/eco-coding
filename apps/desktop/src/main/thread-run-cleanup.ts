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
  resetSdkStream: (threadId: string) => void;
  flushUsageUpdates: (threadId: string) => Promise<void>;
  finishActiveRun: (threadId: string) => void;
  afterRunContextRefresh: (threadId: string, worktreePath?: string) => void;
  getThread: (threadId: string) => ThreadRunCleanupThread | undefined;
  updateThreadIdle: (threadId: string, message: string) => void;
}

export async function finalizeThreadRunCleanup(
  input: FinalizeThreadRunCleanupInput,
  deps: ThreadRunCleanupDeps,
): Promise<void> {
  if (input.cancelClarificationsReason) {
    deps.cancelClarifications(input.threadId, input.cancelClarificationsReason);
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
