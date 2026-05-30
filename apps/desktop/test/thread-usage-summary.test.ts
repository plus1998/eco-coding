import { expect, test } from "bun:test";
import {
  buildFallbackContextSnapshot,
  buildThreadUsageSummary,
  contextCardPlaceholder,
  shouldShowThreadUsagePanels,
} from "../src/shared/thread-usage-summary";

test("shouldShowThreadUsagePanels includes awaiting_plan and terminal statuses", () => {
  expect(shouldShowThreadUsagePanels("awaiting_plan")).toBe(true);
  expect(shouldShowThreadUsagePanels("completed")).toBe(true);
  expect(shouldShowThreadUsagePanels("idle")).toBe(true);
});

test("buildFallbackContextSnapshot uses planner usage when no /context cache", () => {
  const context = buildFallbackContextSnapshot({
    plannerUsage: {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      contextTokens: 42_000,
      contextLimit: 200_000,
      occupancyPct: 21,
    },
  });
  expect(context?.occupied).toBe(42_000);
  expect(context?.segments.length).toBeGreaterThan(0);
});

test("buildThreadUsageSummary always includes context when tokens known", () => {
  const summary = buildThreadUsageSummary({
    usageByRole: {
      planner: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        contextTokens: 12_000,
        contextLimit: 200_000,
        occupancyPct: 6,
      },
    },
  });
  expect(summary.context?.occupied).toBe(12_000);
});

test("contextCardPlaceholder differs for awaiting_plan vs idle", () => {
  expect(contextCardPlaceholder("awaiting_plan")).toContain("同步");
  expect(contextCardPlaceholder("completed")).toContain("暂无");
});
