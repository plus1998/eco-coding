import { expect, test } from "bun:test";
import { computeRequestBilling, emptyCostBreakdown, type ParsedUsage } from "@eco/runtime";
import {
  projectBillingFromUsageLedger,
} from "../src/main/billing-projector";
import {
  reconcileBillingProjectionWithLegacy,
} from "../src/main/billing-projector-reconciliation";
import { buildSingleUsageLedgerEvent } from "../src/main/usage-ledger-adapters";
import { ThreadUsageAccumulator } from "../src/main/thread-usage-accumulator";
import type { SubagentMetricsEntry } from "../src/main/subagent-metrics-registry";

const sonnetRates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
const haikuRates = { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 };

function usage(inputTokens = 10_000): ParsedUsage {
  return { inputTokens, outputTokens: 1_000, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

function buildProxyEvent(delta = usage()) {
  return buildSingleUsageLedgerEvent({
    threadId: "thr_reconcile",
    role: "coder",
    source: "proxy",
    sourceEventId: "proxy:coder:req_1",
    requestKey: "proxy:coder:req_1",
    usage: delta,
    computedBilling: computeRequestBilling(delta, haikuRates, sonnetRates),
    runAttemptId: "attempt_1",
    agentId: "agent_coder",
    modelId: "haiku",
  });
}

function buildLegacyBilling(delta = usage(), includeSyntheticSdk = false) {
  const accumulator = new ThreadUsageAccumulator();
  accumulator.recordUsage({
    threadId: "thr_reconcile",
    role: "coder",
    source: "proxy",
    delta,
    actualRates: haikuRates,
    plannerRates: sonnetRates,
    modelId: "haiku",
    requestKey: "proxy:coder:req_1",
  });
  if (includeSyntheticSdk) {
    accumulator.recordUsage({
      threadId: "thr_reconcile",
      role: "coder",
      source: "sdk",
      delta,
      actualRates: haikuRates,
      plannerRates: sonnetRates,
      modelId: "haiku",
      requestKey: "sdk:proxy-subagent:proxy:coder:req_1",
    });
  }
  return accumulator.getSnapshot("thr_reconcile");
}

function metric(delta = usage()): SubagentMetricsEntry {
  const billing = computeRequestBilling(delta, haikuRates, sonnetRates);
  return {
    agentId: "agent_coder",
    role: "coder",
    status: "stopped",
    usage: delta,
    contextOccupied: 0,
    ecoCostUsd: billing.ecoCostUsd,
    ecoCostBreakdown: billing.ecoBreakdown ?? emptyCostBreakdown(),
    modelId: "haiku",
    updatedAt: 1,
  };
}

test("reconcileBillingProjectionWithLegacy passes when billing and subagent metrics match", () => {
  const delta = usage();
  const projection = projectBillingFromUsageLedger({ events: [buildProxyEvent(delta)] });
  const legacy = buildLegacyBilling(delta);

  const result = reconcileBillingProjectionWithLegacy(projection, legacy, {
    subagentMetrics: [metric(delta)],
  });

  expect(result.ok).toBe(true);
  expect(result.issues).toEqual([]);
});

test("reconcileBillingProjectionWithLegacy marks synthetic SDK primary as compatibility info", () => {
  const delta = usage();
  const projection = projectBillingFromUsageLedger({ events: [buildProxyEvent(delta)] });
  const legacy = buildLegacyBilling(delta, true);

  const result = reconcileBillingProjectionWithLegacy(projection, legacy, {
    subagentMetrics: [metric(delta)],
  });

  expect(result.ok).toBe(true);
  expect(result.issues).toContainEqual(
    expect.objectContaining({
      type: "synthetic_sdk_primary",
      severity: "info",
    }),
  );
});

test("reconcileBillingProjectionWithLegacy reports subagent metric token drift", () => {
  const projection = projectBillingFromUsageLedger({ events: [buildProxyEvent(usage(10_000))] });
  const legacy = projection.snapshot;

  const result = reconcileBillingProjectionWithLegacy(projection, legacy, {
    subagentMetrics: [metric(usage(9_000))],
  });

  expect(result.ok).toBe(false);
  expect(result.issues).toContainEqual(
    expect.objectContaining({
      type: "subagent_token_mismatch",
      severity: "error",
      agentId: "agent_coder",
      field: "input",
    }),
  );
});
