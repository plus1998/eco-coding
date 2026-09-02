import type { BillingUsageSource, ThreadBillingSnapshot, ThreadUsageLedgerEventView } from "./ipc";

export function resolveBillingPrimarySource(
  billing: ThreadBillingSnapshot | undefined,
): BillingUsageSource | undefined {
  return billing?.primarySource ?? billing?.displaySource;
}

export function partitionLedgerEventsForDisplay(
  events: readonly ThreadUsageLedgerEventView[],
  primarySource: BillingUsageSource | undefined,
): {
  primaryEvents: ThreadUsageLedgerEventView[];
  shadowEvents: ThreadUsageLedgerEventView[];
} {
  if (!primarySource) {
    return { primaryEvents: [...events], shadowEvents: [] };
  }
  const primaryEvents: ThreadUsageLedgerEventView[] = [];
  const shadowEvents: ThreadUsageLedgerEventView[] = [];
  for (const event of events) {
    if (event.source === primarySource) {
      primaryEvents.push(event);
    } else {
      shadowEvents.push(event);
    }
  }
  return { primaryEvents, shadowEvents };
}

export function sortLedgerEventsNewestFirst(
  events: readonly ThreadUsageLedgerEventView[],
): ThreadUsageLedgerEventView[] {
  return [...events].sort((left, right) => right.observedAt.localeCompare(left.observedAt));
}

export function sumLedgerEventTokens(events: readonly ThreadUsageLedgerEventView[]): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  total: number;
} {
  const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  for (const event of events) {
    totals.inputTokens += event.inputTokens;
    totals.outputTokens += event.outputTokens;
    totals.cacheReadTokens += event.cacheReadTokens;
    totals.cacheCreationTokens += event.cacheCreationTokens;
  }
  return {
    ...totals,
    total: totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreationTokens,
  };
}

export function snapshotTokenTotal(billing: ThreadBillingSnapshot): number {
  const tokens = billing.totalTokens;
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
}

/** Role label aligned with billing projector `byRole` (billingRole / role, not routeRole). */
export function resolveLedgerEventBillingRole(event: ThreadUsageLedgerEventView): string {
  return event.billingRole ?? event.role;
}

export function ledgerEventRouteRoleDiffers(event: ThreadUsageLedgerEventView): boolean {
  const billingRole = resolveLedgerEventBillingRole(event);
  return event.routeRole !== billingRole;
}
