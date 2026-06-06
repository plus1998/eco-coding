import { expect, test } from "bun:test";
import type { ParsedUsage, RequestBillingDelta } from "@eco/runtime";
import type { ThreadBillingSnapshot } from "../src/shared/ipc";
import type { SubagentBillingMetricsContext } from "../src/main/subagent-billing-metrics-effects";
import type { SubagentLegacyMetricsRecordInput } from "../src/main/subagent-legacy-metrics-fallback-effects";
import {
  applySdkRunSubagentLegacyFallback,
  applySingleUsageSubagentLegacyFallback,
} from "../src/main/usage-subagent-legacy-fallback";
import type { UsageLedgerBillingSnapshotSelection } from "../src/main/usage-ledger-coordinator";

const totalTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

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

const context: SubagentBillingMetricsContext = {
  role: "coder",
  agentId: "agent_coder",
  contextOccupied: 8_765,
  contextLimit: 64_000,
};

function billingSnapshot(input: Partial<ThreadBillingSnapshot> = {}): ThreadBillingSnapshot {
  return {
    primarySource: "sdk",
    totalTokens,
    totalCostUsd: 0,
    totalSavingsUsd: 0,
    plannerCostUsd: 0,
    ecoCostUsd: 0,
    otelCostUsd: 0,
    ...input,
  };
}

function selection(
  input: Partial<UsageLedgerBillingSnapshotSelection> = {},
): UsageLedgerBillingSnapshotSelection {
  const legacySnapshot = billingSnapshot({ primarySource: "proxy" });
  return {
    snapshot: input.snapshot ?? legacySnapshot,
    source: input.source ?? "legacy",
    legacySnapshot: input.legacySnapshot ?? legacySnapshot,
    ...(input.ledgerSnapshot && { ledgerSnapshot: input.ledgerSnapshot }),
    ...(input.reconciliation && { reconciliation: input.reconciliation }),
  };
}

test("applySingleUsageSubagentLegacyFallback records one legacy record from single usage context", () => {
  const records: SubagentLegacyMetricsRecordInput[] = [];
  const selectionOptions: unknown[] = [];
  const legacyBilling = billingSnapshot({ primarySource: "proxy" });

  const applied = applySingleUsageSubagentLegacyFallback({
    threadId: "thr_single_legacy_fallback",
    context,
    billingSelection: selection({ snapshot: legacyBilling, legacySnapshot: legacyBilling }),
    legacyBilling,
    selectionOptions: { useLedgerProjection: true, plannerModelLabel: "Planner" },
    usage,
    billing,
    modelId: "haiku",
    requestKey: "proxy:coder:req_1",
    services: {
      recordSdkUsage: (_threadId, record) => records.push(record),
      resolveBillingSnapshot: (_threadId, snapshot, options) => {
        selectionOptions.push(options);
        return selection({ snapshot, legacySnapshot: snapshot });
      },
    },
  });

  expect(records).toEqual([
    {
      role: "coder",
      agentId: "agent_coder",
      usage,
      contextOccupied: 8_765,
      contextLimit: 64_000,
      billing,
      modelId: "haiku",
      requestKey: "proxy:coder:req_1",
    },
  ]);
  expect(selectionOptions).toEqual([{ useLedgerProjection: false, plannerModelLabel: "Planner" }]);
  expect(applied.recorded).toBe(true);
  expect(applied.reason).toBe("ledger_projection_unavailable");
});

test("applySingleUsageSubagentLegacyFallback skips old metrics without subagent context", () => {
  const billingSelection = selection();
  const applied = applySingleUsageSubagentLegacyFallback({
    threadId: "thr_missing_context",
    context: undefined,
    billingSelection,
    legacyBilling: billingSnapshot({ primarySource: "proxy" }),
    selectionOptions: { useLedgerProjection: true },
    usage,
    billing,
    requestKey: "proxy:coder:req_missing",
    services: {
      recordSdkUsage: () => {
        throw new Error("missing context must not record legacy metrics");
      },
      resolveBillingSnapshot: () => {
        throw new Error("missing context must not force legacy billing");
      },
    },
  });

  expect(applied).toEqual({
    billingSelection,
    recorded: false,
    reason: "missing_subagent_context",
  });
});

test("applySdkRunSubagentLegacyFallback records one legacy record for each SDK model row", () => {
  const records: SubagentLegacyMetricsRecordInput[] = [];
  const legacyBilling = billingSnapshot({ primarySource: "sdk" });
  const reviewerUsage: ParsedUsage = {
    inputTokens: 500,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };

  const applied = applySdkRunSubagentLegacyFallback({
    threadId: "thr_sdk_legacy_fallback",
    context,
    billingSelection: selection({ snapshot: legacyBilling, legacySnapshot: legacyBilling }),
    legacyBilling,
    selectionOptions: { useLedgerProjection: true },
    models: [
      { role: "coder", usage, computedBilling: billing, modelId: "haiku" },
      { role: "reviewer", usage: reviewerUsage, computedBilling: billing, modelId: "reviewer-haiku" },
    ],
    billingRole: "coder",
    parentToolUseId: "toolu_parent",
    requestKey: "sdk-result:event_1",
    services: {
      recordSdkUsage: (_threadId, record) => records.push(record),
      resolveBillingSnapshot: (_threadId, snapshot) => selection({ snapshot, legacySnapshot: snapshot }),
    },
  });

  expect(records).toEqual([
    {
      role: "coder",
      agentId: "agent_coder",
      parentToolUseId: "toolu_parent",
      usage,
      contextOccupied: 8_765,
      contextLimit: 64_000,
      billing,
      modelId: "haiku",
      requestKey: "sdk-result:event_1",
    },
    {
      role: "reviewer",
      agentId: "agent_coder",
      parentToolUseId: "toolu_parent",
      usage: reviewerUsage,
      contextOccupied: 8_765,
      contextLimit: 64_000,
      billing,
      modelId: "reviewer-haiku",
      requestKey: "sdk-result:event_1",
    },
  ]);
  expect(applied.recorded).toBe(true);
  expect(applied.reason).toBe("ledger_projection_unavailable");
});
