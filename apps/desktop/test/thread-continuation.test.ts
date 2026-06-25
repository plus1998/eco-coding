import { expect, test } from "bun:test";
import {
  buildActivityContextForPrompt,
  buildAgentPromptWithContext,
  buildThreadTurnPrompt,
  isContinuableThreadStatus,
  pickDisplayContextTokens,
  resolveThreadContinueAction,
  shouldUseInterruptedWorktree,
} from "../src/shared/thread-continuation";

test("isContinuableThreadStatus", () => {
  expect(isContinuableThreadStatus("idle")).toBe(true);
  expect(isContinuableThreadStatus("completed")).toBe(true);
  expect(isContinuableThreadStatus("failed")).toBe(true);
  expect(isContinuableThreadStatus("blocked")).toBe(true);
  expect(isContinuableThreadStatus("queued")).toBe(false);
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

test("rewind continuation prompt uses trimmed history instead of future activity", () => {
  const prompt = buildAgentPromptWithContext("原任务", "替换后的消息", [
    { role: "user", message: "原任务" },
    { role: "planner", message: "目标节点之前的回复" },
  ]);
  expect(prompt).toContain("替换后的消息");
  expect(prompt).toContain("目标节点之前的回复");
  expect(prompt).not.toContain("目标节点之后的旧回复");
});

test("legacy continuation uses full prompt injection without SDK session", () => {
  const prompt = buildAgentPromptWithContext("原任务", "继续", []);
  expect(prompt).toContain("原任务");
  expect(prompt).not.toContain("对话记录");
});

test("awaiting plan follow-up routes to plan revision without resume", () => {
  expect(
    resolveThreadContinueAction({
      followUp: "把测试覆盖也加进计划",
      canResume: false,
      planModeEnabled: true,
      hasPendingPlan: true,
      hasApprovedPlanOnDisk: false,
      enteredExecutionPhase: false,
      hasCoderTodos: false,
      hasAppliedDiff: false,
      threadStatus: "awaiting_plan",
      activityLines: [],
    }),
  ).toEqual({ kind: "revise_plan" });
});

test("awaiting plan follow-up still revises plan after ExitPlanMode disables plan mode", () => {
  expect(
    resolveThreadContinueAction({
      followUp: "把测试覆盖也加进计划",
      canResume: false,
      planModeEnabled: false,
      hasPendingPlan: true,
      hasApprovedPlanOnDisk: false,
      enteredExecutionPhase: false,
      hasCoderTodos: false,
      hasAppliedDiff: false,
      threadStatus: "awaiting_plan",
      activityLines: [],
    }),
  ).toEqual({ kind: "revise_plan" });
});

test("interrupted execution follow-up resumes sdk when possible", () => {
  expect(
    resolveThreadContinueAction({
      followUp: "继续，并补上失败用例",
      canResume: true,
      planModeEnabled: true,
      hasPendingPlan: false,
      hasApprovedPlanOnDisk: true,
      enteredExecutionPhase: true,
      hasCoderTodos: true,
      hasAppliedDiff: false,
      threadStatus: "blocked",
      activityLines: [{ role: "system", message: "计划已进入执行阶段。" }],
    }),
  ).toEqual({ kind: "resume_execution" });
});

test("resolveThreadContinueAction routes ask session mode to ask continuation", () => {
  expect(
    resolveThreadContinueAction({
      sessionMode: "ask",
      followUp: "实现登录功能",
      canResume: true,
      planModeEnabled: false,
      hasPendingPlan: false,
      hasApprovedPlanOnDisk: false,
      enteredExecutionPhase: false,
      hasCoderTodos: false,
      hasAppliedDiff: false,
      threadStatus: "completed",
      activityLines: [],
    }),
  ).toEqual({ kind: "resume_sdk", phase: "ask", resume: true });
});

test("agent session mode keeps agent routing on question-shaped follow-up", () => {
  expect(
    resolveThreadContinueAction({
      sessionMode: "agent",
      followUp: "这个项目的 runtime 是怎么工作的？",
      canResume: true,
      planModeEnabled: false,
      hasPendingPlan: false,
      hasApprovedPlanOnDisk: false,
      enteredExecutionPhase: false,
      hasCoderTodos: false,
      hasAppliedDiff: false,
      threadStatus: "completed",
      activityLines: [],
    }),
  ).toEqual({ kind: "resume_sdk", phase: "execution" });
});

test("pickDisplayContextTokens prefers planner", () => {
  expect(
    pickDisplayContextTokens({
      planner: { contextTokens: 12_000 },
      reviewer: { contextTokens: 80_000 },
    }),
  ).toBe(12_000);
});
