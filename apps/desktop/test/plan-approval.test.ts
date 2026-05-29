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
