import { expect, test } from "bun:test";
import {
  isStalePendingBashApprovalError,
  shouldClearPendingBashApproval,
  shouldClearPendingPlanApproval,
} from "../src/renderer/approval-ui-state";

test("remote Bash approval resolution clears the desktop pending approval", () => {
  expect(shouldClearPendingBashApproval("bash_approval.resolved")).toBe(true);
});

test("unrelated live events keep the desktop pending Bash approval", () => {
  expect(shouldClearPendingBashApproval("message.delta")).toBe(false);
  expect(shouldClearPendingBashApproval("thread.usage_updated")).toBe(false);
});

test("plan approval resolution closes the pending plan card", () => {
  expect(shouldClearPendingPlanApproval("plan_approval.approved")).toBe(true);
  expect(shouldClearPendingPlanApproval("plan_approval.denied")).toBe(true);
  expect(shouldClearPendingPlanApproval("plan_approval.requested")).toBe(false);
});

test("stale Bash approval errors are discardable after a cross-device race", () => {
  expect(isStalePendingBashApprovalError("No pending Bash approval for this tool use.")).toBe(true);
  expect(isStalePendingBashApprovalError("找不到待处理的审批请求。")).toBe(true);
  expect(isStalePendingBashApprovalError("No pending approval request was found.")).toBe(true);
  expect(isStalePendingBashApprovalError("Wait for the current run to finish.")).toBe(false);
});
