import { expect, test } from "bun:test";
import type { RunAttemptContext } from "../src/main/thread-run-attempt";
import {
  runAttemptStatusFromResult,
  runThreadRequestWithLifecycle,
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

test("runThreadRequestWithLifecycle passes attempt context to runOnce", async () => {
  const harness = createHarness();
  const contexts: RunAttemptContext[] = [];

  await runThreadRequestWithLifecycle({
    threadId: "thr_ctx",
    phase: "execution",
    runOnce: async (context) => {
      contexts.push(context);
      return { ok: true };
    },
    lifecycle: harness.lifecycle,
    settlements: harness.settlementQueue,
  });

  expect(contexts).toEqual([{ threadId: "thr_ctx", runAttemptId: "attempt_0", phase: "execution" }]);
});

test("runThreadRequestWithLifecycle settles completed attempts", async () => {
  const harness = createHarness();

  const result = await runThreadRequestWithLifecycle({
    threadId: "thr_run",
    phase: "execution",
    runOnce: async () => ({ ok: true }),
    lifecycle: harness.lifecycle,
    settlements: harness.settlementQueue,
  });

  expect(result).toEqual({ ok: true });
  expect(harness.starts).toEqual([{ threadId: "thr_run", phase: "execution", retryIndex: 0 }]);
  expect(harness.finishes).toEqual([{ threadId: "thr_run", status: "completed" }]);
  expect(harness.settlements).toEqual([
    { threadId: "thr_run", runAttemptId: "attempt_0", status: "completed" },
  ]);
});

test("runThreadRequestWithLifecycle does not rerun failed attempts", async () => {
  const harness = createHarness();
  let calls = 0;

  const result = await runThreadRequestWithLifecycle({
    threadId: "thr_retry",
    phase: "planning",
    runOnce: async () => {
      calls += 1;
      return { ok: false, reason: "API Error: bad gateway" };
    },
    lifecycle: harness.lifecycle,
    settlements: harness.settlementQueue,
  });

  expect(result).toEqual({ ok: false, reason: "API Error: bad gateway" });
  expect(calls).toBe(1);
  expect(harness.starts.map((start) => start.retryIndex)).toEqual([0]);
  expect(harness.finishes.map((finish) => finish.status)).toEqual(["failed"]);
});

test("runThreadRequestWithLifecycle does not automatically continue incomplete attempts", async () => {
  const harness = createHarness();
  let calls = 0;

  const result = await runThreadRequestWithLifecycle({
    threadId: "thr_incomplete",
    phase: "execution",
    runOnce: async () => {
      calls += 1;
      return { ok: false, reason: "max_tokens", incomplete: true };
    },
    lifecycle: harness.lifecycle,
    settlements: harness.settlementQueue,
  });

  expect(result).toEqual({ ok: false, reason: "max_tokens", incomplete: true });
  expect(calls).toBe(1);
  expect(harness.starts.map((start) => start.retryIndex)).toEqual([0]);
  expect(harness.finishes.map((finish) => finish.status)).toEqual(["failed"]);
});

test("runThreadRequestWithLifecycle marks thrown aborted attempts as cancelled", async () => {
  const harness = createHarness();
  const controller = new AbortController();

  await expect(
    runThreadRequestWithLifecycle({
      threadId: "thr_cancel",
      phase: "ask",
      signal: controller.signal,
      runOnce: async () => {
        controller.abort();
        throw new Error("cancelled by user");
      },
      lifecycle: harness.lifecycle,
      settlements: harness.settlementQueue,
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
  expect(runAttemptStatusFromResult({ ok: false, reason: "cancelled", aborted: true })).toBe("cancelled");
});
