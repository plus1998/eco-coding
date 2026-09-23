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
  };

  const deps = {
    updateThread: (_threadId: string, patch: { status: "idle" | "completed"; message: string }) => {
      calls.updates.push(patch);
    },
  };

  return { deps, calls };
}

test("parseThreadCancelRequest rejects the retired legacy thread id string", () => {
  expect(parseThreadCancelRequest("thread-1")).toBeNull();
});

test("parseThreadCancelRequest rejects an incomplete V1-shaped object", () => {
  expect(parseThreadCancelRequest({ threadId: "thread-1" })).toBeNull();
});

test("parseThreadCancelRequest accepts a complete V2 command envelope", () => {
  expect(
    parseThreadCancelRequest({
      principalId: "user-1",
      clientCommandId: "cancel-1",
      threadId: "thread-1",
      expectedHistoryRevision: 3,
      worktreeDisposition: "keep",
    }),
  ).toEqual({
    principalId: "user-1",
    clientCommandId: "cancel-1",
    threadId: "thread-1",
    expectedHistoryRevision: 3,
    worktreeDisposition: "keep",
  });
});

test("takePendingCancelDisposition consumes map entry once", () => {
  const pending = new Map<string, "keep">([["t1", "keep"]]);
  expect(takePendingCancelDisposition(pending, "t1")).toBe("keep");
  expect(takePendingCancelDisposition(pending, "t1")).toBeUndefined();
});

test("finalizeCancelledRun sets idle and preserves session checkpoint", async () => {
  const { deps, calls } = createDeps();
  await finalizeCancelledRun("t1", sessionPlan, undefined, deps);
  expect(calls.updates).toEqual([{ status: "idle", message: "" }]);
});

test("finalizeCancelledRun ignores non-error dismissal slogans", async () => {
  const { deps, calls } = createDeps();
  await finalizeCancelledRun("t1", sessionPlan, undefined, deps, "计划忽略");
  expect(calls.updates).toEqual([{ status: "idle", message: "" }]);
});
