import { expect, test } from "bun:test";
import { computeRequestBilling, type ModelCostRates, type ParsedUsage } from "@eco/runtime";
import {
  createBuiltInPresetCommercialQualityGateReport,
  createBuiltInPresetEvalScenarios,
  validateBuiltInPresetCommercialQualityGateScenario,
} from "../src/shared/agent-preset-evals";
import { createBuiltInAgentTemplates } from "../src/shared/agent-orchestration";
import { projectBillingFromUsageLedger } from "../src/main/billing-projector";
import { buildSingleUsageLedgerEvent } from "../src/main/usage-ledger-adapters";

const launchGateRates: ModelCostRates = {
  input: 0.8,
  output: 4,
  cacheRead: 0.08,
  cacheWrite: 1,
};

test("built-in preset commercial quality gate validates runtime-ready profiles", () => {
  const report = createBuiltInPresetCommercialQualityGateReport();

  expect(report.ok).toBe(true);
  expect(report.scenarioCount).toBe(18);
  expect(report.presetIds).toEqual(["coding", "research", "writing", "product", "data", "ops"]);
  expect(report.runtimeAgentCount).toBeGreaterThanOrEqual(54);
  expect(report.workflowScenarioCount).toBeGreaterThan(0);
  expect(report.results.flatMap((result) => result.errors)).toEqual([]);
});

test("commercial quality gate rejects main prompt leakage of child agent prompts", () => {
  const templates = createBuiltInAgentTemplates();
  const scenario = createBuiltInPresetEvalScenarios().find((candidate) => candidate.presetId === "research");
  if (!scenario) {
    throw new Error("Missing research eval scenario.");
  }
  const childTemplate = templates.find((template) => template.id === scenario.profile.agents[0]?.templateId);
  if (!childTemplate) {
    throw new Error("Missing child template for leakage test.");
  }

  const result = validateBuiltInPresetCommercialQualityGateScenario(
    {
      ...scenario,
      profile: {
        ...scenario.profile,
        mainAgent: {
          ...scenario.profile.mainAgent,
          prompt: `${scenario.profile.mainAgent.prompt}\n\n${childTemplate.prompt}`,
        },
      },
    },
    templates,
  );

  expect(result.ok).toBe(false);
  expect(result.errors).toContain(`Main agent prompt leaks child prompt: ${childTemplate.id}`);
});

test("commercial quality gate covers workflow step cost attribution regression", () => {
  const scenario = createBuiltInPresetEvalScenarios().find((candidate) => candidate.presetId === "research");
  if (!scenario) {
    throw new Error("Missing research eval scenario.");
  }
  const enabledAgents = scenario.profile.agents.filter((agent) => agent.enabled);
  const workflowEvents = enabledAgents.map((agent, index) => {
    const usage = usageFor(index + 1);
    return buildSingleUsageLedgerEvent({
      threadId: "thr_agent_commercial_gate",
      role: agent.agentKey,
      source: "sdk",
      sourceEventId: `sdk:workflow:${agent.agentKey}`,
      requestKey: `sdk:workflow:${agent.agentKey}`,
      usage,
      computedBilling: computeRequestBilling(usage, launchGateRates, launchGateRates),
      agentId: `agent_${agent.agentKey}`,
      modelId: agent.modelRef.modelId,
      metadata: {
        ecoWorkflowStep: {
          id: `step_${index + 1}`,
          agentKey: agent.agentKey,
          outputKey: `${agent.agentKey}_output`,
          attempt: 1,
          batchIndex: index,
        },
      },
    });
  });

  const projection = projectBillingFromUsageLedger({ events: workflowEvents });

  expect(projection.unresolvedEventCount).toBe(0);
  expect(projection.snapshot?.pricingResolved).toBe(true);
  expect(projection.snapshot?.workflowSteps).toHaveLength(enabledAgents.length);
  expect(projection.snapshot?.ecoCostUsd ?? 0).toBeGreaterThan(0);
  expect(projection.snapshot?.ecoCostUsd ?? Number.POSITIVE_INFINITY).toBeLessThan(0.05);
  for (const agent of enabledAgents) {
    expect(projection.snapshot?.byRole?.[agent.agentKey]?.inputTokens).toBeGreaterThan(0);
  }
});

function usageFor(multiplier: number): ParsedUsage {
  return {
    inputTokens: 2_000 * multiplier,
    outputTokens: 400 * multiplier,
    cacheReadTokens: 100 * multiplier,
    cacheCreationTokens: 25 * multiplier,
  };
}
