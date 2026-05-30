import type { ParsedUsage } from "./usage";

export interface ModelCostRates {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface RequestBillingDelta {
  plannerTokenCostUsd: number;
  ecoCostUsd: number;
  pricingResolved: boolean;
}

export interface ThreadBillingTotals {
  otelCostUsd: number;
  plannerTokenCostUsd: number;
  ecoCostUsd: number;
  savedUsd: number;
  savedPct: number;
}

export function tokenTotalsFromUsage(usage: ParsedUsage): TokenTotals {
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cacheReadTokens,
    cacheCreation: usage.cacheCreationTokens,
  };
}

export function estimateCostFromTokens(usage: ParsedUsage, rates: ModelCostRates): number {
  const cacheReadRate = rates.cacheRead ?? rates.input;
  const cacheWriteRate = rates.cacheWrite ?? rates.input;
  return (
    (usage.inputTokens * rates.input +
      usage.outputTokens * rates.output +
      usage.cacheReadTokens * cacheReadRate +
      usage.cacheCreationTokens * cacheWriteRate) /
    1_000_000
  );
}

export function computeRequestBilling(
  delta: ParsedUsage,
  actualRates: ModelCostRates | null,
  plannerRates: ModelCostRates | null,
): RequestBillingDelta {
  const plannerTokenCostUsd = plannerRates ? estimateCostFromTokens(delta, plannerRates) : 0;
  const ecoCostUsd = actualRates ? estimateCostFromTokens(delta, actualRates) : 0;
  return {
    plannerTokenCostUsd,
    ecoCostUsd,
    pricingResolved: Boolean(actualRates && plannerRates),
  };
}

export function computeSavings(plannerTokenCostUsd: number, ecoCostUsd: number): {
  savedUsd: number;
  savedPct: number;
} {
  const savedUsd = plannerTokenCostUsd - ecoCostUsd;
  const savedPct =
    plannerTokenCostUsd > 0 ? (savedUsd / plannerTokenCostUsd) * 100 : 0;
  return { savedUsd, savedPct };
}

export function computeThreadBillingTotals(
  otelCostUsd: number,
  plannerTokenCostUsd: number,
  ecoCostUsd: number,
): ThreadBillingTotals {
  const { savedUsd, savedPct } = computeSavings(plannerTokenCostUsd, ecoCostUsd);
  return {
    otelCostUsd,
    plannerTokenCostUsd,
    ecoCostUsd,
    savedUsd,
    savedPct,
  };
}

export function formatSavingsLine(savedUsd: number, savedPct: number): string {
  if (savedUsd >= 0) {
    return `eco-coding 为你节省了 $${savedUsd.toFixed(4)}（${savedPct.toFixed(1)}%）`;
  }
  return `eco-coding 多花费 $${Math.abs(savedUsd).toFixed(4)}（${Math.abs(savedPct).toFixed(1)}%）`;
}

export function formatSavingsPct(savedPct: number): string {
  return `${savedPct.toFixed(1)}%`;
}
