import type { RequestAttemptResult } from "./request-retry";
import type { RunAttemptPhase, RunAttemptRecord, RunAttemptStatus } from "./usage-ledger";

export interface RunAttemptContext {
  threadId: string;
  runAttemptId: string;
  phase: RunAttemptPhase;
}

export interface ThreadRunAttemptLifecycle {
  startRunAttempt(input: {
    threadId: string;
    phase: RunAttemptPhase;
    retryIndex: number;
  }): Pick<RunAttemptRecord, "attemptId">;
  finishRunAttempt(threadId: string, status: Exclude<RunAttemptStatus, "running">): void;
}

export interface ThreadRunAttemptSettlementQueue {
  queueInterruptedStreamSettlement(
    threadId: string,
    runAttemptId: string,
    runStatus: Exclude<RunAttemptStatus, "running">,
  ): void;
}

export interface RunThreadRequestWithLifecycleInput {
  threadId: string;
  phase: RunAttemptPhase;
  signal?: AbortSignal;
  runOnce: (context: RunAttemptContext) => Promise<RequestAttemptResult>;
  lifecycle: ThreadRunAttemptLifecycle;
  settlements: ThreadRunAttemptSettlementQueue;
}

export function runThreadRequestWithLifecycle(
  input: RunThreadRequestWithLifecycleInput,
): Promise<RequestAttemptResult> {
  return (async () => {
    const attempt = input.lifecycle.startRunAttempt({
      threadId: input.threadId,
      phase: input.phase,
      retryIndex: 0,
    });
    const context: RunAttemptContext = {
      threadId: input.threadId,
      runAttemptId: attempt.attemptId,
      phase: input.phase,
    };
    try {
      const result = await input.runOnce(context);
      const status = runAttemptStatusFromResult(result);
      input.settlements.queueInterruptedStreamSettlement(input.threadId, attempt.attemptId, status);
      input.lifecycle.finishRunAttempt(input.threadId, status);
      return result;
    } catch (error) {
      const status = input.signal?.aborted ? "cancelled" : "failed";
      input.settlements.queueInterruptedStreamSettlement(input.threadId, attempt.attemptId, status);
      input.lifecycle.finishRunAttempt(input.threadId, status);
      throw error;
    }
  })();
}

export function runAttemptStatusFromResult(
  result: RequestAttemptResult,
): Exclude<RunAttemptStatus, "running"> {
  if (result.ok) {
    return "completed";
  }
  return result.aborted ? "cancelled" : "failed";
}

/** @deprecated Use runThreadRequestWithLifecycle */
export const runThreadRequestWithLifecycleAutoRetry = runThreadRequestWithLifecycle;
