import { expect, test } from "bun:test";
import {
  createBuiltInPresetEvalScenarios,
  validateBuiltInPresetEvalScenario,
  validateBuiltInPresetEvalSuite,
} from "../src/shared/agent-preset-evals";

test("built-in preset eval suite expands every preset case", () => {
  const scenarios = createBuiltInPresetEvalScenarios();
  expect(scenarios).toHaveLength(18);
  expect(new Set(scenarios.map((scenario) => scenario.presetId))).toEqual(
    new Set(["coding", "research", "writing", "product", "data", "ops"]),
  );
  for (const scenario of scenarios) {
    expect(scenario.profile.agents.length).toBeGreaterThanOrEqual(3);
    expect(scenario.successCriteria).toHaveLength(3);
    expect(scenario.requiredAgentKeys.length).toBeGreaterThan(0);
  }
});

test("built-in preset eval suite validates runnable profiles and prompt boundaries", () => {
  const results = validateBuiltInPresetEvalSuite();
  expect(results.every((result) => result.ok)).toBe(true);
  expect(results.flatMap((result) => result.errors)).toEqual([]);
});

test("preset eval validation reports missing required agents", () => {
  const scenario = createBuiltInPresetEvalScenarios().find(
    (candidate) => candidate.id === "research.research-citation-support",
  );
  if (!scenario) {
    throw new Error("Missing research citation eval scenario.");
  }
  const broken = {
    ...scenario,
    profile: {
      ...scenario.profile,
      agents: scenario.profile.agents.filter((agent) => agent.agentKey !== "source_verifier"),
    },
  };
  const result = validateBuiltInPresetEvalScenario(broken);
  expect(result.ok).toBe(false);
  expect(result.errors).toContain("Required agent is not enabled: source_verifier");
});
