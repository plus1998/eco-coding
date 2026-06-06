import { expect, test } from "bun:test";
import type { UsageLedgerBillingSnapshotSelection } from "../src/main/usage-ledger-coordinator";
import { resolveSubagentLegacyMetricsFallback } from "../src/main/subagent-legacy-metrics-fallback";

function selection(
  input: Pick<UsageLedgerBillingSnapshotSelection, "ledgerSnapshot">,
): Pick<UsageLedgerBillingSnapshotSelection, "ledgerSnapshot"> {
  return input;
}

test("resolveSubagentLegacyMetricsFallback records when subagent context has no ledger projection", () => {
  expect(
    resolveSubagentLegacyMetricsFallback({
      hasSubagentContext: true,
      billingSelection: selection({}),
    }),
  ).toEqual({ record: true, reason: "ledger_projection_unavailable" });
});

test("resolveSubagentLegacyMetricsFallback skips without subagent context", () => {
  expect(
    resolveSubagentLegacyMetricsFallback({
      hasSubagentContext: false,
      billingSelection: selection({}),
    }),
  ).toEqual({ record: false, reason: "missing_subagent_context" });
});

test("resolveSubagentLegacyMetricsFallback skips when ledger projection is available", () => {
  expect(
    resolveSubagentLegacyMetricsFallback({
      hasSubagentContext: true,
      billingSelection: selection({
        ledgerSnapshot: {
          primarySource: "sdk",
          totalTokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
          totalCostUsd: 0,
          totalSavingsUsd: 0,
          plannerCostUsd: 0,
          ecoCostUsd: 0,
          otelCostUsd: 0,
          sourceBreakdown: {},
          byRole: {},
          byModel: {},
        },
      }),
    }),
  ).toEqual({ record: false, reason: "ledger_projection_available" });
});
