import { expect, test } from "bun:test";
import { computeSubagentSessionDurationMs } from "../src/shared/subagent-session-timing";

test("computeSubagentSessionDurationMs sums accumulated and active segment", () => {
  const lastActiveAt = new Date(Date.now() - 5000).toISOString();
  expect(
    computeSubagentSessionDurationMs({ status: "active", accumulatedMs: 10_000, lastActiveAt }, Date.now()),
  ).toBeGreaterThanOrEqual(14_500);
  expect(
    computeSubagentSessionDurationMs({ status: "stopped", accumulatedMs: 42_000, lastActiveAt }, Date.now()),
  ).toBe(42_000);
});
