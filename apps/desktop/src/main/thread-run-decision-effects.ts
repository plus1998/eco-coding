import type { ThreadRunOutcomeDecision } from "./thread-run-outcome";

type MaybePromise<T> = T | Promise<T>;

export type ThreadRunDecisionStatusPatch =
  | { status: "blocked"; message: string }
  | { status: "awaiting_plan"; message: string }
  | { status: "completed"; message: string }
  | { status: "idle"; message: string };

export interface ThreadRunDecisionEffects {
  updateThread(threadId: string, patch: ThreadRunDecisionStatusPatch): void;
}

export interface ApplyThreadRunDecisionEffectsInput {
  threadId: string;
  decision: ThreadRunOutcomeDecision;
  effects: ThreadRunDecisionEffects;
  onCancelled?: (reason: string) => MaybePromise<void>;
  onFailed?: (reason: string) => MaybePromise<void>;
  onIncomplete?: (reason: string) => MaybePromise<void>;
  onCompleted?: (message: string | undefined) => MaybePromise<void>;
  onAwaitingPlan?: (message: string) => MaybePromise<void>;
  onIdle?: (message: string) => MaybePromise<void>;
}

export async function applyThreadRunDecisionEffects(
  input: ApplyThreadRunDecisionEffectsInput,
): Promise<boolean> {
  const { decision } = input;

  if (decision.kind === "cancelled") {
    if (!input.onCancelled) {
      return false;
    }
    await input.onCancelled(decision.reason);
    return true;
  }

  if (decision.kind === "failed") {
    if (!input.onFailed) {
      return false;
    }
    await input.onFailed(decision.reason);
    return true;
  }

  if (decision.kind === "incomplete") {
    if (input.onIncomplete) {
      await input.onIncomplete(decision.reason);
    } else {
      input.effects.updateThread(input.threadId, {
        status: "blocked",
        message: decision.reason,
      });
    }
    return true;
  }

  if (decision.kind === "awaiting_plan") {
    if (input.onAwaitingPlan) {
      await input.onAwaitingPlan(decision.message);
    } else {
      input.effects.updateThread(input.threadId, {
        status: "awaiting_plan",
        message: decision.message,
      });
    }
    return true;
  }

  if (decision.kind === "idle") {
    if (input.onIdle) {
      await input.onIdle(decision.message);
    } else {
      input.effects.updateThread(input.threadId, {
        status: "idle",
        message: decision.message,
      });
    }
    return true;
  }

  if (input.onCompleted) {
    await input.onCompleted(decision.message);
    return true;
  }
  input.effects.updateThread(input.threadId, {
    status: "completed",
    message: "",
  });
  return true;
}
