import { expect, test } from "bun:test";
import { ThreadUsageAccumulator } from "../src/main/thread-usage-accumulator";

const sonnetRates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
const haikuRates = { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 };

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
    requestKey: "otel:coder:100000:10000:0:0:haiku",
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

test("ThreadUsageAccumulator recordRunUsage bills cache at models.dev rates", () => {
  const accumulator = new ThreadUsageAccumulator();
  accumulator.recordRunUsage({
    threadId: "t1",
    role: "planner",
    requestKey: "sdk-result:run-1",
    models: [
      {
        modelId: "claude-sonnet-4-6",
        usage: {
          inputTokens: 39,
          outputTokens: 904,
          cacheReadTokens: 230_827,
          cacheCreationTokens: 53_995,
        },
        actualRates: sonnetRates,
        plannerRates: sonnetRates,
      },
    ],
    otelCostUsd: 0.18,
  });

  const billing = accumulator.getSnapshot("t1");
  expect(billing?.totalTokens.cacheRead).toBe(230_827);
  expect(billing?.ecoCostBreakdown?.cacheReadUsd).toBeCloseTo(0.0692481, 4);
  expect(billing?.otelCostUsd).toBe(0.18);
});
