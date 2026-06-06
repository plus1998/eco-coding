import { expect, test } from "bun:test";
import { finalizeThreadRunCleanup, type ThreadRunCleanupDeps } from "../src/main/thread-run-cleanup";

function createDeps(input?: { thread?: { status: string; message?: string } }) {
  const calls: string[] = [];
  const deps: ThreadRunCleanupDeps = {
    cancelClarifications(threadId, reason) {
      calls.push(`cancel:${threadId}:${reason}`);
    },
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
