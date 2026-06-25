import { expect, test } from "bun:test";
import {
  createBuiltInPresetEvalScenarios,
  validateBuiltInPresetEvalScenario,
  validateBuiltInPresetEvalSuite,
} from "../src/shared/agent-preset-evals";
import { createBuiltInPresetCatalog } from "../src/shared/agent-orchestration";

test("built-in preset eval suite expands every catalog eval case", () => {
  const scenarios = createBuiltInPresetEvalScenarios();
  const expectedCount = createBuiltInPresetCatalog().reduce(
    (total, preset) => total + preset.evals.length,
    0,
  );
  expect(scenarios).toHaveLength(expectedCount);
  expect(new Set(scenarios.map((scenario) => scenario.presetId))).toEqual(
    new Set(createBuiltInPresetCatalog().map((preset) => preset.id)),
  );
  for (const scenario of scenarios) {
    expect(scenario.profile.agents.length).toBeGreaterThanOrEqual(3);
    expect(scenario.successCriteria).toHaveLength(3);
    expect(scenario.expectedAgentKeys.length).toBeGreaterThan(0);
  }
});

test("built-in preset eval suite validates runnable profiles and prompt boundaries", () => {
  const results = validateBuiltInPresetEvalSuite();
  expect(results.every((result) => result.ok)).toBe(true);
  expect(results.flatMap((result) => result.errors)).toEqual([]);
});

test("preset eval validation reports missing expected agents", () => {
  const scenario = createBuiltInPresetEvalScenarios().find(
    (candidate) => candidate.id === "coding.coding-regression",
  );
  if (!scenario) {
    throw new Error("Missing coding regression eval scenario.");
  }
  const broken = {
    ...scenario,
    profile: {
      ...scenario.profile,
      agents: scenario.profile.agents.filter((agent) => agent.agentKey !== "coder"),
    },
  };
  const result = validateBuiltInPresetEvalScenario(broken);
  expect(result.ok).toBe(false);
  expect(result.errors).toContain("Expected agent is not enabled: coder");
});
