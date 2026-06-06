import { expect, test } from "bun:test";
import { emptyCostBreakdown } from "@eco/runtime";
import { SubagentLegacyUsageTracker } from "../src/main/subagent-legacy-usage";
import { SubagentMetricsState } from "../src/main/subagent-metrics-state";

function billing(ecoCostUsd: number) {
  return {
    ecoCostUsd,
    plannerTokenCostUsd: 0,
    ecoBreakdown: {
      inputUsd: ecoCostUsd / 4,
      outputUsd: ecoCostUsd / 4,
      cacheReadUsd: ecoCostUsd / 4,
      cacheCreationUsd: ecoCostUsd / 4,
      totalUsd: ecoCostUsd,
    },
    plannerBreakdown: emptyCostBreakdown(),
    pricingResolved: false,
  };
}

test("SubagentLegacyUsageTracker records usage cost and context", () => {
  const metrics = new SubagentMetricsState();
  const tracker = new SubagentLegacyUsageTracker();

  const result = tracker.record(
    metrics,
    {
      agentId: "agent_coder_a",
      role: "coder",
      usage: {
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 50,
        cacheCreationTokens: 10,
      },
      contextOccupied: 1260,
      contextLimit: 100_000,
      billing: billing(0.01),
      modelId: "claude-test",
      requestKey: "sdk-result:evt_1",
    },
    100,
  );

  expect(result.deduped).toBe(false);
  if (result.deduped) {
    throw new Error("expected first legacy usage record to be billable");
  }
  expect(result.entry.usage.inputTokens).toBe(1000);
  expect(result.entry.usage.outputTokens).toBe(200);
  expect(result.entry.ecoCostUsd).toBeCloseTo(0.01);
  expect(result.entry.ecoCostBreakdown.totalUsd).toBeCloseTo(0.01);
  expect(result.entry.contextOccupied).toBe(1260);
  expect(result.entry.contextLimit).toBe(100_000);
  expect(result.entry.modelId).toBe("claude-test");
  expect(result.entry.lastRequestKey).toBe("sdk-result:evt_1");
  expect(result.entry.updatedAt).toBe(100);
});

test("SubagentLegacyUsageTracker dedupes by agent role request and model", () => {
  const metrics = new SubagentMetricsState();
  const tracker = new SubagentLegacyUsageTracker();
  const usage = {
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 50,
    cacheCreationTokens: 10,
  };

  tracker.record(
    metrics,
    {
      agentId: "agent_reviewer_a",
      role: "reviewer",
      usage,
      contextOccupied: 1260,
      billing: billing(0.01),
      modelId: "model-a",
      requestKey: "sdk-result:evt_2",
    },
    100,
  );
  const deduped = tracker.record(
    metrics,
    {
      agentId: "agent_reviewer_a",
      role: "reviewer",
      usage,
      contextOccupied: 1260,
      billing: billing(0.01),
      modelId: "model-a",
      requestKey: "sdk-result:evt_2",
    },
    200,
  );
  expect(deduped.deduped).toBe(true);
  expect(deduped.entry?.usage.inputTokens).toBe(1000);
  expect(deduped.entry?.ecoCostUsd).toBeCloseTo(0.01);

  const otherModel = tracker.record(
    metrics,
    {
      agentId: "agent_reviewer_a",
      role: "reviewer",
      usage,
      contextOccupied: 1260,
      billing: billing(0.01),
      modelId: "model-b",
      requestKey: "sdk-result:evt_2",
    },
    300,
  );

  expect(otherModel.deduped).toBe(false);
  if (otherModel.deduped) {
    throw new Error("expected different model to be billable");
  }
  expect(otherModel.entry.usage.inputTokens).toBe(2000);
  expect(otherModel.entry.ecoCostUsd).toBeCloseTo(0.02);
  expect(otherModel.entry.updatedAt).toBe(300);
});

test("SubagentLegacyUsageTracker records observations for a resolved target", () => {
  const metrics = new SubagentMetricsState();
  const tracker = new SubagentLegacyUsageTracker();

  const result = tracker.recordForTarget(
    metrics,
    { agentId: "agent_architect_a", role: "architect" },
    {
      usage: {
        inputTokens: 600,
        outputTokens: 80,
        cacheReadTokens: 20,
        cacheCreationTokens: 0,
      },
      contextOccupied: 700,
      billing: billing(0.02),
      modelId: "model-architect",
      requestKey: "sdk-result:evt_target",
    },
    400,
  );

  expect(result.deduped).toBe(false);
  if (result.deduped) {
    throw new Error("expected target observation to be billable");
  }
  expect(result.entry.agentId).toBe("agent_architect_a");
  expect(result.entry.role).toBe("architect");
  expect(result.entry.usage.inputTokens).toBe(600);
  expect(result.entry.ecoCostUsd).toBeCloseTo(0.02);
  expect(result.entry.modelId).toBe("model-architect");
  expect(result.entry.updatedAt).toBe(400);
});

test("SubagentLegacyUsageTracker restores contribution keys before replay", () => {
  const metrics = new SubagentMetricsState();
  const tracker = new SubagentLegacyUsageTracker();
  const entry = metrics.ensureEntry("agent_tester_a", "tester", "active", 100);
  entry.modelId = "model-restored";
  entry.lastRequestKey = "sdk-result:evt_restore";
  entry.usage = {
    inputTokens: 300,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };

  tracker.restoreContribution({
    agentId: "agent_tester_a",
    role: "tester",
    requestKey: "sdk-result:evt_restore",
    modelId: "model-restored",
  });

  const replay = tracker.record(
    metrics,
    {
      agentId: "agent_tester_a",
      role: "tester",
      usage: {
        inputTokens: 300,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      contextOccupied: 320,
      billing: billing(0.01),
      modelId: "model-restored",
      requestKey: "sdk-result:evt_restore",
    },
    200,
  );

  expect(replay.deduped).toBe(true);
  expect(replay.entry?.usage.inputTokens).toBe(300);
  expect(replay.entry?.ecoCostUsd).toBe(0);
  expect(replay.entry?.updatedAt).toBe(100);
});
