import { expect, test } from "bun:test";
import {
  ecoSubagentKeyForRole,
  filterAgentDefinitions,
  normalizeSubagentAvailability,
  SDK_EXPLORE_AGENT_KEY,
} from "../src/subagent-availability";

test("normalizeSubagentAvailability respects disabled coder", () => {
  const availability = normalizeSubagentAvailability({
    explore: false,
    architect: false,
    coder: false,
    reviewer: true,
    tester: true,
  });
  expect(availability.coder).toBe(false);
  expect(availability.explore).toBe(false);
});

test("filterAgentDefinitions omits Explore when explore is disabled", () => {
  const availability = normalizeSubagentAvailability({ explore: false });
  const filtered = filterAgentDefinitions(
    {
      [SDK_EXPLORE_AGENT_KEY]: { model: "eco-explore-1" },
      [ecoSubagentKeyForRole("architect")]: { model: "eco-architect-1" },
    },
    availability,
  );
  expect(filtered).not.toHaveProperty(SDK_EXPLORE_AGENT_KEY);
  expect(filtered[ecoSubagentKeyForRole("architect")]).toBeDefined();
});

test("filterAgentDefinitions maps eco keys to availability roles", () => {
  const availability = normalizeSubagentAvailability({ reviewer: false });
  const filtered = filterAgentDefinitions(
    {
      [ecoSubagentKeyForRole("coder")]: { model: "eco-coder-1" },
      [ecoSubagentKeyForRole("reviewer")]: { model: "eco-reviewer-1" },
    },
    availability,
  );
  expect(filtered[ecoSubagentKeyForRole("coder")]).toBeDefined();
  expect(filtered).not.toHaveProperty(ecoSubagentKeyForRole("reviewer"));
});
