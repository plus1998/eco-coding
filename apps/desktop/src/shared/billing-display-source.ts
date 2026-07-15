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
  if (billing.sourceBreakdown?.proxy) {
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
  const sourceReportedCostUsd = sourceRow.reportedCostUsd ?? billing.sourceReportedCostUsd;
  const usingPrimaryDisplay = displaySource === billing.primarySource;
  const { ecoCostBreakdown, plannerCostBreakdown, ...billingBase } = billing;
  return {
    ...billingBase,
    displaySource,
    totalTokens: sourceRow.totalTokens,
    ...computeThreadBillingTotals(
      sourceReportedCostUsd,
      sourceRow.plannerTokenCostUsd,
      sourceRow.ecoCostUsd,
    ),
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
