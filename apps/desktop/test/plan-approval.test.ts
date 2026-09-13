import { expect, test } from "bun:test";
import { parseThreadApprovePlanPayload } from "../src/shared/plan-approval";

test("parseThreadApprovePlanPayload accepts legacy thread id string", () => {
  expect(parseThreadApprovePlanPayload("thr_1")).toEqual({ threadId: "thr_1" });
});

test("parseThreadApprovePlanPayload accepts plan edits", () => {
  expect(
    parseThreadApprovePlanPayload({
      threadId: "thr_1",
      plan: "## Implementation Plan\n\nEdited",
      analysis: "summary",
    }),
  ).toEqual({
    threadId: "thr_1",
    plan: "## Implementation Plan\n\nEdited",
    analysis: "summary",
  });
});

test("parseThreadApprovePlanPayload rejects empty thread id", () => {
  expect(() => parseThreadApprovePlanPayload("  ")).toThrow("Thread id is required");
});

test("parseThreadApprovePlanPayload accepts a subagent execution target", () => {
  expect(
    parseThreadApprovePlanPayload({
      threadId: "thr_1",
      executionTarget: { kind: "subagent", agentKey: "eco_explore", additionalMessage: "先补测试" },
    }),
  ).toEqual({
    threadId: "thr_1",
    executionTarget: { kind: "subagent", agentKey: "eco_explore", additionalMessage: "先补测试" },
  });
});

test("parseThreadApprovePlanPayload accepts the main execution target", () => {
  expect(parseThreadApprovePlanPayload({ threadId: "thr_1", executionTarget: { kind: "main" } })).toEqual({
    threadId: "thr_1",
    executionTarget: { kind: "main" },
  });
});

test("parseThreadApprovePlanPayload rejects a subagent target without agentKey", () => {
  expect(() =>
    parseThreadApprovePlanPayload({
      threadId: "thr_1",
      executionTarget: { kind: "subagent" },
    }),
  ).toThrow("agentKey");
});

test("parseThreadApprovePlanPayload rejects an unknown execution target kind", () => {
  expect(() =>
    parseThreadApprovePlanPayload({ threadId: "thr_1", executionTarget: { kind: "robot" } }),
  ).toThrow("未知的计划执行目标");
});

test("parseThreadApprovePlanPayload omits the execution target when absent", () => {
  expect(parseThreadApprovePlanPayload({ threadId: "thr_1" })).toEqual({ threadId: "thr_1" });
  expect(parseThreadApprovePlanPayload({ threadId: "thr_1", executionTarget: undefined })).toEqual({
    threadId: "thr_1",
  });
});
