import type { ThreadBillingSnapshot } from "../shared/ipc";
import type { SubagentMetricsRegistry } from "./subagent-metrics-registry";
import { resolveSubagentLegacyMetricsFallback } from "./subagent-legacy-metrics-fallback";
import type {
  UsageLedgerBillingSnapshotSelection,
  UsageLedgerBillingSnapshotSelectionOptions,
} from "./usage-ledger-coordinator";

export type SubagentLegacyMetricsRecordInput = Parameters<SubagentMetricsRegistry["recordSdkUsage"]>[1];

export interface SubagentLegacyMetricsFallbackServices {
  recordSdkUsage(threadId: string, input: SubagentLegacyMetricsRecordInput): unknown;
  resolveBillingSnapshot(
    threadId: string,
    legacyBilling: ThreadBillingSnapshot,
    options: UsageLedgerBillingSnapshotSelectionOptions,
  ): UsageLedgerBillingSnapshotSelection;
}

export interface ApplySubagentLegacyMetricsFallbackInput {
  threadId: string;
  hasSubagentContext: boolean;
  billingSelection: UsageLedgerBillingSnapshotSelection;
  legacyBilling: ThreadBillingSnapshot;
  selectionOptions: UsageLedgerBillingSnapshotSelectionOptions;
  records: readonly SubagentLegacyMetricsRecordInput[];
  services: SubagentLegacyMetricsFallbackServices;
}

export interface AppliedSubagentLegacyMetricsFallback {
  billingSelection: UsageLedgerBillingSnapshotSelection;
  recorded: boolean;
  recordCount: number;
  reason: ReturnType<typeof resolveSubagentLegacyMetricsFallback>["reason"];
}

export function applySubagentLegacyMetricsFallback(
  input: ApplySubagentLegacyMetricsFallbackInput,
): AppliedSubagentLegacyMetricsFallback {
  const decision = resolveSubagentLegacyMetricsFallback({
    hasSubagentContext: input.hasSubagentContext,
    billingSelection: input.billingSelection,
  });
  if (!decision.record) {
    return {
      billingSelection: input.billingSelection,
      recorded: false,
      recordCount: 0,
      reason: decision.reason,
    };
  }

  for (const record of input.records) {
    input.services.recordSdkUsage(input.threadId, record);
  }

  return {
    billingSelection: input.services.resolveBillingSnapshot(input.threadId, input.legacyBilling, {
      ...input.selectionOptions,
      useLedgerProjection: false,
    }),
    recorded: input.records.length > 0,
    recordCount: input.records.length,
    reason: decision.reason,
  };
}
