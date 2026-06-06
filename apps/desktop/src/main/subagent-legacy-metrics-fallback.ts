import type { UsageLedgerBillingSnapshotSelection } from "./usage-ledger-coordinator";

export type SubagentLegacyMetricsFallbackDecision =
  | {
      record: true;
      reason: "ledger_projection_unavailable";
    }
  | {
      record: false;
      reason: "missing_subagent_context" | "ledger_projection_available";
    };

export function resolveSubagentLegacyMetricsFallback(input: {
  hasSubagentContext: boolean;
  billingSelection: Pick<UsageLedgerBillingSnapshotSelection, "ledgerSnapshot">;
}): SubagentLegacyMetricsFallbackDecision {
  if (!input.hasSubagentContext) {
    return { record: false, reason: "missing_subagent_context" };
  }
  if (input.billingSelection.ledgerSnapshot) {
    return { record: false, reason: "ledger_projection_available" };
  }
  return { record: true, reason: "ledger_projection_unavailable" };
}
