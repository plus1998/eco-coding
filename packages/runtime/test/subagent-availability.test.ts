import { expect, test } from "bun:test";
import {
  ecoSubagentKeyForRole,
  effectiveSubagentAvailability,
  filterAgentDefinitions,
  normalizeSubagentAvailability,
  SDK_EXPLORE_AGENT_KEY,
  sdkBuiltinSubagentDenyRules,
} from "../src/subagent-availability";

test("normalizeSubagentAvailability keeps Explore enabled and respects disabled coder", () => {
  const availability = normalizeSubagentAvailability({
    explore: false,
    architect: false,
    coder: false,
    reviewer: true,
    tester: true,
  });
  expect(availability.coder).toBe(false);
  expect(availability.explore).toBe(true);
});

test("filterAgentDefinitions always omits SDK built-in Explore definitions", () => {
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

test("sdkBuiltinSubagentDenyRules leaves general-purpose open", () => {
  const deny = sdkBuiltinSubagentDenyRules();
  expect(deny).not.toContain("Agent(general-purpose)");
  expect(deny).toContain("Agent(Explore)");
  expect(deny).toContain("Agent(Plan)");
  expect(deny).toContain("Agent(Bash)");
  expect(deny).toContain("Agent(statusline-setup)");
});

test("sdkBuiltinSubagentDenyRules can open Plan for plan mode", () => {
  const deny = sdkBuiltinSubagentDenyRules(["Plan"]);
  expect(deny).not.toContain("Agent(general-purpose)");
  expect(deny).not.toContain("Agent(Plan)");
  expect(deny).toContain("Agent(Explore)");
  expect(deny).toContain("Agent(Bash)");
  expect(deny).toContain("Agent(statusline-setup)");
});

test("effectiveSubagentAvailability disables optional roles without model routes", () => {
  const availability = normalizeSubagentAvailability({
    architect: true,
    coder: true,
    reviewer: true,
    tester: true,
  });
  const effective = effectiveSubagentAvailability(availability, [
    { role: "explore", primary: { modelId: "explore-model" } },
    { role: "coder", primary: { modelId: "coder-model" } },
  ]);
  expect(effective.architect).toBe(false);
  expect(effective.reviewer).toBe(false);
  expect(effective.tester).toBe(false);
  expect(effective.coder).toBe(true);
});
