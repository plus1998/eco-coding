import { expect, test } from "bun:test";
import { ContextWindowMonitor } from "../src/main/context-window-monitor";
import type { ModelsDevPricingCache } from "../src/main/models-dev-pricing-cache";

function mockCache(limit = 100_000, resolved = true): ModelsDevPricingCache {
  return {
    resolveContextLimit: async () => ({
      limit,
      limitsResolved: resolved,
    }),
  } as ModelsDevPricingCache;
}

test("shouldCompact when above threshold", async () => {
  const monitor = new ContextWindowMonitor(mockCache(100_000));
  await monitor.updateFromUsage("t1", {
    inputTokens: 90_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  }, { modelId: "claude-sonnet", providerBaseUrl: "https://api.anthropic.com" });
  expect(monitor.shouldCompact("t1")).toBe(true);
});

test("markCompactCompleted resets occupancy and cooldown", async () => {
  const monitor = new ContextWindowMonitor(mockCache());
  await monitor.updateFromUsage("t1", {
    inputTokens: 90_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  });
  monitor.markCompactCompleted("t1", 20_000);
  expect(monitor.getSnapshot("t1")?.occupied).toBe(20_000);
  expect(monitor.shouldCompact("t1")).toBe(false);
});

test("dedupes assistant usage by messageId", async () => {
  const monitor = new ContextWindowMonitor(mockCache());
  await monitor.updateFromUsage(
    "t1",
    { inputTokens: 50_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { messageId: "msg-1" },
  );
  await monitor.updateFromUsage(
    "t1",
    { inputTokens: 30_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { messageId: "msg-1" },
  );
  expect(monitor.getSnapshot("t1")?.occupied).toBe(50_000);
});
