import { expect, test } from "bun:test";
import {
  buildThreadTurnPrompt,
  isContinuableThreadStatus,
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
