import { expect, test } from "bun:test";
import type { ParsedUsage, RequestBillingDelta } from "@eco/runtime";
import {
  buildSubagentContextObservationInput,
  buildSubagentLegacyMetricsRecordInput,
  resolveSubagentBillingMetricsContext,
  type UsageContextSnapshot,
} from "../src/main/subagent-billing-metrics-effects";

const usage: ParsedUsage = {
  inputTokens: 1_000,
  outputTokens: 300,
  cacheReadTokens: 200,
  cacheCreationTokens: 50,
};

const billing: RequestBillingDelta = {
  plannerTokenCostUsd: 0.02,
  ecoCostUsd: 0.01,
  plannerBreakdown: null,
  ecoBreakdown: {
    inputUsd: 0.005,
    outputUsd: 0.004,
    cacheReadUsd: 0.0005,
    cacheCreationUsd: 0.0005,
    totalUsd: 0.01,
  },
  pricingResolved: true,
};

function snapshotWithInstance(): UsageContextSnapshot {
  return {
    occupied: 12_000,
    limit: 100_000,
    ratio: 0.12,
    occupancyPct: 12,
    limitsResolved: true,
    roles: [],
    instances: [
      {
        agentId: "agent_coder",
        role: "coder",
        occupied: 8_765,
        limit: 64_000,
        occupancyPct: 14,
        limitsResolved: true,
        segments: [],
        updatedAt: 1,
      },
    ],
  };
}

test("resolveSubagentBillingMetricsContext uses the matching instance snapshot", () => {
  expect(
    resolveSubagentBillingMetricsContext({
      role: "coder",
      agentId: "agent_coder",
      snapshot: snapshotWithInstance(),
      fallbackUsage: usage,
    }),
  ).toEqual({
    role: "coder",
    agentId: "agent_coder",
    contextOccupied: 8_765,
    contextLimit: 64_000,
  });
});

test("resolveSubagentBillingMetricsContext skips non-subagents and missing agents", () => {
  expect(
    resolveSubagentBillingMetricsContext({
      role: "planner",
      agentId: "agent_planner",
      snapshot: snapshotWithInstance(),
      fallbackUsage: usage,
    }),
  ).toBeUndefined();
  expect(
    resolveSubagentBillingMetricsContext({
      role: "coder",
      snapshot: snapshotWithInstance(),
      fallbackUsage: usage,
    }),
  ).toBeUndefined();
});

test("resolveSubagentBillingMetricsContext falls back to input and cache occupancy", () => {
  expect(
    resolveSubagentBillingMetricsContext({
      role: "coder",
      agentId: "agent_coder",
      snapshot: undefined,
      fallbackUsage: usage,
    }),
  ).toEqual({
    role: "coder",
    agentId: "agent_coder",
    contextOccupied: 1_250,
  });
});

test("subagent billing metrics builders keep observation and legacy record fields aligned", () => {
  const context = resolveSubagentBillingMetricsContext({
    role: "coder",
    agentId: "agent_coder",
    snapshot: snapshotWithInstance(),
    fallbackUsage: usage,
  });
  expect(context).toBeDefined();

  const observation = buildSubagentContextObservationInput(context!, {
    parentToolUseId: "toolu_parent",
    modelId: "claude-haiku",
    requestKey: "sdk-result:event_1",
  });
  expect(observation).toEqual({
    role: "coder",
    agentId: "agent_coder",
    parentToolUseId: "toolu_parent",
    contextOccupied: 8_765,
    contextLimit: 64_000,
    modelId: "claude-haiku",
    requestKey: "sdk-result:event_1",
  });

  expect(
    buildSubagentLegacyMetricsRecordInput(context!, {
      role: "reviewer",
      parentToolUseId: "toolu_parent",
      usage,
      billing,
      modelId: "claude-haiku",
      requestKey: "sdk-result:event_1",
    }),
  ).toEqual({
    role: "reviewer",
    agentId: "agent_coder",
    parentToolUseId: "toolu_parent",
    usage,
    contextOccupied: 8_765,
    contextLimit: 64_000,
    billing,
    modelId: "claude-haiku",
    requestKey: "sdk-result:event_1",
  });
});
