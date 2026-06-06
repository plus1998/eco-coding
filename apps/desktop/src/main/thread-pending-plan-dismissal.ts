import type { WorktreePlan } from "@eco/workspace";
import type { ThreadPendingPlan, ThreadSummary } from "../shared/ipc";

export type ThreadPendingPlanDismissalAction =
  | { kind: "cancel_worktree"; worktreePlan: WorktreePlan }
  | { kind: "idle"; message: string };

export interface ResolveThreadPendingPlanDismissalInput {
  threadId: string;
  message: string;
  pendingPlan?: Pick<ThreadPendingPlan, "workspacePath" | "worktreePath"> | undefined;
  thread?: Pick<ThreadSummary, "workspacePath"> | undefined;
  resolveWorktreePlan(workspacePath: string, threadId: string, worktreePath?: string): WorktreePlan;
  isIsolatedWorktreePlan(plan: Pick<WorktreePlan, "workspacePath" | "worktreePath">): boolean;
}

export function resolveThreadPendingPlanDismissal(
  input: ResolveThreadPendingPlanDismissalInput,
): ThreadPendingPlanDismissalAction {
  const workspacePath = input.pendingPlan?.workspacePath ?? input.thread?.workspacePath;
  if (!workspacePath) {
    return { kind: "idle", message: input.message };
  }

  const worktreePlan = input.resolveWorktreePlan(
    workspacePath,
    input.threadId,
    input.pendingPlan?.worktreePath,
  );
  if (input.isIsolatedWorktreePlan(worktreePlan)) {
    return { kind: "cancel_worktree", worktreePlan };
  }

  return { kind: "idle", message: input.message };
}
