import { computeThreadBillingTotals } from "@eco/runtime";
import type {
  BillingUsageSource,
  ThreadBillingSnapshot,
  ThreadBillingSourceSnapshot,
  ThreadStatus,
} from "./ipc";

export function shouldUseProxyBillingDisplay(threadStatus: ThreadStatus | undefined): boolean {
  return threadStatus === "running" || threadStatus === "queued";
}

export function resolveBillingDisplaySource(
  billing: ThreadBillingSnapshot,
  threadStatus: ThreadStatus | undefined,
): BillingUsageSource | undefined {
  if (shouldUseProxyBillingDisplay(threadStatus) && billing.sourceBreakdown?.proxy) {
    return "proxy";
  }
  return billing.primarySource;
}

export function enrichBillingDisplaySource(
  billing: ThreadBillingSnapshot,
  threadStatus: ThreadStatus | undefined,
): ThreadBillingSnapshot {
  const displaySource = resolveBillingDisplaySource(billing, threadStatus);
  if (!displaySource) {
    return billing;
  }

  const sourceRow = billing.sourceBreakdown?.[displaySource];
  if (!sourceRow) {
    return {
      ...billing,
      displaySource: billing.primarySource ?? displaySource,
    };
  }

  return applyBillingDisplaySourceRow(billing, displaySource, sourceRow);
}

function applyBillingDisplaySourceRow(
  billing: ThreadBillingSnapshot,
  displaySource: BillingUsageSource,
  sourceRow: ThreadBillingSourceSnapshot,
): ThreadBillingSnapshot {
  const otelCostUsd = sourceRow.reportedCostUsd ?? billing.otelCostUsd;
  const usingPrimaryDisplay = displaySource === billing.primarySource;
  return {
    ...billing,
    displaySource,
    totalTokens: sourceRow.totalTokens,
    ...computeThreadBillingTotals(
      otelCostUsd,
      sourceRow.plannerTokenCostUsd,
      sourceRow.ecoCostUsd,
    ),
    pricingResolved: billing.pricingResolved && sourceRow.pricingResolved,
    ...(sourceRow.byRole && { byRole: sourceRow.byRole }),
    ...(sourceRow.byModel && { byModel: sourceRow.byModel }),
    ...(usingPrimaryDisplay
      ? {
          ...(billing.ecoCostBreakdown && { ecoCostBreakdown: billing.ecoCostBreakdown }),
          ...(billing.plannerCostBreakdown && { plannerCostBreakdown: billing.plannerCostBreakdown }),
        }
      : {
          ecoCostBreakdown: undefined,
          plannerCostBreakdown: undefined,
        }),
  };
}
