import { expect, test } from "bun:test";
import type { WorktreePlan } from "@eco/workspace";
import { ActiveRunRuntimeStateStore } from "../src/main/active-run-runtime-state";

function plan(suffix: string): WorktreePlan {
  return {
    workspacePath: "/workspace",
    worktreePath: `/workspace/.eco/worktrees/${suffix}`,
    branchName: `eco/${suffix}`,
  };
}

test("ActiveRunRuntimeStateStore tracks active runs and worktree plans", () => {
  const store = new ActiveRunRuntimeStateStore();
  const controller = new AbortController();

  expect(store.hasRun("thr_runtime")).toBe(false);
  store.startRun("thr_runtime", { controller, worktreePlan: plan("initial") });

  expect(store.hasRun("thr_runtime")).toBe(true);
  expect(store.worktreePlan("thr_runtime")).toMatchObject({
    worktreePath: "/workspace/.eco/worktrees/initial",
  });

  store.setWorktreePlan("thr_runtime", plan("resolved"));
  expect(store.worktreePlan("thr_runtime")).toMatchObject({
    worktreePath: "/workspace/.eco/worktrees/resolved",
  });

  store.finishRun("thr_runtime");
  expect(store.hasRun("thr_runtime")).toBe(false);
  expect(store.worktreePlan("thr_runtime")).toBeUndefined();
});

test("ActiveRunRuntimeStateStore aborts active controllers only", () => {
  const store = new ActiveRunRuntimeStateStore();
  const controller = new AbortController();
  store.startRun("thr_runtime", { controller });

  expect(store.abortRun("missing", "missing")).toBe(false);
  expect(controller.signal.aborted).toBe(false);

  expect(store.abortRun("thr_runtime", "cancelled by user")).toBe(true);
  expect(controller.signal.aborted).toBe(true);
  expect(controller.signal.reason).toBe("cancelled by user");
});

test("ActiveRunRuntimeStateStore restarts with fresh runtime state", () => {
  const store = new ActiveRunRuntimeStateStore();
  store.startRun("thr_runtime", {
    controller: new AbortController(),
    worktreePlan: plan("old"),
  });

  store.startRun("thr_runtime", { controller: new AbortController() });

  expect(store.hasRun("thr_runtime")).toBe(true);
  expect(store.worktreePlan("thr_runtime")).toBeUndefined();
});
