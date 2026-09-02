import { type BillingTokenBreakdown, buildBillingTokenBreakdown } from "./billing-token-breakdown";
import type { BillingUsageSource, ThreadBillingSnapshot, ThreadUsageLedgerEventView } from "./ipc";

export interface BillingAccountingIssue {
  code:
    | "primary_token_mismatch"
    | "breakdown_agent_token_mismatch"
    | "breakdown_model_token_mismatch"
    | "breakdown_eco_cost_mismatch"
    | "reported_cost_mismatch";
  message: string;
  delta?: number;
}

export interface BillingAccountingReport {
  ok: boolean;
  issues: BillingAccountingIssue[];
  primarySource: BillingUsageSource | undefined;
  snapshot: {
    totalTokens: number;
    ecoCostUsd: number;
    reportedCostUsd?: number;
  };
  eventSums: {
    primary: number;
    all: number;
    pending: number;
    unattributed: number;
    eventCount: number;
  };
  breakdown: {
    byAgentTokens: number;
    byModelTokens: number;
    byAgentEcoCostUsd: number;
    byModelEcoCostUsd: number;
  };
}

type TokenFields = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

function tokenSum(entry: TokenFields): number {
  return entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheCreationTokens;
}

function snapshotTokenSum(billing: ThreadBillingSnapshot): number {
  const t = billing.totalTokens;
  return t.input + t.output + t.cacheRead + t.cacheCreation;
}

function sumEventTokens(events: readonly ThreadUsageLedgerEventView[]): number {
  return events.reduce((sum, event) => sum + tokenSum(event), 0);
}

function sumBreakdownTokens(
  rows: readonly {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  }[],
): number {
  return rows.reduce((sum, row) => sum + tokenSum(row), 0);
}

function sumBreakdownEcoCost(rows: readonly { ecoCostUsd: number }[]): number {
  return rows.reduce((sum, row) => sum + row.ecoCostUsd, 0);
}

/** Cross-check snapshot totals vs ledger events and UI breakdown rows. */
export function verifyBillingAccounting(input: {
  billing: ThreadBillingSnapshot;
  events: readonly ThreadUsageLedgerEventView[];
  breakdown?: BillingTokenBreakdown | null;
}): BillingAccountingReport {
  const breakdown = input.breakdown ?? buildBillingTokenBreakdown(input.billing);
  const primarySource = input.billing.primarySource ?? input.billing.displaySource;
  const primaryEvents = primarySource
    ? input.events.filter((event) => event.source === primarySource)
    : input.events;
  const pendingEvents = input.events.filter((event) => event.attributionStatus === "pending");
  const unattributedEvents = input.events.filter((event) => event.attributionStatus === "unattributed");

  const primaryEventTokens = sumEventTokens(primaryEvents);
  const allEventTokens = sumEventTokens(input.events);
  const snapshotTokens = snapshotTokenSum(input.billing);
  const byAgentTokens = breakdown ? sumBreakdownTokens(breakdown.byAgent) : 0;
  const byModelTokens = breakdown ? sumBreakdownTokens(breakdown.byModel) : 0;
  const byAgentEcoCost = breakdown ? sumBreakdownEcoCost(breakdown.byAgent) : 0;
  const byModelEcoCost = breakdown ? sumBreakdownEcoCost(breakdown.byModel) : 0;

  const primarySourceRow = primarySource ? input.billing.sourceBreakdown?.[primarySource] : undefined;
  const reportedCostUsd = primarySourceRow?.reportedCostUsd;

  const issues: BillingAccountingIssue[] = [];

  if (primarySource && primaryEventTokens !== snapshotTokens) {
    issues.push({
      code: "primary_token_mismatch",
      message: `主账 ${primarySource} 逐笔 token 合计 ${primaryEventTokens} ≠ 快照 ${snapshotTokens}`,
      delta: primaryEventTokens - snapshotTokens,
    });
  }

  if (breakdown && byAgentTokens > 0 && byAgentTokens !== snapshotTokens) {
    issues.push({
      code: "breakdown_agent_token_mismatch",
      message: `按 Agent 明细 token 合计 ${byAgentTokens} ≠ 快照 ${snapshotTokens}`,
      delta: byAgentTokens - snapshotTokens,
    });
  }

  if (breakdown && byModelTokens > 0 && byModelTokens !== snapshotTokens) {
    issues.push({
      code: "breakdown_model_token_mismatch",
      message: `按模型明细 token 合计 ${byModelTokens} ≠ 快照 ${snapshotTokens}`,
      delta: byModelTokens - snapshotTokens,
    });
  }

  const snapshotEcoCost = input.billing.ecoCostUsd;
  if (breakdown && byModelTokens > 0 && Math.abs(byModelEcoCost - snapshotEcoCost) > 0.000001) {
    issues.push({
      code: "breakdown_eco_cost_mismatch",
      message: `按模型 eco 成本 ${byModelEcoCost} ≠ 快照 ${snapshotEcoCost}`,
      delta: byModelEcoCost - snapshotEcoCost,
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    primarySource,
    snapshot: {
      totalTokens: snapshotTokens,
      ecoCostUsd: snapshotEcoCost,
      ...(reportedCostUsd !== undefined && { reportedCostUsd }),
    },
    eventSums: {
      primary: primaryEventTokens,
      all: allEventTokens,
      pending: sumEventTokens(pendingEvents),
      unattributed: sumEventTokens(unattributedEvents),
      eventCount: input.events.length,
    },
    breakdown: {
      byAgentTokens,
      byModelTokens,
      byAgentEcoCostUsd: byAgentEcoCost,
      byModelEcoCostUsd: byModelEcoCost,
    },
  };
}
