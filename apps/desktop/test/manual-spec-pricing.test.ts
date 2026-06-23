import { expect, test } from "bun:test";
import {
  applyPriceMultiplierToCostRates,
  applyPriceMultiplierToPerMRates,
  normalizeStoredPriceMultiplier,
  resolvePriceMultiplier,
} from "../src/shared/manual-spec-pricing";

test("resolvePriceMultiplier defaults to 1", () => {
  expect(resolvePriceMultiplier(undefined)).toBe(1);
  expect(resolvePriceMultiplier({})).toBe(1);
  expect(resolvePriceMultiplier({ priceMultiplier: 2 })).toBe(2);
  expect(resolvePriceMultiplier({ priceMultiplier: 0 })).toBe(0);
});

test("normalizeStoredPriceMultiplier omits default multiplier", () => {
  expect(normalizeStoredPriceMultiplier(1)).toBeUndefined();
  expect(normalizeStoredPriceMultiplier(0)).toBe(0);
  expect(normalizeStoredPriceMultiplier(1.25)).toBe(1.25);
});

test("applyPriceMultiplierToPerMRates multiplies all present rates", () => {
  expect(
    applyPriceMultiplierToPerMRates(
      { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3 },
      2,
    ),
  ).toEqual({
    inputPerM: 6,
    outputPerM: 30,
    cacheReadPerM: 0.6,
  });
});

test("applyPriceMultiplierToCostRates multiplies catalog rates", () => {
  const result = applyPriceMultiplierToCostRates(
    { input: 3, output: 15, cacheRead: 0.3 },
    1.5,
  );
  expect(result?.input).toBeCloseTo(4.5);
  expect(result?.output).toBeCloseTo(22.5);
  expect(result?.cacheRead).toBeCloseTo(0.45);
});
