import type { BillingUsageSource, ThreadBillingSnapshot, ThreadUsageLedgerEventView } from "./ipc";

export function resolveBillingPrimarySource(
  billing: ThreadBillingSnapshot | undefined,
): BillingUsageSource | undefined {
  return billing?.primarySource ?? billing?.displaySource;
}

/**
 * Identity of one billable observation: same source + usage kind + role/agent/model +
 * exact token counts. Two rows with the same key are the same invocation observed
 * twice (e.g. legacy PI double usage emission) — collapsed to one, mirroring the
 * billing projector so the per-billing list sums to the snapshot total.
 */
export function ledgerEventDuplicateKey(event: {
  source: string;
  usageKind: string;
  role: string;
  agentId?: string;
  modelId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): string {
  return [
    event.source,
    event.usageKind,
    event.role,
    event.agentId ?? "",
    event.modelId ?? "",
    event.inputTokens,
    event.outputTokens,
    event.cacheReadTokens,
    event.cacheCreationTokens,
  ].join(":");
}

export function partitionLedgerEventsForDisplay(
  events: readonly ThreadUsageLedgerEventView[],
  primarySource: BillingUsageSource | undefined,
): {
  primaryEvents: ThreadUsageLedgerEventView[];
  shadowEvents: ThreadUsageLedgerEventView[];
} {
  // Collapse repeated observations of the same invocation (same source + usage kind +
  // usage fingerprint — e.g. legacy PI double usage emission): first observation wins,
  // mirroring the billing projector so the list matches the snapshot total.
  const seenDuplicateKeys = new Set<string>();
  const uniqueEvents: ThreadUsageLedgerEventView[] = [];
  for (const event of events) {
    const key = ledgerEventDuplicateKey(event);
    if (seenDuplicateKeys.has(key)) {
      continue;
    }
    seenDuplicateKeys.add(key);
    uniqueEvents.push(event);
  }
  if (!primarySource) {
    return { primaryEvents: [...uniqueEvents], shadowEvents: [] };
  }
  const primaryEvents: ThreadUsageLedgerEventView[] = [];
  const shadowEvents: ThreadUsageLedgerEventView[] = [];
  for (const event of uniqueEvents) {
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
