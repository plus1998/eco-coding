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
