import { expect, test } from "bun:test";
import { computeRequestBilling, type ModelCostRates, type ParsedUsage } from "@eco/runtime";
import {
  createBuiltInPresetE2ETaskScenarios,
  createBuiltInPresetE2ETaskSuiteReport,
  runPresetE2ETaskScenario,
} from "../src/shared/agent-preset-e2e";
import { projectBillingFromUsageLedger } from "../src/main/billing-projector";
import { buildSingleUsageLedgerEvent } from "../src/main/usage-ledger-adapters";

const launchGateRates: ModelCostRates = {
  input: 0.8,
  output: 4,
  cacheRead: 0.08,
  cacheWrite: 1,
};

test("built-in preset E2E scenarios cover three tasks for every preset", () => {
  const scenarios = createBuiltInPresetE2ETaskScenarios();
  expect(scenarios).toHaveLength(18);
  expect(new Set(scenarios.map((scenario) => scenario.presetId))).toEqual(
    new Set(["coding", "research", "writing", "product", "data", "ops"]),
  );

  const counts = new Map<string, number>();
  for (const scenario of scenarios) {
    counts.set(scenario.presetId, (counts.get(scenario.presetId) ?? 0) + 1);
    expect(scenario.expectedOutcome.trim().length).toBeGreaterThan(10);
    expect(scenario.successCriteria).toHaveLength(3);
    expect(scenario.requiredAgentKeys.length).toBeGreaterThan(0);
  }
  expect([...counts.values()]).toEqual([3, 3, 3, 3, 3, 3]);
});

test("built-in preset E2E suite runs runtime, workflow, permission, and artifact gates", () => {
  const report = createBuiltInPresetE2ETaskSuiteReport();

  expect(report.ok).toBe(true);
  expect(report.scenarioCount).toBe(18);
  expect(report.scenariosPerPreset).toEqual({
    coding: 3,
    research: 3,
    writing: 3,
    product: 3,
    data: 3,
    ops: 3,
  });
  expect(report.results.flatMap((result) => result.errors)).toEqual([]);
  for (const result of report.results) {
    expect(result.runtimeAgentKeys.length).toBeGreaterThanOrEqual(3);
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.finalArtifact).toContain("Acceptance coverage:");
  }
});

test("preset E2E gate rejects a task whose required agent is disabled", () => {
  const scenario = createBuiltInPresetE2ETaskScenarios().find(
    (candidate) => candidate.id === "ops.ops-runbook",
  );
  if (!scenario) {
    throw new Error("Missing ops runbook E2E scenario.");
  }
  const broken = {
    ...scenario,
    profile: {
      ...scenario.profile,
      agents: scenario.profile.agents.map((agent) =>
        agent.agentKey === "runbook_executor" ? { ...agent, enabled: false } : agent,
      ),
    },
  };

  const result = runPresetE2ETaskScenario(broken);

  expect(result.ok).toBe(false);
  expect(result.errors).toContain("Required E2E agent is not enabled: runbook_executor");
  expect(result.errors).toContain("Workflow step references disabled or missing agent: runbook -> runbook_executor");
});

test("preset E2E workflow outputs can be attributed by billing projector", () => {
  const scenario = createBuiltInPresetE2ETaskScenarios().find(
    (candidate) => candidate.id === "data.data-report",
  );
  if (!scenario) {
    throw new Error("Missing data report E2E scenario.");
  }
  const result = runPresetE2ETaskScenario(scenario);
  const events = result.steps.map((step, index) => {
    const usage = usageFor(index + 1);
    return buildSingleUsageLedgerEvent({
      threadId: "thr_preset_e2e",
      role: step.agentKey,
      source: "sdk",
      sourceEventId: `sdk:e2e:${step.stepId}`,
      requestKey: `sdk:e2e:${step.stepId}`,
      usage,
      computedBilling: computeRequestBilling(usage, launchGateRates, launchGateRates),
      agentId: `agent_${step.agentKey}`,
      modelId: scenario.profile.agents.find((agent) => agent.agentKey === step.agentKey)?.modelRef.modelId,
      metadata: {
        ecoWorkflowStep: {
          id: step.stepId,
          agentKey: step.agentKey,
          outputKey: step.outputKey,
          attempt: 1,
          batchIndex: step.batchIndex,
        },
      },
    });
  });

  const projection = projectBillingFromUsageLedger({ events });

  expect(result.ok).toBe(true);
  expect(projection.unresolvedEventCount).toBe(0);
  expect(projection.snapshot?.workflowSteps).toHaveLength(result.steps.length);
  expect(projection.snapshot?.pricingResolved).toBe(true);
  expect(projection.snapshot?.ecoCostUsd ?? 0).toBeGreaterThan(0);
  for (const step of result.steps) {
    expect(projection.snapshot?.byRole?.[step.agentKey]?.inputTokens).toBeGreaterThan(0);
  }
});

function usageFor(multiplier: number): ParsedUsage {
  return {
    inputTokens: 1_000 * multiplier,
    outputTokens: 250 * multiplier,
    cacheReadTokens: 80 * multiplier,
    cacheCreationTokens: 20 * multiplier,
  };
}
