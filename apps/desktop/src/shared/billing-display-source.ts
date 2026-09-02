import { computeThreadBillingTotals } from "@eco/runtime/billing";
import type {
  BillingUsageSource,
  ThreadBillingSnapshot,
  ThreadBillingSourceSnapshot,
  ThreadStatus,
} from "./ipc";

export function resolveBillingDisplaySource(
  billing: ThreadBillingSnapshot,
  _threadStatus?: ThreadStatus,
): BillingUsageSource | undefined {
  // A built-in vision request is sent through the proxy, but it must not make
  // a vision-only proxy source replace the main session's headline billing.
  // Keep proxy as the display source when it also carries ordinary agent work.
  if (billing.sourceBreakdown?.proxy && hasNonVisionUsage(billing.sourceBreakdown.proxy)) {
    return "proxy";
  }
  return billing.primarySource;
}

function hasNonVisionUsage(source: ThreadBillingSourceSnapshot): boolean {
  const byRole = source.byRole;
  if (!byRole) {
    // Older snapshots do not have role breakdowns; preserve their existing
    // proxy-display behavior instead of guessing from missing data.
    return true;
  }
  return Object.entries(byRole).some(([role, usage]) => {
    if (role === "vision" || !usage) {
      return false;
    }
    return (
      usage.inputTokens > 0 ||
      usage.outputTokens > 0 ||
      usage.cacheReadTokens > 0 ||
      usage.cacheCreationTokens > 0 ||
      usage.ecoCostUsd > 0
    );
  });
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
  const sourceReportedCostUsd = sourceRow.reportedCostUsd ?? billing.sourceReportedCostUsd;
  const usingPrimaryDisplay = displaySource === billing.primarySource;
  const { ecoCostBreakdown, plannerCostBreakdown, ...billingBase } = billing;
  return {
    ...billingBase,
    displaySource,
    totalTokens: sourceRow.totalTokens,
    ...computeThreadBillingTotals(sourceReportedCostUsd, sourceRow.plannerTokenCostUsd, sourceRow.ecoCostUsd),
    pricingResolved: billing.pricingResolved && sourceRow.pricingResolved,
    ...(sourceRow.byRole && { byRole: sourceRow.byRole }),
    ...(sourceRow.byModel && { byModel: sourceRow.byModel }),
    ...(usingPrimaryDisplay
      ? {
          ...(ecoCostBreakdown && { ecoCostBreakdown }),
          ...(plannerCostBreakdown && { plannerCostBreakdown }),
        }
      : {}),
  };
}
