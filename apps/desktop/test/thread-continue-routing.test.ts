import { expect, test } from "bun:test";
import {
  continueStatusMessage,
  resolveContinuePhase,
  resolveThreadContinueAction,
  threadEnteredExecutionPhase,
  userRequestsPlanRevision,
} from "../src/shared/thread-continuation";
import { parseApprovedPlanDocument } from "../src/main/worktree-lifecycle";

test("userRequestsPlanRevision detects replan intent", () => {
  expect(userRequestsPlanRevision("继续")).toBe(false);
  expect(userRequestsPlanRevision("请重新规划一下")).toBe(true);
  expect(userRequestsPlanRevision("改计划：加上测试")).toBe(true);
});

test("threadEnteredExecutionPhase uses plan_cleared and approved file signals", () => {
  expect(
    threadEnteredExecutionPhase({
      threadStatus: "awaiting_plan",
      hasPendingPlan: true,
      hasApprovedPlanOnDisk: false,
      enteredExecutionPhase: false,
      hasCoderTodos: false,
      hasAppliedDiff: false,
      activityLines: [{ role: "system", message: "计划已进入执行阶段。" }],
    }),
  ).toBe(true);
  expect(
    threadEnteredExecutionPhase({
      threadStatus: "blocked",
      hasPendingPlan: false,
      hasApprovedPlanOnDisk: true,
      enteredExecutionPhase: false,
      hasCoderTodos: false,
      hasAppliedDiff: false,
      activityLines: [],
    }),
  ).toBe(true);
});

test("resolveContinuePhase returns execution after plan_cleared", () => {
  expect(
    resolveContinuePhase({
      intent: "coding",
      threadStatus: "idle",
      hasPendingPlan: false,
      hasApprovedPlanOnDisk: true,
      enteredExecutionPhase: true,
      hasCoderTodos: false,
      hasAppliedDiff: false,
      activityLines: [{ role: "system", message: "计划已进入执行阶段。" }],
    }),
  ).toBe("execution");
});

test("awaiting_plan with pending after execution failure resumes execution not replan", () => {
  const action = resolveThreadContinueAction({
    intent: "coding",
    followUp: "继续",
    canResume: true,
    usesPlanOrchestration: true,
    hasPendingPlan: true,
    hasApprovedPlanOnDisk: true,
    enteredExecutionPhase: true,
    hasCoderTodos: true,
    hasAppliedDiff: false,
    threadStatus: "awaiting_plan",
    activityLines: [{ role: "system", message: "计划已进入执行阶段。" }],
  });
  expect(action).toEqual({ kind: "resume_execution" });
  expect(continueStatusMessage(action, "coding")).toBe("正在按计划执行…");
});

test("awaiting_plan with pending before approval continues planning session", () => {
  const action = resolveThreadContinueAction({
    intent: "coding",
    followUp: "继续",
    canResume: true,
    usesPlanOrchestration: true,
    hasPendingPlan: true,
    hasApprovedPlanOnDisk: false,
    enteredExecutionPhase: false,
    hasCoderTodos: false,
    hasAppliedDiff: false,
    threadStatus: "awaiting_plan",
    activityLines: [{ role: "planner", message: "计划已生成，等待确认。" }],
  });
  expect(action).toEqual({ kind: "resume_sdk", phase: "planning" });
});

test("canResume false with approved snapshot resumes execution", () => {
  const action = resolveThreadContinueAction({
    intent: "coding",
    followUp: "继续",
    canResume: false,
    usesPlanOrchestration: true,
    hasPendingPlan: false,
    hasApprovedPlanOnDisk: true,
    enteredExecutionPhase: true,
    hasCoderTodos: false,
    hasAppliedDiff: false,
    threadStatus: "blocked",
    activityLines: [{ role: "system", message: "计划已进入执行阶段。" }],
  });
  expect(action).toEqual({ kind: "resume_execution" });
});

test("explicit replan uses sdk planning when session resumable", () => {
  const action = resolveThreadContinueAction({
    intent: "coding",
    followUp: "重新规划",
    canResume: true,
    usesPlanOrchestration: true,
    hasPendingPlan: true,
    hasApprovedPlanOnDisk: true,
    enteredExecutionPhase: true,
    hasCoderTodos: false,
    hasAppliedDiff: false,
    threadStatus: "awaiting_plan",
    activityLines: [],
  });
  expect(action).toEqual({ kind: "resume_sdk", phase: "planning" });
});

test("parseApprovedPlanDocument round-trips snapshot sections", () => {
  const doc = [
    "# Eco approved plan",
    "",
    "## User request",
    "fix export",
    "",
    "## Planning analysis",
    "missing handler",
    "",
    "## Approved plan",
    "## Steps",
    "1. add route",
    "",
    "_User edited this plan in Eco before approval._",
  ].join("\n");
  const parsed = parseApprovedPlanDocument(doc);
  expect(parsed?.userPrompt).toBe("fix export");
  expect(parsed?.analysis).toBe("missing handler");
  expect(parsed?.plan).toContain("## Steps");
  expect(parsed?.planUserEdited).toBe(true);
});
