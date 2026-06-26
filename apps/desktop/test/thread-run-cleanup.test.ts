import { expect, test } from "bun:test";
import {
  finalizeThreadRunCleanup,
  shouldPreservePlanApprovalsOnRunCleanup,
  type ThreadRunCleanupDeps,
} from "../src/main/thread-run-cleanup";

function createDeps(input?: {
  thread?: { status: string; message?: string };
  preservePlanApprovals?: boolean;
}) {
  const calls: string[] = [];
  const deps: ThreadRunCleanupDeps = {
    cancelClarifications(threadId, reason) {
      calls.push(`cancel:${threadId}:${reason}`);
    },
    cancelPlanApprovals(threadId, reason) {
      calls.push(`cancel-plan:${threadId}:${reason}`);
    },
    shouldPreservePlanApprovals: () => input?.preservePlanApprovals === true,
    resetSdkStream(threadId) {
      calls.push(`reset:${threadId}`);
    },
    async flushUsageUpdates(threadId) {
      calls.push(`flush:start:${threadId}`);
      await Promise.resolve();
      calls.push(`flush:end:${threadId}`);
    },
    finishActiveRun(threadId) {
      calls.push(`finish:${threadId}`);
    },
    afterRunContextRefresh(threadId, worktreePath) {
      calls.push(`context:${threadId}:${worktreePath}`);
    },
    getThread(threadId) {
      calls.push(`get:${threadId}`);
      return input?.thread;
    },
    updateThreadIdle(threadId, message) {
      calls.push(`idle:${threadId}:${message}`);
    },
  };
  return { calls, deps };
}

test("finalizeThreadRunCleanup preserves cleanup order and running fallback idle", async () => {
  const { calls, deps } = createDeps({ thread: { status: "running", message: "still running" } });

  await finalizeThreadRunCleanup(
    {
      threadId: "thr_cleanup",
      worktreePath: "/workspace/.worktree",
      cancelClarificationsReason: "run finished",
      idleFallbackMessage: "fallback idle",
    },
    deps,
  );

  expect(calls).toEqual([
    "cancel:thr_cleanup:run finished",
    "cancel-plan:thr_cleanup:run finished",
    "reset:thr_cleanup",
    "flush:start:thr_cleanup",
    "flush:end:thr_cleanup",
    "finish:thr_cleanup",
    "context:thr_cleanup:/workspace/.worktree",
    "get:thr_cleanup",
    "idle:thr_cleanup:still running",
  ]);
});

test("finalizeThreadRunCleanup uses fallback idle message only for running threads", async () => {
  const completed = createDeps({ thread: { status: "completed", message: "done" } });
  await finalizeThreadRunCleanup(
    {
      threadId: "thr_done",
      worktreePath: "/workspace",
      idleFallbackMessage: "fallback idle",
    },
    completed.deps,
  );
  expect(completed.calls).not.toContain("idle:thr_done:fallback idle");

  const runningWithoutMessage = createDeps({ thread: { status: "running" } });
  await finalizeThreadRunCleanup(
    {
      threadId: "thr_running",
      worktreePath: "/workspace",
      idleFallbackMessage: "fallback idle",
    },
    runningWithoutMessage.deps,
  );
  expect(runningWithoutMessage.calls).toContain("idle:thr_running:fallback idle");
});

test("shouldPreservePlanApprovalsOnRunCleanup keeps bridge and awaiting_plan plans", () => {
  expect(
    shouldPreservePlanApprovalsOnRunCleanup({
      hasPendingBridgeApproval: true,
      threadStatus: "running",
      hasStoredPendingPlan: false,
    }),
  ).toBe(true);
  expect(
    shouldPreservePlanApprovalsOnRunCleanup({
      hasPendingBridgeApproval: false,
      threadStatus: "awaiting_plan",
      hasStoredPendingPlan: true,
    }),
  ).toBe(true);
  expect(
    shouldPreservePlanApprovalsOnRunCleanup({
      hasPendingBridgeApproval: false,
      threadStatus: "running",
      hasStoredPendingPlan: true,
    }),
  ).toBe(false);
});

test("finalizeThreadRunCleanup skips plan cancel while awaiting user approval", async () => {
  const { calls, deps } = createDeps({
    thread: { status: "awaiting_plan", message: "等待你确认计划。" },
    preservePlanApprovals: true,
  });

  await finalizeThreadRunCleanup(
    {
      threadId: "thr_plan_wait",
      worktreePath: "/workspace",
      cancelClarificationsReason: "run finished",
      idleFallbackMessage: "续聊已结束。",
    },
    deps,
  );

  expect(calls).toContain("cancel:thr_plan_wait:run finished");
  expect(calls).not.toContain("cancel-plan:thr_plan_wait:run finished");
});

test("finalizeThreadRunCleanup defers finish while user gates are pending", async () => {
  const { calls, deps } = createDeps({ thread: { status: "running", message: "等待你的回答…" } });

  await finalizeThreadRunCleanup(
    {
      threadId: "thr_gate",
      worktreePath: "/workspace",
      cancelClarificationsReason: "run finished",
      idleFallbackMessage: "续聊已结束。",
    },
    {
      ...deps,
      shouldDeferRunCleanupFinish: () => true,
    },
  );

  expect(calls).toContain("cancel:thr_gate:run finished");
  expect(calls).not.toContain("finish:thr_gate");
  expect(calls).not.toContain("reset:thr_gate");
});

test("finalizeThreadRunCleanup can skip clarification cancel and idle fallback", async () => {
  const { calls, deps } = createDeps({ thread: { status: "running", message: "still running" } });

  await finalizeThreadRunCleanup(
    {
      threadId: "thr_minimal",
      worktreePath: "/workspace",
    },
    deps,
  );

  expect(calls).toEqual([
    "reset:thr_minimal",
    "flush:start:thr_minimal",
    "flush:end:thr_minimal",
    "finish:thr_minimal",
    "context:thr_minimal:/workspace",
  ]);
});
