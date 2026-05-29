import { expect, test } from "bun:test";
import {
  buildActivityContextForPrompt,
  buildAgentPromptWithContext,
  buildThreadTurnPrompt,
  isContinuableThreadStatus,
  pickDisplayContextTokens,
  shouldUseInterruptedWorktree,
} from "../src/shared/thread-continuation";

test("isContinuableThreadStatus", () => {
  expect(isContinuableThreadStatus("idle")).toBe(true);
  expect(isContinuableThreadStatus("completed")).toBe(true);
  expect(isContinuableThreadStatus("running")).toBe(false);
  expect(isContinuableThreadStatus("awaiting_plan")).toBe(false);
});

test("buildThreadTurnPrompt preserves original task", () => {
  expect(buildThreadTurnPrompt("实现导出按钮", "再加个筛选")).toContain("实现导出按钮");
  expect(buildThreadTurnPrompt("实现导出按钮", "再加个筛选")).toContain("再加个筛选");
});

test("shouldUseInterruptedWorktree", () => {
  expect(shouldUseInterruptedWorktree(true, true)).toBe(true);
  expect(shouldUseInterruptedWorktree(true, false)).toBe(false);
});

test("buildActivityContextForPrompt skips tool noise", () => {
  const history = buildActivityContextForPrompt([
    { role: "user", message: "实现导出按钮" },
    { role: "tool", message: "Tool: Read · foo.ts" },
    { role: "planner", message: "【规划 (planner)】计划已生成，等待确认。" },
  ]);
  expect(history).toContain("实现导出按钮");
  expect(history).toContain("计划已生成");
  expect(history).not.toContain("Tool:");
});

test("buildAgentPromptWithContext includes history for coding follow-up", () => {
  const prompt = buildAgentPromptWithContext("原任务", "继续改后端", [
    { role: "user", message: "原任务" },
    { role: "coder", message: "已修改 corp.service.ts" },
  ]);
  expect(prompt).toContain("后续消息");
  expect(prompt).toContain("对话记录");
  expect(prompt).toContain("corp.service.ts");
});

test("pickDisplayContextTokens prefers planner", () => {
  expect(
    pickDisplayContextTokens({
      planner: { contextTokens: 12_000 },
      reviewer: { contextTokens: 80_000 },
    }),
  ).toBe(12_000);
});
