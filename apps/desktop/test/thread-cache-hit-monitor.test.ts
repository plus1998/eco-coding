import { expect, test } from "bun:test";
import {
  computePromptCacheHitRatio,
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
  const current = { inputTokens: 20_000, cacheReadTokens: 10_000, cacheCreationTokens: 0 };
  const detection = detectPromptCacheHitDrop(previous, current);
  expect(detection).not.toBeNull();
  expect(detection?.previousRatio).toBeCloseTo(0.8, 2);
  expect(detection?.currentRatio).toBeCloseTo(0.33, 2);
  expect(detection?.dropPoints).toBeGreaterThanOrEqual(0.25);
  expect(detection?.cacheReadLossTokens).toBe(70_000);
});

test("detectPromptCacheHitDrop ignores ratio fall explained by larger prompt input", () => {
  const previous = { inputTokens: 20_000, cacheReadTokens: 80_000, cacheCreationTokens: 0 };
  const current = { inputTokens: 120_000, cacheReadTokens: 80_000, cacheCreationTokens: 0 };
  expect(detectPromptCacheHitDrop(previous, current)).toBeNull();
});

test("detectPromptCacheHitDrop ignores ratio fall explained by cache creation", () => {
  const previous = { inputTokens: 20_000, cacheReadTokens: 80_000, cacheCreationTokens: 0 };
  const current = { inputTokens: 20_000, cacheReadTokens: 80_000, cacheCreationTokens: 100_000 };
  expect(detectPromptCacheHitDrop(previous, current)).toBeNull();
});

test("detectPromptCacheHitDrop ignores modest cache loss against a much larger prompt", () => {
  const previous = { inputTokens: 20_000, cacheReadTokens: 80_000, cacheCreationTokens: 0 };
  const current = { inputTokens: 110_000, cacheReadTokens: 60_000, cacheCreationTokens: 0 };
  expect(detectPromptCacheHitDrop(previous, current)).toBeNull();
});

test("detectPromptCacheHitDrop ignores cache loss explained by newly added input", () => {
  const previous = { inputTokens: 1_000, cacheReadTokens: 9_000, cacheCreationTokens: 0 };
  const current = { inputTokens: 11_000, cacheReadTokens: 4_000, cacheCreationTokens: 0 };
  expect(detectPromptCacheHitDrop(previous, current)).toBeNull();
});

test("computePromptCacheHitRatio includes cache creation in prompt size", () => {
  expect(
    computePromptCacheHitRatio({
      inputTokens: 10_000,
      cacheReadTokens: 60_000,
      cacheCreationTokens: 30_000,
    }),
  ).toBeCloseTo(0.6, 2);
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
    inputTokens: 20_000,
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
    currentPromptTokens: 102_000,
    previousCacheReadTokens: 82_000,
    cacheReadLossTokens: 70_000,
    addedUncachedInputTokens: 0,
    unexplainedCacheReadLossTokens: 70_000,
    cacheReadLossShare: 70_000 / 102_000,
    unexplainedCacheReadLossShare: 70_000 / 102_000,
    inputTokens: 90_000,
    cacheReadTokens: 12_000,
    cacheCreationTokens: 0,
  });
  expect(message).toContain("78%");
  expect(message).toContain("12%");
  expect(message).toContain("cache_read 12,000");
  expect(message).toContain("仍有 70,000");
  expect(message).toContain("Prompt 输入 69%");
});
