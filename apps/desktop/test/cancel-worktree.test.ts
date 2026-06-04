import { expect, test } from "bun:test";
import type { WorktreePlan } from "@eco/workspace";
import { createSessionPlan } from "@eco/workspace";
import {
  finalizeCancelledRun,
  parseThreadCancelRequest,
  takePendingCancelDisposition,
} from "../src/main/cancel-worktree";

const sessionPlan: WorktreePlan = createSessionPlan("/repo", "thread-1");

function createDeps() {
  const calls = {
    updates: [] as Array<{ status: string; message: string }>,
    events: [] as string[],
  };

  const deps = {
    updateThread: (_threadId: string, patch: { status: "idle" | "completed"; message: string }) => {
      calls.updates.push(patch);
    },
    emitThreadEvent: (_threadId: string, type: string) => {
      calls.events.push(type);
    },
  };

  return { deps, calls };
}

test("parseThreadCancelRequest accepts legacy thread id string", () => {
  expect(parseThreadCancelRequest("thread-1")).toEqual({ threadId: "thread-1" });
});

test("parseThreadCancelRequest accepts object with threadId only", () => {
  expect(parseThreadCancelRequest({ threadId: "thread-1" })).toEqual({ threadId: "thread-1" });
});

test("takePendingCancelDisposition consumes map entry once", () => {
  const pending = new Map<string, "keep">([["t1", "keep"]]);
  expect(takePendingCancelDisposition(pending, "t1")).toBe("keep");
  expect(takePendingCancelDisposition(pending, "t1")).toBeUndefined();
});

test("finalizeCancelledRun sets idle and preserves session checkpoint", async () => {
  const { deps, calls } = createDeps();
  await finalizeCancelledRun("t1", sessionPlan, undefined, deps);
  expect(calls.updates).toEqual([
    { status: "idle", message: "已停止。可继续对话；文件可通过检查点回滚。" },
  ]);
  expect(calls.events).toContain("thread.stopped");
});
