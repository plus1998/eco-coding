import { expect, test } from "bun:test";
import { collectBillingOpenBoundaryNotes } from "../src/shared/billing-open-boundaries";
import type { ThreadBillingSnapshot } from "../src/shared/ipc";

function makeBilling(overrides: Partial<ThreadBillingSnapshot> = {}): ThreadBillingSnapshot {
  return {
    totalTokens: { input: 1000, output: 100, cacheRead: 0, cacheCreation: 0 },
    sourceReportedCostUsd: 0,
    plannerTokenCostUsd: 0,
    ecoCostUsd: 0.01,
    savedUsd: 0,
    savedPct: 0,
    pricingResolved: true,
    ...overrides,
  };
}

test("collectBillingOpenBoundaryNotes returns empty for zero usage", () => {
  expect(
    collectBillingOpenBoundaryNotes(
      makeBilling({
        totalTokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        ecoCostUsd: 0,
      }),
    ),
  ).toEqual([]);
});

test("collectBillingOpenBoundaryNotes surfaces B17 when proxy is missing", () => {
  const notes = collectBillingOpenBoundaryNotes(
    makeBilling({
      sourceBreakdown: {
        sdk: {
          source: "sdk",
          totalTokens: { input: 5000, output: 500, cacheRead: 0, cacheCreation: 0 },
          plannerTokenCostUsd: 0,
          ecoCostUsd: 0.05,
          pricingResolved: true,
        },
      },
    }),
  );
  expect(notes.some((note) => note.id === "B17")).toBe(true);
  expect(notes.some((note) => note.id === "B15")).toBe(false);
});

test("collectBillingOpenBoundaryNotes surfaces B16 for primary unattributed diagnostics", () => {
  const notes = collectBillingOpenBoundaryNotes(
    makeBilling({
      diagnostics: [{ type: "unattributed_usage", severity: "warning", message: "test" }],
      sourceBreakdown: {
        proxy: {
          source: "proxy",
          totalTokens: { input: 1000, output: 100, cacheRead: 0, cacheCreation: 0 },
          plannerTokenCostUsd: 0,
          ecoCostUsd: 0.01,
          pricingResolved: true,
        },
      },
    }),
  );
  expect(notes.some((note) => note.id === "B16")).toBe(true);
  expect(notes.some((note) => note.id === "B14")).toBe(true);
});

test("collectBillingOpenBoundaryNotes skips B14/B16 when only shadow info diagnostics exist", () => {
  const notes = collectBillingOpenBoundaryNotes(
    makeBilling({
      diagnostics: [
        {
          type: "shadow_reconciliation",
          severity: "info",
          message: "shadow only",
        },
      ],
      sourceBreakdown: {
        proxy: {
          source: "proxy",
          totalTokens: { input: 32000, output: 3000, cacheRead: 35000, cacheCreation: 0 },
          plannerTokenCostUsd: 0,
          ecoCostUsd: 0.01,
          pricingResolved: true,
        },
        sdk: {
          source: "sdk",
          totalTokens: { input: 90000, output: 9000, cacheRead: 0, cacheCreation: 0 },
          plannerTokenCostUsd: 0,
          ecoCostUsd: 0.01,
          pricingResolved: true,
        },
      },
    }),
  );
  expect(notes).toEqual([]);
});
