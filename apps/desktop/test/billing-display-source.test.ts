import { expect, test } from "bun:test";
import type { ThreadBillingSnapshot } from "../src/shared/ipc";
import {
  enrichBillingDisplaySource,
  resolveBillingDisplaySource,
} from "../src/shared/billing-display-source";

function billingSnapshot(input: Partial<ThreadBillingSnapshot> = {}): ThreadBillingSnapshot {
  return {
    totalTokens: { input: 100, output: 20, cacheRead: 0, cacheCreation: 0 },
    otelCostUsd: 0,
    plannerTokenCostUsd: 1,
    ecoCostUsd: 0.02,
    savedUsd: 0.98,
    savedPct: 98,
    pricingResolved: true,
    primarySource: "sdk",
    sourceBreakdown: {
      sdk: {
        source: "sdk",
        totalTokens: { input: 100, output: 20, cacheRead: 0, cacheCreation: 0 },
        plannerTokenCostUsd: 1,
        ecoCostUsd: 0.02,
        pricingResolved: true,
      },
      proxy: {
        source: "proxy",
        totalTokens: { input: 4_300_000, output: 95_000, cacheRead: 4_000_000, cacheCreation: 0 },
        plannerTokenCostUsd: 26,
        ecoCostUsd: 23.65,
        pricingResolved: true,
      },
    },
    ...input,
  };
}

test("resolveBillingDisplaySource prefers proxy when proxy breakdown exists", () => {
  const billing = billingSnapshot();
  expect(resolveBillingDisplaySource(billing, "running")).toBe("proxy");
  expect(resolveBillingDisplaySource(billing, "idle")).toBe("proxy");
  expect(resolveBillingDisplaySource(billing, "completed")).toBe("proxy");
});

test("resolveBillingDisplaySource falls back to primary when proxy breakdown is missing", () => {
  const billing = billingSnapshot({ sourceBreakdown: { sdk: billingSnapshot().sourceBreakdown!.sdk! } });
  expect(resolveBillingDisplaySource(billing, "idle")).toBe("sdk");
});

test("enrichBillingDisplaySource keeps primarySource sdk while overlaying proxy headline totals", () => {
  const enriched = enrichBillingDisplaySource(billingSnapshot(), "running");

  expect(enriched.primarySource).toBe("sdk");
  expect(enriched.displaySource).toBe("proxy");
  expect(enriched.totalTokens.input).toBe(4_300_000);
  expect(enriched.ecoCostUsd).toBeCloseTo(23.65);
  expect(enriched.plannerTokenCostUsd).toBeCloseTo(26);
  expect(enriched.savedUsd).toBeCloseTo(2.35);
});

test("enrichBillingDisplaySource falls back to primary totals when proxy breakdown is missing", () => {
  const enriched = enrichBillingDisplaySource(
    billingSnapshot({ sourceBreakdown: { sdk: billingSnapshot().sourceBreakdown!.sdk! } }),
    "idle",
  );

  expect(enriched.displaySource).toBe("sdk");
  expect(enriched.totalTokens.input).toBe(100);
  expect(enriched.ecoCostUsd).toBeCloseTo(0.02);
});

test("enrichBillingDisplaySource keeps proxy totals after run completes", () => {
  const runningOverlay = enrichBillingDisplaySource(billingSnapshot(), "running");
  const completed = enrichBillingDisplaySource(runningOverlay, "completed");

  expect(completed.displaySource).toBe("proxy");
  expect(completed.totalTokens.input).toBe(4_300_000);
  expect(completed.ecoCostUsd).toBeCloseTo(23.65);
});
