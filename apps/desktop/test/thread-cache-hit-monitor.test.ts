import { expect, test } from "bun:test";
import {
  detectPromptCacheHitDrop,
  formatPromptCacheHitDropMessage,
  ThreadCacheHitMonitor,
} from "../src/main/thread-cache-hit-monitor";

test("detectPromptCacheHitDrop ignores small requests", () => {
  const previous = { inputTokens: 1000, cacheReadTokens: 4000, cacheCreationTokens: 0 };
  const current = { inputTokens: 900, cacheReadTokens: 100, cacheCreationTokens: 0 };
  expect(detectPromptCacheHitDrop(previous, current)).toBeNull();
});

test("detectPromptCacheHitDrop detects large ratio fall", () => {
  const previous = { inputTokens: 20_000, cacheReadTokens: 80_000, cacheCreationTokens: 0 };
  const current = { inputTokens: 90_000, cacheReadTokens: 10_000, cacheCreationTokens: 0 };
  const detection = detectPromptCacheHitDrop(previous, current);
  expect(detection).not.toBeNull();
  expect(detection?.previousRatio).toBeCloseTo(0.8, 2);
  expect(detection?.currentRatio).toBeCloseTo(0.1, 2);
  expect(detection?.dropPoints).toBeGreaterThanOrEqual(0.25);
});

test("detectPromptCacheHitDrop ignores modest changes", () => {
  const previous = { inputTokens: 20_000, cacheReadTokens: 50_000, cacheCreationTokens: 0 };
  const current = { inputTokens: 22_000, cacheReadTokens: 45_000, cacheCreationTokens: 0 };
  expect(detectPromptCacheHitDrop(previous, current)).toBeNull();
});

test("ThreadCacheHitMonitor reports drop on second planner observation", () => {
  const monitor = new ThreadCacheHitMonitor();
  monitor.observePlannerUsage("t1", { inputTokens: 20_000, cacheReadTokens: 80_000, cacheCreationTokens: 0 });
  const detection = monitor.observePlannerUsage("t1", {
    inputTokens: 90_000,
    cacheReadTokens: 10_000,
    cacheCreationTokens: 0,
  });
  expect(detection).not.toBeNull();
});

test("formatPromptCacheHitDropMessage includes percentages and token counts", () => {
  const message = formatPromptCacheHitDropMessage({
    previousRatio: 0.78,
    currentRatio: 0.12,
    dropPoints: 0.66,
    inputTokens: 90_000,
    cacheReadTokens: 12_000,
    cacheCreationTokens: 0,
  });
  expect(message).toContain("78%");
  expect(message).toContain("12%");
  expect(message).toContain("cache_read 12,000");
});
