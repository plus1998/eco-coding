import { expect, test } from "bun:test";
import {
  buildResolvedBashApprovalThreadPatch,
  cancelBashApprovalsForThread,
  getPendingBashApprovalByToolUseId,
  getPendingBashApprovalForThread,
  registerPendingBashApproval,
  resolvePendingBashApproval,
} from "../src/main/bash-approval-bridge";

test("resolved Bash approvals clear the waiting summary while the thread continues", () => {
  expect(buildResolvedBashApprovalThreadPatch("approved")).toEqual({
    status: "running",
    message: "已批准操作，正在继续…",
  });
  expect(buildResolvedBashApprovalThreadPatch("approved_remember_prefix")).toEqual({
    status: "running",
    message: "已批准操作，正在继续…",
  });
  expect(buildResolvedBashApprovalThreadPatch("denied")).toEqual({
    status: "running",
    message: "已拒绝操作，正在继续…",
  });
});

test("registers and resolves pending Bash approvals", async () => {
  const pending = registerPendingBashApproval("thread_1", {
    toolUseId: "tool_bash_1",
    threadId: "thread_1",
    command: "date",
    cwd: "/repo",
    reason: "Eco requires user confirmation before running Bash.",
    riskScore: 5,
    riskLevel: "low",
    agentId: "planner:attempt_execution_0",
  });

  expect(getPendingBashApprovalForThread("thread_1")?.command).toBe("date");
  expect(getPendingBashApprovalByToolUseId("tool_bash_1")?.cwd).toBe("/repo");
  expect(resolvePendingBashApproval("tool_bash_1", { decision: "approved" })).toBe(true);
  await expect(pending).resolves.toEqual({ decision: "approved" });
  expect(getPendingBashApprovalForThread("thread_1")).toBeUndefined();
});

test("cancels pending Bash approvals for a thread", async () => {
  const pending = registerPendingBashApproval("thread_2", {
    toolUseId: "tool_bash_2",
    threadId: "thread_2",
    command: "npm test",
    cwd: "/repo",
    reason: "Eco requires user confirmation before running Bash.",
    riskScore: 5,
    riskLevel: "low",
    agentId: "planner:attempt_execution_0",
  });

  cancelBashApprovalsForThread("thread_2", "cancelled by user");
  await expect(pending).rejects.toThrow("cancelled by user");
  expect(resolvePendingBashApproval("tool_bash_2", { decision: "denied" })).toBe(false);
});
