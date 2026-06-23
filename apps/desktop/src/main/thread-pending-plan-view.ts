import type { ThreadPendingPlan } from "../shared/ipc";

export type ThreadPendingPlanInternal = ThreadPendingPlan & { routesJson?: string };

export function buildThreadPendingPlanView(
  pending: ThreadPendingPlanInternal | undefined,
): ThreadPendingPlan | undefined {
  if (!pending) {
    return undefined;
  }
  return {
    threadId: pending.threadId,
    userPrompt: pending.userPrompt,
    analysis: pending.analysis,
    plan: pending.plan,
    workspacePath: pending.workspacePath,
    worktreePath: pending.worktreePath,
  };
}

export function buildThreadPlanLivePayload(
  pending: Pick<ThreadPendingPlan, "userPrompt" | "analysis" | "plan" | "planFilePath">,
): Pick<ThreadPendingPlan, "userPrompt" | "analysis" | "plan" | "planFilePath"> {
  return {
    userPrompt: pending.userPrompt,
    analysis: pending.analysis,
    plan: pending.plan,
    ...(pending.planFilePath ? { planFilePath: pending.planFilePath } : {}),
  };
}
