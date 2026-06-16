import type { ThreadPendingPlan } from "../shared/ipc";

export type ThreadPendingPlanWithRoutes = ThreadPendingPlan & { routesJson: string };

export type ThreadPlanReadyPayload = Pick<
  ThreadPendingPlan,
  "analysis" | "plan" | "userPrompt" | "planFilePath"
>;

export interface ThreadPlanReadyAwaitingPlanEvent {
  threadId: string;
  message: string;
  plan: ThreadPlanReadyPayload;
}

export interface ThreadPlanReadyEffects {
  savePendingPlan(plan: ThreadPendingPlanWithRoutes): void;
  emitAwaitingPlan(event: ThreadPlanReadyAwaitingPlanEvent): void;
}

export interface ApplyThreadPlanReadyEffectsInput {
  threadId: string;
  payload: ThreadPlanReadyPayload;
  workspacePath: string;
  worktreePath: string;
  routesJson: string;
  awaitingPlanMessage: string;
  effects: ThreadPlanReadyEffects;
}

export interface AppliedThreadPlanReadyEffects {
  planCaptured: true;
  pendingPlan: ThreadPendingPlanWithRoutes;
}

export function applyThreadPlanReadyEffects(
  input: ApplyThreadPlanReadyEffectsInput,
): AppliedThreadPlanReadyEffects {
  const pendingPlan: ThreadPendingPlanWithRoutes = {
    threadId: input.threadId,
    userPrompt: input.payload.userPrompt,
    analysis: input.payload.analysis,
    plan: input.payload.plan,
    workspacePath: input.workspacePath,
    worktreePath: input.worktreePath,
    routesJson: input.routesJson,
    ...(input.payload.planFilePath ? { planFilePath: input.payload.planFilePath } : {}),
  };
  const plan: ThreadPlanReadyPayload = {
    userPrompt: input.payload.userPrompt,
    analysis: input.payload.analysis,
    plan: input.payload.plan,
    ...(input.payload.planFilePath ? { planFilePath: input.payload.planFilePath } : {}),
  };

  input.effects.savePendingPlan(pendingPlan);
  input.effects.emitAwaitingPlan({
    threadId: input.threadId,
    message: input.awaitingPlanMessage,
    plan,
  });

  return { planCaptured: true, pendingPlan };
}
