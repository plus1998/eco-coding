import type { CoreKind } from "@eco/runtime";
import { stableHash } from "@eco/shared";
import type { ConversationCommandJob, ConversationV2Store } from "./conversation-v2-store";
import type { RunAttemptCommandDispatch } from "./usage-ledger";

export interface PreparedConversationCommandDispatch {
  plannedAttemptId: string;
  commandDispatch: RunAttemptCommandDispatch;
}

export function buildConversationCommandDispatch(input: {
  principalId: string;
  conversationId: string;
  clientCommandId: string;
}): PreparedConversationCommandDispatch {
  const identityHash = stableHash(input);
  return {
    commandDispatch: {
      principalId: input.principalId,
      clientCommandId: input.clientCommandId,
      dispatchId: `dispatch_${identityHash}`,
    },
    plannedAttemptId: `attempt_command_${identityHash}`,
  };
}

export function prepareConversationCommandDispatch(input: {
  v2: ConversationV2Store;
  job: Pick<ConversationCommandJob, "principalId" | "conversationId" | "clientCommandId">;
  coreKind: CoreKind;
  actionKind: string;
  phase?: string;
  checkpointScope?: "history" | "plan";
}): PreparedConversationCommandDispatch {
  const prepared = buildConversationCommandDispatch(input.job);
  input.v2.recordCommandCheckpoint(
    input.job.principalId,
    input.job.conversationId,
    input.job.clientCommandId,
    input.checkpointScope === "plan"
      ? "plan.runtime_dispatch_prepared"
      : "history.runtime_dispatch_prepared",
    {
      dispatchId: prepared.commandDispatch.dispatchId,
      plannedAttemptId: prepared.plannedAttemptId,
      coreKind: input.coreKind,
      actionKind: input.actionKind,
      ...(input.phase ? { phase: input.phase } : {}),
    },
  );
  return prepared;
}

export function failUndispatchedConversationCommand(input: {
  v2: ConversationV2Store;
  conversationId: string;
  prepared: PreparedConversationCommandDispatch;
  reason: string;
}): boolean {
  const { commandDispatch } = input.prepared;
  const job = input.v2.getCommandJob(
    commandDispatch.principalId,
    input.conversationId,
    commandDispatch.clientCommandId,
  );
  const checkpoint = job?.checkpoints.at(-1);
  if (
    job?.status !== "running" ||
    (checkpoint?.name !== "history.runtime_dispatch_prepared" &&
      checkpoint?.name !== "plan.runtime_dispatch_prepared") ||
    checkpoint.payload.dispatchId !== commandDispatch.dispatchId ||
    checkpoint.payload.plannedAttemptId !== input.prepared.plannedAttemptId
  ) {
    return false;
  }
  input.v2.failCommand(commandDispatch.principalId, input.conversationId, commandDispatch.clientCommandId, {
    code: "runtime_dispatch_not_started",
    reason: input.reason,
    dispatchId: commandDispatch.dispatchId,
    plannedAttemptId: input.prepared.plannedAttemptId,
  });
  return true;
}

export function observeConversationCommandRuntime(input: {
  runtime: Promise<unknown>;
  v2: ConversationV2Store;
  conversationId: string;
  prepared: PreparedConversationCommandDispatch;
  notStartedReason: string;
  onRejected: (error: unknown) => void;
  onObserverError: (error: unknown) => void;
}): void {
  const settleIfUndispatched = (): void => {
    try {
      failUndispatchedConversationCommand({
        v2: input.v2,
        conversationId: input.conversationId,
        prepared: input.prepared,
        reason: input.notStartedReason,
      });
    } catch (error) {
      input.onObserverError(error);
    }
  };
  void input.runtime.then(
    () => settleIfUndispatched(),
    (error) => {
      settleIfUndispatched();
      try {
        input.onRejected(error);
      } catch (observerError) {
        input.onObserverError(observerError);
      }
    },
  );
}

export function waitForConversationCommandDispatch(input: {
  v2: ConversationV2Store;
  conversationId: string;
  prepared: PreparedConversationCommandDispatch;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<void> {
  const { commandDispatch } = input.prepared;
  const inspect = (): "pending" | "dispatched" | "failed" => {
    const job = input.v2.getCommandJob(
      commandDispatch.principalId,
      input.conversationId,
      commandDispatch.clientCommandId,
    );
    if (job?.status === "failed") return "failed";
    const dispatched = job?.checkpoints.some(
      (checkpoint) =>
        (checkpoint.name === "history.runtime_dispatched" ||
          checkpoint.name === "plan.runtime_dispatched") &&
        checkpoint.payload.dispatchId === commandDispatch.dispatchId &&
        checkpoint.payload.runAttemptId === input.prepared.plannedAttemptId,
    );
    return dispatched ? "dispatched" : "pending";
  };

  const initial = inspect();
  if (initial === "dispatched") return Promise.resolve();
  if (initial === "failed") {
    return Promise.reject(new Error("Command failed before its durable runtime dispatch was recorded."));
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poller: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | undefined;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (poller) clearInterval(poller);
      unsubscribe?.();
      if (error) reject(error);
      else resolve();
    };
    const check = (): void => {
      const state = inspect();
      if (state === "dispatched") finish();
      if (state === "failed") {
        finish(new Error("Command failed before its durable runtime dispatch was recorded."));
      }
    };
    unsubscribe = input.v2.onCommitted((result) => {
      if (result.event.conversationId === input.conversationId) check();
    });
    poller = setInterval(check, input.pollIntervalMs ?? 25);
    timer = setTimeout(
      () => finish(new Error("Timed out waiting for durable runtime dispatch.")),
      input.timeoutMs ?? 15_000,
    );
    check();
  });
}
