import { expect, test } from "bun:test";
import {
  runAttemptStatusFromResult,
  runThreadRequestWithLifecycleAutoRetry,
  type ThreadRunAttemptLifecycle,
  type ThreadRunAttemptSettlementQueue,
} from "../src/main/thread-run-attempt";
import type { RunAttemptPhase, RunAttemptStatus } from "../src/main/usage-ledger";

function createHarness() {
  const starts: Array<{ threadId: string; phase: RunAttemptPhase; retryIndex: number }> = [];
  const finishes: Array<{ threadId: string; status: Exclude<RunAttemptStatus, "running"> }> = [];
  const settlements: Array<{
    threadId: string;
    runAttemptId: string;
    status: Exclude<RunAttemptStatus, "running">;
  }> = [];
  const lifecycle: ThreadRunAttemptLifecycle = {
    startRunAttempt(input) {
      starts.push(input);
      return { attemptId: `attempt_${input.retryIndex}` };
    },
    finishRunAttempt(threadId, status) {
      finishes.push({ threadId, status });
    },
  };
  const settlementQueue: ThreadRunAttemptSettlementQueue = {
    queueInterruptedStreamSettlement(threadId, runAttemptId, status) {
      settlements.push({ threadId, runAttemptId, status });
    },
  };
  return { starts, finishes, settlements, lifecycle, settlementQueue };
}

test("runThreadRequestWithLifecycleAutoRetry settles completed attempts", async () => {
  const harness = createHarness();

  const result = await runThreadRequestWithLifecycleAutoRetry({
    threadId: "thr_run",
    phase: "execution",
    runOnce: async () => ({ ok: true }),
    lifecycle: harness.lifecycle,
    settlements: harness.settlementQueue,
    retryIntervalMs: 0,
  });

  expect(result).toEqual({ ok: true });
  expect(harness.starts).toEqual([{ threadId: "thr_run", phase: "execution", retryIndex: 0 }]);
  expect(harness.finishes).toEqual([{ threadId: "thr_run", status: "completed" }]);
  expect(harness.settlements).toEqual([
    { threadId: "thr_run", runAttemptId: "attempt_0", status: "completed" },
  ]);
});

test("runThreadRequestWithLifecycleAutoRetry increments retry index across retries", async () => {
  const harness = createHarness();
  const scheduled: Array<{ retryIndex: number; maxRetries: number; reason: string }> = [];
  let calls = 0;

  const result = await runThreadRequestWithLifecycleAutoRetry({
    threadId: "thr_retry",
    phase: "planning",
    runOnce: async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, reason: "API Error: bad gateway" };
      }
      return { ok: true };
    },
    lifecycle: harness.lifecycle,
    settlements: harness.settlementQueue,
    retryIntervalMs: 0,
    onRetryScheduled: (retryIndex, maxRetries, reason) => {
      scheduled.push({ retryIndex, maxRetries, reason });
    },
  });

  expect(result).toEqual({ ok: true });
  expect(harness.starts.map((start) => start.retryIndex)).toEqual([0, 1]);
  expect(harness.finishes.map((finish) => finish.status)).toEqual(["failed", "completed"]);
  expect(harness.settlements.map((settlement) => settlement.status)).toEqual([
    "failed",
    "completed",
  ]);
  expect(scheduled).toEqual([
    { retryIndex: 1, maxRetries: 2, reason: "API Error: bad gateway" },
  ]);
});

test("runThreadRequestWithLifecycleAutoRetry marks thrown aborted attempts as cancelled", async () => {
  const harness = createHarness();
  const controller = new AbortController();

  await expect(
    runThreadRequestWithLifecycleAutoRetry({
      threadId: "thr_cancel",
      phase: "question",
      signal: controller.signal,
      runOnce: async () => {
        controller.abort();
        throw new Error("cancelled by user");
      },
      lifecycle: harness.lifecycle,
      settlements: harness.settlementQueue,
      retryIntervalMs: 0,
    }),
  ).rejects.toThrow("cancelled by user");

  expect(harness.finishes).toEqual([{ threadId: "thr_cancel", status: "cancelled" }]);
  expect(harness.settlements).toEqual([
    { threadId: "thr_cancel", runAttemptId: "attempt_0", status: "cancelled" },
  ]);
});

test("runAttemptStatusFromResult maps attempt result statuses", () => {
  expect(runAttemptStatusFromResult({ ok: true })).toBe("completed");
  expect(runAttemptStatusFromResult({ ok: false, reason: "failed" })).toBe("failed");
  expect(runAttemptStatusFromResult({ ok: false, reason: "cancelled", aborted: true })).toBe(
    "cancelled",
  );
});
