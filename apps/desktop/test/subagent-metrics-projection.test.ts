import { expect, test } from "bun:test";
import { computeRequestBilling, emptyCostBreakdown } from "@eco/runtime";
import { projectBillingFromUsageLedger } from "../src/main/billing-projector";
import { projectSubagentMetricsEntriesFromBillingProjection } from "../src/main/subagent-metrics-projection";
import { buildSingleUsageLedgerEvent } from "../src/main/usage-ledger-adapters";
import type { SubagentMetricsEntry } from "../src/main/subagent-metrics-registry";

const sonnetRates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
const haikuRates = { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 };

function existingEntry(inputTokens: number): SubagentMetricsEntry {
  return {
    agentId: "agent_coder",
    role: "coder",
    status: "active",
    usage: { inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    contextOccupied: 1234,
    contextLimit: 100_000,
    ecoCostUsd: 99,
    ecoCostBreakdown: emptyCostBreakdown(),
    modelId: "legacy-model",
    lastRequestKey: "legacy:req",
    updatedAt: 42,
  };
}

test("projectSubagentMetricsEntriesFromBillingProjection uses ledger billing and preserves context", () => {
  const usage = { inputTokens: 10_000, outputTokens: 1_000, cacheReadTokens: 0, cacheCreationTokens: 0 };
  const projection = projectBillingFromUsageLedger({
    events: [
      buildSingleUsageLedgerEvent({
        threadId: "thr_projection",
        role: "coder",
        source: "proxy",
        sourceEventId: "proxy:coder:req_1",
        usage,
        computedBilling: computeRequestBilling(usage, haikuRates, sonnetRates),
        agentId: "agent_coder",
        modelId: "haiku",
      }),
    ],
  });

  const [entry] = projectSubagentMetricsEntriesFromBillingProjection({
    projection,
    existingEntries: [existingEntry(1)],
    now: 100,
  });

  expect(entry?.usage.inputTokens).toBe(10_000);
  expect(entry?.usage.outputTokens).toBe(1_000);
  expect(entry?.ecoCostUsd).toBeCloseTo(0.012, 4);
  expect(entry?.contextOccupied).toBe(1234);
  expect(entry?.contextLimit).toBe(100_000);
  expect(entry?.status).toBe("active");
  expect(entry?.modelId).toBe("haiku");
  expect(entry?.lastRequestKey).toBe("legacy:req");
});

test("projectSubagentMetricsEntriesFromBillingProjection keeps existing active rows without ledger usage", () => {
  const existing = existingEntry(0);
  const entries = projectSubagentMetricsEntriesFromBillingProjection({
    projection: projectBillingFromUsageLedger({ events: [] }),
    existingEntries: [existing],
    now: 100,
  });

  expect(entries).toEqual([existing]);
});
