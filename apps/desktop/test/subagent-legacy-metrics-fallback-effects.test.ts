import { expect, test } from "bun:test";
import type { ThreadBillingSnapshot } from "../src/shared/ipc";
import {
  applySubagentLegacyMetricsFallback,
  type SubagentLegacyMetricsRecordInput,
} from "../src/main/subagent-legacy-metrics-fallback-effects";
import type { UsageLedgerBillingSnapshotSelection } from "../src/main/usage-ledger-coordinator";

const totalTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

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

test("applySubagentLegacyMetricsFallback always keeps ledger projection selection", () => {
  const records: SubagentLegacyMetricsRecordInput[] = [];
  const billingSelection = selection({
    source: "ledger",
    ledgerSnapshot: billingSnapshot({ primarySource: "sdk" }),
  });

  const applied = applySubagentLegacyMetricsFallback({
    threadId: "thr_legacy_fallback",
    hasSubagentContext: true,
    billingSelection,
    legacyBilling: billingSnapshot({ primarySource: "proxy" }),
    selectionOptions: { useLedgerProjection: true, plannerModelLabel: "Planner" },
    records: [
      {
        role: "coder",
        agentId: "agent_coder",
        usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 },
        contextOccupied: 1,
        requestKey: "sdk-result:evt",
      },
    ],
    services: {
      recordSdkUsage: (_threadId, record) => records.push(record),
      resolveBillingSnapshot: () => {
        throw new Error("legacy billing fallback must not reselect snapshots");
      },
    },
  });

  expect(applied).toEqual({
    billingSelection,
    recorded: false,
    recordCount: 0,
    reason: "ledger_projection_primary",
  });
  expect(records).toEqual([]);
});

test("applySubagentLegacyMetricsFallback does not record legacy metrics when projection is unavailable", () => {
  const records: SubagentLegacyMetricsRecordInput[] = [];
  const legacyBilling = billingSnapshot({ primarySource: "proxy" });
  const legacySelection = selection({ snapshot: legacyBilling, legacySnapshot: legacyBilling });

  const applied = applySubagentLegacyMetricsFallback({
    threadId: "thr_legacy_fallback",
    hasSubagentContext: true,
    billingSelection: legacySelection,
    legacyBilling,
    selectionOptions: { useLedgerProjection: true, plannerModelLabel: "Planner" },
    records: [
      {
        role: "coder",
        agentId: "agent_coder",
        usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 },
        contextOccupied: 3,
        requestKey: "sdk-result:evt",
        modelId: "haiku",
      },
    ],
    services: {
      recordSdkUsage: (_threadId, record) => records.push(record),
      resolveBillingSnapshot: () => {
        throw new Error("legacy billing fallback must not reselect snapshots");
      },
    },
  });

  expect(records).toEqual([]);
  expect(applied).toEqual({
    billingSelection: legacySelection,
    recorded: false,
    recordCount: 0,
    reason: "ledger_projection_primary",
  });
});
