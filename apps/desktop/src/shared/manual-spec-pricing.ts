import type { RouteManualSpec } from "./ipc";

export function resolvePriceMultiplier(spec?: Pick<RouteManualSpec, "priceMultiplier">): number {
  const value = spec?.priceMultiplier;
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return value;
}

export function normalizeStoredPriceMultiplier(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value === 1 ? undefined : value;
}

export function multiplyUnitRate(value: number | undefined, multiplier: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (multiplier === 1) {
    return value;
  }
  return value * multiplier;
}

export interface PerMTokenRates {
  inputPerM?: number;
  outputPerM?: number;
  cacheReadPerM?: number;
  cacheWritePerM?: number;
}

export function applyPriceMultiplierToPerMRates(
  rates: PerMTokenRates | undefined,
  multiplier: number,
): PerMTokenRates | undefined {
  if (!rates) {
    return undefined;
  }
  if (multiplier === 1) {
    return rates;
  }
  return {
    ...(rates.inputPerM !== undefined && {
      inputPerM: multiplyUnitRate(rates.inputPerM, multiplier)!,
    }),
    ...(rates.outputPerM !== undefined && {
      outputPerM: multiplyUnitRate(rates.outputPerM, multiplier)!,
    }),
    ...(rates.cacheReadPerM !== undefined && {
      cacheReadPerM: multiplyUnitRate(rates.cacheReadPerM, multiplier)!,
    }),
    ...(rates.cacheWritePerM !== undefined && {
      cacheWritePerM: multiplyUnitRate(rates.cacheWritePerM, multiplier)!,
    }),
  };
}

export interface ModelCostRatesLike {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export function applyPriceMultiplierToCostRates<T extends ModelCostRatesLike>(
  rates: T,
  multiplier: number,
): T {
  if (multiplier === 1) {
    return rates;
  }
  return {
    ...rates,
    input: rates.input * multiplier,
    output: rates.output * multiplier,
    ...(rates.cacheRead !== undefined && { cacheRead: rates.cacheRead * multiplier }),
    ...(rates.cacheWrite !== undefined && { cacheWrite: rates.cacheWrite * multiplier }),
  };
}
