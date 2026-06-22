import type { ThreadBillingSnapshot } from "../shared/ipc";
import type { SubagentMetricsRegistry } from "./subagent-metrics-registry";
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
  reason: "ledger_projection_primary";
}

export function applySubagentLegacyMetricsFallback(
  input: ApplySubagentLegacyMetricsFallbackInput,
): AppliedSubagentLegacyMetricsFallback {
  return {
    billingSelection: input.billingSelection,
    recorded: false,
    recordCount: 0,
    reason: "ledger_projection_primary",
  };
}
