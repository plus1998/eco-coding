import { expect, test } from "bun:test";
import { shouldHandoffSubagentResume } from "../src/subagent-handoff";

test("shouldHandoffSubagentResume triggers at compact limit threshold", () => {
  expect(shouldHandoffSubagentResume(100_000, 120_000, 0.85)).toBe(false);
  expect(shouldHandoffSubagentResume(102_000, 120_000, 0.85)).toBe(true);
  expect(shouldHandoffSubagentResume(0, 120_000, 0.85)).toBe(false);
});
