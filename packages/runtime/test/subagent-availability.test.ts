import { expect, test } from "bun:test";
import { normalizeSubagentAvailability } from "../src/subagent-availability";

test("normalizeSubagentAvailability forces coder on", () => {
  const availability = normalizeSubagentAvailability({
    explore: false,
    architect: false,
    coder: false,
    reviewer: true,
    tester: true,
  });
  expect(availability.coder).toBe(true);
  expect(availability.explore).toBe(false);
});
