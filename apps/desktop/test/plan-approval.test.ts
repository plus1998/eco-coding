import { expect, test } from "bun:test";
import { parseThreadApprovePlanPayload, parseThreadDismissPlanPayload } from "../src/shared/plan-approval";

const envelope = {
  principalId: "principal_1",
  clientCommandId: "plan_command_1",
  threadId: "thr_1",
  expectedHistoryRevision: 7,
};

test("parseThreadApprovePlanPayload accepts plan edits", () => {
  expect(
    parseThreadApprovePlanPayload({
      ...envelope,
      plan: "## Implementation Plan\n\nEdited",
      analysis: "summary",
    }),
  ).toEqual({
    ...envelope,
    plan: "## Implementation Plan\n\nEdited",
    analysis: "summary",
  });
});

test("parseThreadApprovePlanPayload rejects an incomplete command envelope", () => {
  expect(() => parseThreadApprovePlanPayload({ threadId: "thr_1" })).toThrow(
    "Invalid plan approval command envelope",
  );
});

test("parseThreadApprovePlanPayload accepts a subagent execution target", () => {
  expect(
    parseThreadApprovePlanPayload({
      ...envelope,
      executionTarget: { kind: "subagent", agentKey: "eco_explore", additionalMessage: "先补测试" },
    }),
  ).toEqual({
    ...envelope,
    executionTarget: { kind: "subagent", agentKey: "eco_explore", additionalMessage: "先补测试" },
  });
});

test("parseThreadApprovePlanPayload accepts the main execution target", () => {
  expect(parseThreadApprovePlanPayload({ ...envelope, executionTarget: { kind: "main" } })).toEqual({
    ...envelope,
    executionTarget: { kind: "main" },
  });
});

test("parseThreadApprovePlanPayload rejects a subagent target without agentKey", () => {
  expect(() =>
    parseThreadApprovePlanPayload({
      ...envelope,
      executionTarget: { kind: "subagent" },
    }),
  ).toThrow("agentKey");
});

test("parseThreadApprovePlanPayload rejects an unknown execution target kind", () => {
  expect(() =>
    parseThreadApprovePlanPayload({ ...envelope, executionTarget: { kind: "robot" } }),
  ).toThrow("未知的计划执行目标");
});

test("parseThreadApprovePlanPayload omits the execution target when absent", () => {
  expect(parseThreadApprovePlanPayload(envelope)).toEqual(envelope);
  expect(parseThreadApprovePlanPayload({ ...envelope, executionTarget: undefined })).toEqual(envelope);
});

test("parseThreadDismissPlanPayload requires the V2 command envelope", () => {
  expect(parseThreadDismissPlanPayload(envelope)).toEqual(envelope);
  expect(() => parseThreadDismissPlanPayload("thr_1")).toThrow(
    "Invalid plan dismissal command envelope",
  );
});
