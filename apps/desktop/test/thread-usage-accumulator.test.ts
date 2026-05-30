import { expect, test } from "bun:test";
import { ThreadUsageAccumulator } from "../src/main/thread-usage-accumulator";

const sonnetRates = { input: 3, output: 15 };
const haikuRates = { input: 0.8, output: 4 };

test("ThreadUsageAccumulator tracks four billing metrics", () => {
  const accumulator = new ThreadUsageAccumulator();
  const delta = { inputTokens: 100_000, outputTokens: 10_000, cacheReadTokens: 0, cacheCreationTokens: 0 };

  accumulator.recordUsage({
    threadId: "t1",
    role: "coder",
    delta,
    otelCostUsd: 0.5,
    actualRates: haikuRates,
    plannerRates: sonnetRates,
    modelId: "haiku",
    requestKey: "coder:100000:10000:0:0:haiku",
    plannerModelLabel: "sonnet · Anthropic",
  });

  const billing = accumulator.getSnapshot("t1");
  expect(billing?.otelCostUsd).toBe(0.5);
  expect(billing?.plannerTokenCostUsd).toBeCloseTo(0.45);
  expect(billing?.ecoCostUsd).toBeCloseTo(0.12);
  expect(billing?.savedUsd).toBeCloseTo(0.33);
  expect(billing?.totalTokens.input).toBe(100_000);
});

test("ThreadUsageAccumulator deduplicates by requestKey", () => {
  const accumulator = new ThreadUsageAccumulator();
  const input = {
    threadId: "t1",
    role: "planner" as const,
    delta: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 },
    otelCostUsd: 0.01,
    actualRates: sonnetRates,
    plannerRates: sonnetRates,
    requestKey: "dup-key",
  };
  accumulator.recordUsage(input);
  accumulator.recordUsage(input);
  const billing = accumulator.getSnapshot("t1");
  expect(billing?.otelCostUsd).toBe(0.01);
  expect(billing?.totalTokens.input).toBe(1000);
});
