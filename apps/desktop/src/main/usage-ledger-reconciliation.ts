import type {
  BillingUsageSource,
  ThreadBillingSnapshot,
  ThreadBillingSourceSnapshot,
} from "../shared/ipc";
import type {
  UsageLedgerEvent,
  UsageLedgerSource,
  UsageLedgerTotals,
} from "./usage-ledger";
import { createEmptyUsageLedgerTotals } from "./usage-ledger";

export type UsageLedgerReconciliationIssueType =
  | "missing_billing_source"
  | "missing_ledger_source"
  | "token_mismatch"
  | "reported_cost_mismatch"
  | "unattributed_usage";

export interface UsageLedgerReconciliationIssue {
  type: UsageLedgerReconciliationIssueType;
  source?: UsageLedgerSource;
  field?: keyof UsageLedgerTotals;
  ledgerValue?: number;
  billingValue?: number;
  delta?: number;
  count?: number;
  eventId?: string;
}

export interface UsageLedgerSourceTotals extends UsageLedgerTotals {
  eventCount: number;
}

export interface UsageLedgerSourceComparison {
  source: UsageLedgerSource;
  ledger: UsageLedgerSourceTotals;
  billing?: ThreadBillingSourceSnapshot;
}

export interface UsageLedgerReconciliationResult {
  ok: boolean;
  issues: UsageLedgerReconciliationIssue[];
  comparisons: UsageLedgerSourceComparison[];
}

const TOKEN_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
] as const;

const TOKEN_FIELD_TO_BILLING = {
  inputTokens: "input",
  outputTokens: "output",
  cacheReadTokens: "cacheRead",
  cacheCreationTokens: "cacheCreation",
} as const;

const COST_EPSILON = 0.000001;

export function reconcileUsageLedgerWithBilling(
  events: readonly UsageLedgerEvent[],
  billing: ThreadBillingSnapshot | undefined,
): UsageLedgerReconciliationResult {
  const ledgerBySource = buildLedgerSourceTotals(events);
  const billingBySource = billing?.sourceBreakdown ?? {};
  const sources = new Set<UsageLedgerSource>([
    ...Object.keys(ledgerBySource),
    ...Object.keys(billingBySource),
  ] as UsageLedgerSource[]);
  const issues: UsageLedgerReconciliationIssue[] = [];
  const comparisons: UsageLedgerSourceComparison[] = [];

  for (const source of [...sources].sort()) {
    const ledger = ledgerBySource[source];
    const billingSource = billingBySource[source as BillingUsageSource];

    if (!ledger && billingSource) {
      issues.push({ type: "missing_ledger_source", source });
      comparisons.push({ source, ledger: createEmptySourceTotals(), billing: billingSource });
      continue;
    }
    if (ledger && !billingSource) {
      issues.push({ type: "missing_billing_source", source });
      comparisons.push({ source, ledger });
      continue;
    }
    if (!ledger || !billingSource) {
      continue;
    }

    comparisons.push({ source, ledger, billing: billingSource });
    compareTokens(source, ledger, billingSource, issues);
    compareReportedCost(source, ledger, billingSource, issues);
  }

  const unattributed = events.filter((event) => event.attribution.status === "unattributed");
  if (unattributed.length > 0) {
    issues.push({
      type: "unattributed_usage",
      count: unattributed.length,
      ...(unattributed[0]?.id && { eventId: unattributed[0].id }),
    });
  }

  return { ok: issues.length === 0, issues, comparisons };
}

export function summarizeUsageLedgerReconciliation(
  result: UsageLedgerReconciliationResult,
): Record<string, unknown> {
  return {
    ok: result.ok,
    issues: result.issues.map((issue) => ({
      type: issue.type,
      ...(issue.source && { source: issue.source }),
      ...(issue.field && { field: issue.field }),
      ...(issue.delta !== undefined && { delta: issue.delta }),
      ...(issue.count !== undefined && { count: issue.count }),
      ...(issue.eventId && { eventId: issue.eventId }),
    })),
    sources: result.comparisons.map((comparison) => ({
      source: comparison.source,
      ledgerEvents: comparison.ledger.eventCount,
      ledgerTokens: {
        input: comparison.ledger.inputTokens,
        output: comparison.ledger.outputTokens,
        cacheRead: comparison.ledger.cacheReadTokens,
        cacheCreation: comparison.ledger.cacheCreationTokens,
      },
      billingTokens: comparison.billing?.totalTokens,
    })),
  };
}

function buildLedgerSourceTotals(
  events: readonly UsageLedgerEvent[],
): Partial<Record<UsageLedgerSource, UsageLedgerSourceTotals>> {
  const totals: Partial<Record<UsageLedgerSource, UsageLedgerSourceTotals>> = {};
  const requestCosts = new Map<
    string,
    { source: UsageLedgerSource; explicitSum: number; hasExplicit: boolean; metadataTotal?: number }
  >();

  for (const event of events) {
    const total = (totals[event.source] ??= createEmptySourceTotals());
    total.inputTokens += event.inputTokens;
    total.outputTokens += event.outputTokens;
    total.cacheReadTokens += event.cacheReadTokens;
    total.cacheCreationTokens += event.cacheCreationTokens;
    total.eventCount += 1;
  }

  for (const event of events) {
    const key = `${event.source}\u001f${event.requestKey ?? event.sourceEventId}`;
    const cost = requestCosts.get(key) ?? {
      source: event.source,
      explicitSum: 0,
      hasExplicit: false,
    };
    if (event.reportedCostUsd !== undefined && Number.isFinite(event.reportedCostUsd)) {
      cost.explicitSum += event.reportedCostUsd;
      cost.hasExplicit = true;
    }
    const sdkTotal = readNumberMetadata(event.metadata, "sdkTotalCostUsd");
    if (sdkTotal !== undefined) {
      cost.metadataTotal = sdkTotal;
    }
    requestCosts.set(key, cost);
  }

  for (const cost of requestCosts.values()) {
    if (totals[cost.source]) {
      totals[cost.source]!.reportedCostUsd += cost.hasExplicit
        ? cost.explicitSum
        : (cost.metadataTotal ?? 0);
    }
  }

  return totals;
}

function compareTokens(
  source: UsageLedgerSource,
  ledger: UsageLedgerSourceTotals,
  billing: ThreadBillingSourceSnapshot,
  issues: UsageLedgerReconciliationIssue[],
): void {
  for (const field of TOKEN_FIELDS) {
    const billingField = TOKEN_FIELD_TO_BILLING[field];
    const ledgerValue = ledger[field];
    const billingValue = billing.totalTokens[billingField];
    if (ledgerValue !== billingValue) {
      issues.push({
        type: "token_mismatch",
        source,
        field,
        ledgerValue,
        billingValue,
        delta: ledgerValue - billingValue,
      });
    }
  }
}

function compareReportedCost(
  source: UsageLedgerSource,
  ledger: UsageLedgerSourceTotals,
  billing: ThreadBillingSourceSnapshot,
  issues: UsageLedgerReconciliationIssue[],
): void {
  const ledgerValue = ledger.reportedCostUsd;
  const billingValue = billing.reportedCostUsd ?? 0;
  const delta = ledgerValue - billingValue;
  if (Math.abs(delta) > COST_EPSILON) {
    issues.push({
      type: "reported_cost_mismatch",
      source,
      field: "reportedCostUsd",
      ledgerValue,
      billingValue,
      delta,
    });
  }
}

function createEmptySourceTotals(): UsageLedgerSourceTotals {
  return { ...createEmptyUsageLedgerTotals(), eventCount: 0 };
}

function readNumberMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
