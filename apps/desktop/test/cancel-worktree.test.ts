import { expect, test } from "bun:test";
import type { WorktreePlan } from "@eco/workspace";
import {
  finalizeCancelledRun,
  parseThreadCancelRequest,
  resolveCancelDisposition,
  takePendingCancelDisposition,
} from "../src/main/cancel-worktree";

const isolatedPlan: WorktreePlan = {
  workspacePath: "/repo",
  worktreePath: "/repo/.eco/worktrees/thread-1",
  branchName: "eco/thread-1",
};

const directPlan: WorktreePlan = {
  workspacePath: "/repo",
  worktreePath: "/repo",
  branchName: "main",
};

function createDeps(overrides?: Partial<Parameters<typeof finalizeCancelledRun>[3]>) {
  const calls = {
    apply: 0,
    discard: 0,
    cleanup: 0,
    save: 0,
    updates: [] as Array<{ status: string; message: string }>,
    events: [] as string[],
  };

  const deps = {
    isIsolatedWorktreePlan: (plan: Pick<WorktreePlan, "workspacePath" | "worktreePath">) =>
      plan.worktreePath !== plan.workspacePath,
    changedFiles: async () => ["src/a.ts"],
    applyWorktreeChanges: async () => {
      calls.apply += 1;
      return {
        files: ["src/a.ts"],
        diff: "diff",
        threadMessage: "已合并 1 个文件到工作区（未自动提交）",
        activityMessage: "__eco_worktree_merge__\n{}",
      };
    },
    saveAppliedDiff: () => {
      calls.save += 1;
    },
    discardWorktreeChanges: async () => {
      calls.discard += 1;
    },
    cleanupWorktreeForThread: async () => {
      calls.cleanup += 1;
    },
    updateThread: (_threadId: string, patch: { status: "idle" | "completed"; message: string }) => {
      calls.updates.push(patch);
    },
    emitThreadEvent: (_threadId: string, type: string) => {
      calls.events.push(type);
    },
    ...overrides,
  };

  return { deps, calls };
}

test("parseThreadCancelRequest accepts legacy thread id string", () => {
  expect(parseThreadCancelRequest("thread-1")).toEqual({ threadId: "thread-1" });
});

test("parseThreadCancelRequest accepts object with disposition", () => {
  expect(
    parseThreadCancelRequest({ threadId: "thread-1", worktreeDisposition: "apply" }),
  ).toEqual({ threadId: "thread-1", worktreeDisposition: "apply" });
});

test("takePendingCancelDisposition consumes map entry once", () => {
  const pending = new Map<string, "keep">([["t1", "keep"]]);
  expect(takePendingCancelDisposition(pending, "t1")).toBe("keep");
  expect(takePendingCancelDisposition(pending, "t1")).toBeUndefined();
});

test("resolveCancelDisposition defaults to keep when files exist", async () => {
  await expect(resolveCancelDisposition(isolatedPlan, undefined, async () => ["a.ts"])).resolves.toBe(
    "keep",
  );
});

test("resolveCancelDisposition defaults to discard when no files", async () => {
  await expect(resolveCancelDisposition(isolatedPlan, undefined, async () => [])).resolves.toBe(
    "discard",
  );
});

test("finalizeCancelledRun apply merges and cleans up", async () => {
  const { deps, calls } = createDeps();
  await finalizeCancelledRun("t1", isolatedPlan, "apply", deps);
  expect(calls.apply).toBe(1);
  expect(calls.save).toBe(1);
  expect(calls.cleanup).toBe(1);
  expect(calls.discard).toBe(0);
  expect(calls.updates.at(-1)?.status).toBe("completed");
});

test("finalizeCancelledRun keep leaves worktree intact", async () => {
  const { deps, calls } = createDeps();
  await finalizeCancelledRun("t1", isolatedPlan, "keep", deps);
  expect(calls.apply).toBe(0);
  expect(calls.cleanup).toBe(0);
  expect(calls.discard).toBe(0);
  expect(calls.updates.at(-1)?.message).toContain("应用到工作区");
});

test("finalizeCancelledRun discard resets worktree", async () => {
  const { deps, calls } = createDeps();
  await finalizeCancelledRun("t1", isolatedPlan, "discard", deps);
  expect(calls.discard).toBe(1);
  expect(calls.cleanup).toBe(1);
  expect(calls.apply).toBe(0);
});

test("finalizeCancelledRun non-isolated only sets idle", async () => {
  const { deps, calls } = createDeps();
  await finalizeCancelledRun("t1", directPlan, "apply", deps);
  expect(calls.apply).toBe(0);
  expect(calls.updates).toEqual([{ status: "idle", message: "已取消。" }]);
});
