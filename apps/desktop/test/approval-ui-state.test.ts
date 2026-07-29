import { expect, test } from "bun:test";
import {
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
