import type { UsageLedgerBillingSnapshotSelectionOptions } from "./usage-ledger-coordinator";

export interface BillingSnapshotSelectionPolicy {
  useLedgerProjection: boolean;
}

export const DEFAULT_BILLING_SNAPSHOT_SELECTION_POLICY: BillingSnapshotSelectionPolicy = {
  useLedgerProjection: true,
};

export function resolveBillingSnapshotSelectionOptions(
  input: { policy?: BillingSnapshotSelectionPolicy; plannerModelLabel?: string } = {},
): UsageLedgerBillingSnapshotSelectionOptions {
  const policy = input.policy ?? DEFAULT_BILLING_SNAPSHOT_SELECTION_POLICY;
  return {
    useLedgerProjection: policy.useLedgerProjection,
    ...(input.plannerModelLabel && { plannerModelLabel: input.plannerModelLabel }),
  };
}
