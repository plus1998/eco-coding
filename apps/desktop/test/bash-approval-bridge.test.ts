import { expect, test } from "bun:test";
import {
  approveAllPendingBashApprovalsForThread,
  buildResolvedBashApprovalThreadPatch,
  cancelBashApprovalsForThread,
  getPendingBashApprovalByToolUseId,
  getPendingBashApprovalForThread,
  listPendingBashApprovalsForThread,
  registerPendingBashApproval,
  resolvePendingBashApproval,
} from "../src/main/bash-approval-bridge";

test("resolved Bash approvals keep the thread running without a slogan summary", () => {
  expect(buildResolvedBashApprovalThreadPatch("approved")).toEqual({
    status: "running",
    message: "",
  });
  expect(buildResolvedBashApprovalThreadPatch("approved_remember_prefix")).toEqual({
    status: "running",
    message: "",
  });
  expect(buildResolvedBashApprovalThreadPatch("denied")).toEqual({
    status: "running",
    message: "",
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

test("approveAllPendingBashApprovalsForThread flushes only the target thread", async () => {
  const keep = registerPendingBashApproval("thread_keep", {
    toolUseId: "tool_keep",
    threadId: "thread_keep",
    command: "echo keep",
    cwd: "/repo",
    reason: "keep",
    riskScore: 5,
    riskLevel: "low",
    agentId: "planner:keep",
  });
  const first = registerPendingBashApproval("thread_flush", {
    toolUseId: "tool_flush_1",
    threadId: "thread_flush",
    command: "echo one",
    cwd: "/repo",
    reason: "flush",
    riskScore: 5,
    riskLevel: "low",
    agentId: "planner:flush",
  });
  const second = registerPendingBashApproval("thread_flush", {
    toolUseId: "tool_flush_2",
    threadId: "thread_flush",
    command: "echo two",
    cwd: "/repo",
    reason: "flush",
    riskScore: 5,
    riskLevel: "low",
    agentId: "planner:flush",
  });

  expect(listPendingBashApprovalsForThread("thread_flush")).toHaveLength(2);

  const approved = approveAllPendingBashApprovalsForThread("thread_flush");
  expect(approved.map((entry) => entry.toolUseId).sort()).toEqual(["tool_flush_1", "tool_flush_2"]);
  await expect(first).resolves.toEqual({ decision: "approved" });
  await expect(second).resolves.toEqual({ decision: "approved" });
  expect(listPendingBashApprovalsForThread("thread_flush")).toEqual([]);
  expect(getPendingBashApprovalForThread("thread_keep")?.toolUseId).toBe("tool_keep");

  expect(resolvePendingBashApproval("tool_keep", { decision: "denied" })).toBe(true);
  await expect(keep).resolves.toEqual({ decision: "denied" });
});
