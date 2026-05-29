import type { ThreadStatus } from "./ipc";

/** Thread statuses where the user may send another message on the same thread. */
export const CONTINUABLE_THREAD_STATUSES = ["idle", "completed", "failed", "blocked"] as const;

export type ContinuableThreadStatus = (typeof CONTINUABLE_THREAD_STATUSES)[number];

export function isContinuableThreadStatus(status: ThreadStatus): status is ContinuableThreadStatus {
  return (CONTINUABLE_THREAD_STATUSES as readonly string[]).includes(status);
}

/** Agent turn prompt: keep the original task and add the latest user message. */
export function buildThreadTurnPrompt(threadPrompt: string, followUp: string): string {
  const original = threadPrompt.trim();
  const next = followUp.trim();
  if (!original) {
    return next;
  }
  if (!next || original === next) {
    return original;
  }
  return `${original}\n\n---\n\n后续消息：\n${next}`;
}

export function shouldUseInterruptedWorktree(worktreeExists: boolean, hasPriorActivity: boolean): boolean {
  return worktreeExists && hasPriorActivity;
}
