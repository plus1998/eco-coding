import { expect, test } from "bun:test";
import type { WorktreePlan } from "@eco/workspace";
import { resolveThreadPendingPlanDismissal } from "../src/main/thread-pending-plan-dismissal";

function worktreePlan(workspacePath: string, threadId: string, worktreePath?: string): WorktreePlan {
  return {
    workspacePath,
    worktreePath: worktreePath ?? `${workspacePath}/.eco/worktrees/${threadId}`,
    branchName: `eco/${threadId}`,
  };
}

test("resolveThreadPendingPlanDismissal cancels isolated pending plan worktree", () => {
  const calls: Array<{ workspacePath: string; threadId: string; worktreePath?: string }> = [];
  const action = resolveThreadPendingPlanDismissal({
    threadId: "thr_dismiss",
    message: "已忽略计划。",
    pendingPlan: {
      workspacePath: "/repo/from-pending",
      worktreePath: "/repo/from-pending/.eco/worktrees/thr_dismiss",
    },
    thread: {
      workspacePath: "/repo/from-thread",
    },
    resolveWorktreePlan: (workspacePath, threadId, worktreePath) => {
      calls.push({ workspacePath, threadId, worktreePath });
      return worktreePlan(workspacePath, threadId, worktreePath);
    },
    isIsolatedWorktreePlan: () => true,
  });

  expect(action).toEqual({
    kind: "cancel_worktree",
    worktreePlan: worktreePlan(
      "/repo/from-pending",
      "thr_dismiss",
      "/repo/from-pending/.eco/worktrees/thr_dismiss",
    ),
  });
  expect(calls).toEqual([
    {
      workspacePath: "/repo/from-pending",
      threadId: "thr_dismiss",
      worktreePath: "/repo/from-pending/.eco/worktrees/thr_dismiss",
    },
  ]);
});

test("resolveThreadPendingPlanDismissal falls back to thread workspace", () => {
  const action = resolveThreadPendingPlanDismissal({
    threadId: "thr_thread_workspace",
    message: "已取消。",
    thread: {
      workspacePath: "/repo/from-thread",
    },
    resolveWorktreePlan: worktreePlan,
    isIsolatedWorktreePlan: () => true,
  });

  expect(action).toEqual({
    kind: "cancel_worktree",
    worktreePlan: worktreePlan("/repo/from-thread", "thr_thread_workspace"),
  });
});

test("resolveThreadPendingPlanDismissal returns idle when no workspace is known", () => {
  const action = resolveThreadPendingPlanDismissal({
    threadId: "thr_no_workspace",
    message: "已忽略计划。",
    resolveWorktreePlan: worktreePlan,
    isIsolatedWorktreePlan: () => true,
  });

  expect(action).toEqual({ kind: "idle", message: "已忽略计划。" });
});

test("resolveThreadPendingPlanDismissal returns idle for non-isolated worktree plans", () => {
  const action = resolveThreadPendingPlanDismissal({
    threadId: "thr_direct",
    message: "已忽略计划。",
    pendingPlan: {
      workspacePath: "/repo/direct",
      worktreePath: "/repo/direct",
    },
    resolveWorktreePlan: worktreePlan,
    isIsolatedWorktreePlan: () => false,
  });

  expect(action).toEqual({ kind: "idle", message: "已忽略计划。" });
});
