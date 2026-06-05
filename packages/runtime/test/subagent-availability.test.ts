import { expect, test } from "bun:test";
import {
  filterAgentDefinitions,
  normalizeSubagentAvailability,
  SDK_EXPLORE_AGENT_KEY,
} from "../src/subagent-availability";

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

test("filterAgentDefinitions omits Explore when explore is disabled", () => {
  const availability = normalizeSubagentAvailability({ explore: false });
  const filtered = filterAgentDefinitions(
    {
      [SDK_EXPLORE_AGENT_KEY]: { model: "eco-explore-1" },
      architect: { model: "eco-architect-1" },
    },
    availability,
  );
  expect(filtered).not.toHaveProperty(SDK_EXPLORE_AGENT_KEY);
  expect(filtered.architect).toBeDefined();
});
