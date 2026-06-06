import type { RequestBillingDelta, TokenCostBreakdown } from "@eco/runtime";

export const USAGE_LEDGER_COMPUTED_BILLING_METADATA_KEY = "computedBilling";

export interface UsageLedgerComputedBillingMetadata {
  ecoCostUsd: number;
  plannerTokenCostUsd: number;
  pricingResolved: boolean;
  ecoBreakdown?: TokenCostBreakdown;
  plannerBreakdown?: TokenCostBreakdown;
}

export function serializeUsageLedgerComputedBilling(
  billing: RequestBillingDelta,
): UsageLedgerComputedBillingMetadata {
  return {
    ecoCostUsd: billing.ecoCostUsd,
    plannerTokenCostUsd: billing.plannerTokenCostUsd,
    pricingResolved: billing.pricingResolved,
    ...(billing.ecoBreakdown && { ecoBreakdown: billing.ecoBreakdown }),
    ...(billing.plannerBreakdown && { plannerBreakdown: billing.plannerBreakdown }),
  };
}

export function readUsageLedgerComputedBilling(
  metadata: Record<string, unknown> | undefined,
): RequestBillingDelta | undefined {
  const raw = metadata?.[USAGE_LEDGER_COMPUTED_BILLING_METADATA_KEY];
  if (!isRecord(raw)) {
    return undefined;
  }
  const ecoCostUsd = readFiniteNumber(raw.ecoCostUsd);
  const plannerTokenCostUsd = readFiniteNumber(raw.plannerTokenCostUsd);
  if (ecoCostUsd === undefined || plannerTokenCostUsd === undefined) {
    return undefined;
  }

  return {
    ecoCostUsd,
    plannerTokenCostUsd,
    pricingResolved: raw.pricingResolved === true,
    ecoBreakdown: readCostBreakdown(raw.ecoBreakdown),
    plannerBreakdown: readCostBreakdown(raw.plannerBreakdown),
  };
}

function readCostBreakdown(value: unknown): TokenCostBreakdown | null {
  if (!isRecord(value)) {
    return null;
  }
  const inputUsd = readFiniteNumber(value.inputUsd);
  const outputUsd = readFiniteNumber(value.outputUsd);
  const cacheReadUsd = readFiniteNumber(value.cacheReadUsd);
  const cacheCreationUsd = readFiniteNumber(value.cacheCreationUsd);
  const totalUsd = readFiniteNumber(value.totalUsd);
  if (
    inputUsd === undefined ||
    outputUsd === undefined ||
    cacheReadUsd === undefined ||
    cacheCreationUsd === undefined ||
    totalUsd === undefined
  ) {
    return null;
  }
  return { inputUsd, outputUsd, cacheReadUsd, cacheCreationUsd, totalUsd };
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
