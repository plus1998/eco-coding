import { expect, test } from "bun:test";
import {
  computeRequestBilling,
  computeSavings,
  computeThreadBillingTotals,
  estimateCostBreakdown,
  estimateCostFromTokens,
  formatSavingsLine,
} from "../src/billing";

const sonnetRates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
const haikuRates = { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 };

test("estimateCostBreakdown splits cache read pricing", () => {
  const breakdown = estimateCostBreakdown(
    { inputTokens: 1_000, outputTokens: 0, cacheReadTokens: 100_000, cacheCreationTokens: 0 },
    sonnetRates,
  );
  expect(breakdown.inputUsd).toBeCloseTo(0.003);
  expect(breakdown.cacheReadUsd).toBeCloseTo(0.03);
  expect(breakdown.totalUsd).toBeCloseTo(0.033);
});

test("estimateCostFromTokens applies cache rates", () => {
  const cost = estimateCostFromTokens(
    { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000, cacheCreationTokens: 0 },
    sonnetRates,
  );
  expect(cost).toBeCloseTo(3.3);
});

test("computeRequestBilling compares planner vs actual model", () => {
  const delta = { inputTokens: 100_000, outputTokens: 10_000, cacheReadTokens: 0, cacheCreationTokens: 0 };
  const result = computeRequestBilling(delta, haikuRates, sonnetRates);
  expect(result.plannerTokenCostUsd).toBeCloseTo(0.45);
  expect(result.ecoCostUsd).toBeCloseTo(0.12);
  expect(result.pricingResolved).toBe(true);
});

test("computeSavings when eco is cheaper", () => {
  const { savedUsd, savedPct } = computeSavings(3.82, 1.245);
  expect(savedUsd).toBeCloseTo(2.575);
  expect(savedPct).toBeCloseTo(67.4, 0);
});

test("computeSavings is zero when costs match", () => {
  const { savedUsd, savedPct } = computeSavings(2, 2);
  expect(savedUsd).toBe(0);
  expect(savedPct).toBe(0);
});

test("computeThreadBillingTotals aggregates four metrics", () => {
  const totals = computeThreadBillingTotals(2.1695, 3.82, 1.245);
  expect(totals.otelCostUsd).toBe(2.1695);
  expect(totals.savedUsd).toBeCloseTo(2.575);
});

test("formatSavingsLine for positive savings", () => {
  expect(formatSavingsLine(2.575, 67.4)).toContain("节省了");
});
