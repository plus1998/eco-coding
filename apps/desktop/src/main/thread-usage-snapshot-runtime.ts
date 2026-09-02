import { enrichBillingDisplaySource } from "../shared/billing-display-source";
import type { ThreadBillingSnapshot, ThreadStatus, ThreadUsageSnapshotResult } from "../shared/ipc";
import { resolveBillingSnapshotSelectionOptions } from "./billing-snapshot-selection-policy";

export interface ThreadUsageSnapshotRuntimeServices {
  getLegacyBilling(threadId: string): ThreadBillingSnapshot | undefined;
  resolveBillingSnapshot(
    threadId: string,
    legacyBilling: ThreadBillingSnapshot,
    options: ReturnType<typeof resolveBillingSnapshotSelectionOptions>,
  ): { snapshot: ThreadBillingSnapshot };
  enrichBillingSnapshot(threadId: string, billing: ThreadBillingSnapshot): ThreadBillingSnapshot;
  projectBillingSnapshot(threadId: string, plannerModelLabel?: string): ThreadBillingSnapshot | undefined;
  getThreadStatus(threadId: string): ThreadStatus | undefined;
  getDisplayContextSnapshot(threadId: string): ThreadUsageSnapshotResult["context"];
}

export function buildThreadUsageSnapshotResult(
  threadId: string,
  services: ThreadUsageSnapshotRuntimeServices,
): ThreadUsageSnapshotResult {
  const legacyBilling = services.getLegacyBilling(threadId);
  const selectionOptions = resolveBillingSnapshotSelectionOptions({
    ...(legacyBilling?.plannerModelLabel && { plannerModelLabel: legacyBilling.plannerModelLabel }),
  });
  let billingBase: ThreadBillingSnapshot | undefined;
  if (legacyBilling) {
    const billingSelection = services.resolveBillingSnapshot(threadId, legacyBilling, selectionOptions);
    billingBase = services.enrichBillingSnapshot(threadId, billingSelection.snapshot);
  } else {
    const ledgerBilling = services.projectBillingSnapshot(threadId);
    billingBase = ledgerBilling ? services.enrichBillingSnapshot(threadId, ledgerBilling) : undefined;
  }
  const billing = billingBase
    ? enrichBillingDisplaySource(billingBase, services.getThreadStatus(threadId))
    : undefined;
  const context = services.getDisplayContextSnapshot(threadId);
  return {
    ...(billing && { billing }),
    ...(context && { context }),
  };
}
