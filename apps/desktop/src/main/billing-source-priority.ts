import type { BillingUsageSource } from "../shared/ipc";
import type { UsageLedgerSource } from "./usage-ledger";

export const DEFAULT_BILLING_SOURCE_PRIORITY: readonly BillingUsageSource[] = ["sdk", "proxy"];
export const PROXY_FIRST_BILLING_SOURCE_PRIORITY: readonly BillingUsageSource[] = ["proxy", "sdk"];

export const DEFAULT_LEDGER_SOURCE_PRIORITY: readonly UsageLedgerSource[] = ["sdk", "proxy"];
export const PROXY_FIRST_LEDGER_SOURCE_PRIORITY: readonly UsageLedgerSource[] = ["proxy", "sdk"];

export function resolveBillingSourcePriority(
  sourceBreakdown: Partial<Record<BillingUsageSource, unknown>>,
): readonly BillingUsageSource[] {
  return sourceBreakdown.proxy
    ? PROXY_FIRST_BILLING_SOURCE_PRIORITY
    : DEFAULT_BILLING_SOURCE_PRIORITY;
}

export function resolveLedgerSourcePriority(
  sourceBreakdown: Partial<Record<UsageLedgerSource, unknown>>,
): readonly UsageLedgerSource[] {
  return sourceBreakdown.proxy
    ? PROXY_FIRST_LEDGER_SOURCE_PRIORITY
    : DEFAULT_LEDGER_SOURCE_PRIORITY;
}

export function selectPrimaryBillingSource(
  sourceBreakdown: Partial<Record<BillingUsageSource, unknown>>,
): BillingUsageSource | undefined {
  const priority = resolveBillingSourcePriority(sourceBreakdown);
  return priority.find((source) => sourceBreakdown[source]);
}
