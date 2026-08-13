import { expect, test } from "bun:test";
import {
  cancelPlanApprovalsForThread,
  getPendingPlanApprovalByToolUseId,
  getPendingPlanApprovalForThread,
  registerPendingPlanApproval,
  resolvePendingPlanApproval,
} from "../src/main/plan-approval-bridge";

test("registers and resolves pending plan approvals", async () => {
  const pending = registerPendingPlanApproval("thread_1", {
    toolUseId: "tool_plan_1",
    threadId: "thread_1",
    userPrompt: "Add feature",
    analysis: "Analysis",
    plan: "## Plan\n\nShip it.",
  });

  expect(getPendingPlanApprovalForThread("thread_1")?.plan).toContain("Ship it.");
  expect(getPendingPlanApprovalByToolUseId("tool_plan_1")?.userPrompt).toBe("Add feature");
  expect(resolvePendingPlanApproval("tool_plan_1", "approved")).toBe(true);
  await expect(pending).resolves.toBe("approved");
  expect(getPendingPlanApprovalForThread("thread_1")).toBeUndefined();
});

test("reuses the pending promise for the same ExitPlanMode tool use", async () => {
  const first = registerPendingPlanApproval("thread_shared", {
    toolUseId: "tool_plan_shared",
    threadId: "thread_shared",
    userPrompt: "Add feature",
    analysis: "Analysis",
    plan: "## Plan\n\nShip it.",
  });
  const second = registerPendingPlanApproval("thread_shared", {
    toolUseId: "tool_plan_shared",
    threadId: "thread_shared",
    userPrompt: "Add feature",
    analysis: "Analysis",
    plan: "## Plan\n\nShip it.",
  });

  expect(second).toBe(first);
  expect(resolvePendingPlanApproval("tool_plan_shared", "approved")).toBe(true);
  await expect(first).resolves.toBe("approved");
  await expect(second).resolves.toBe("approved");
});

test("rejects a duplicate ExitPlanMode id from another thread", async () => {
  const pending = registerPendingPlanApproval("thread_a", {
    toolUseId: "tool_plan_cross",
    threadId: "thread_a",
    userPrompt: "Add feature",
    analysis: "Analysis",
    plan: "## Plan\n\nShip it.",
  });

  await expect(
    registerPendingPlanApproval("thread_b", {
      toolUseId: "tool_plan_cross",
      threadId: "thread_b",
      userPrompt: "Other",
      analysis: "Analysis",
      plan: "## Plan\n\nOther.",
    }),
  ).rejects.toThrow("already pending for another thread");

  expect(resolvePendingPlanApproval("tool_plan_cross", "denied")).toBe(true);
  await expect(pending).resolves.toBe("denied");
});

test("cancels pending plan approvals for a thread", async () => {
  const pending = registerPendingPlanApproval("thread_2", {
    toolUseId: "tool_plan_2",
    threadId: "thread_2",
    userPrompt: "Fix bug",
    analysis: "Analysis",
    plan: "## Plan\n\nFix it.",
  });

  cancelPlanApprovalsForThread("thread_2", "cancelled by user");
  await expect(pending).rejects.toThrow("cancelled by user");
  expect(getPendingPlanApprovalForThread("thread_2")).toBeUndefined();
  expect(resolvePendingPlanApproval("tool_plan_2", "denied")).toBe(false);
});
