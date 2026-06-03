import { test, expect } from "bun:test";
import {
  accumulateThreadCost,
  formatCostUsd,
  formatRoleModelLabel,
  mergeUsageTotals,
  parseModelUsage,
  parseSdkContextUsage,
  parseSdkUsageBilling,
  parseUsagePayload,
} from "../src/usage";

test("parseModelUsage reads SDK modelUsage map", () => {
  const parsed = parseModelUsage({
    total_cost_usd: 0.12,
    modelUsage: {
      "claude-opus-4": {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 20,
        costUSD: 0.12,
      },
    },
  });

  expect(parsed).toEqual({
    "claude-opus-4": {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheCreationTokens: 0,
      costUsd: 0.12,
    },
  });
});

test("accumulateThreadCost sums query() costs", () => {
  expect(accumulateThreadCost(1.5, 0.6695)).toBeCloseTo(2.1695);
  expect(accumulateThreadCost(1.5, undefined)).toBe(1.5);
});

test("formatCostUsd renders dollar estimate", () => {
  expect(formatCostUsd(2.1695)).toBe("$2.1695");
});

test("mergeUsageTotals does not carry totalCostUsd", () => {
  const merged = mergeUsageTotals(
    { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, totalCostUsd: 0.1 },
    { inputTokens: 20, outputTokens: 8, cacheReadTokens: 0, cacheCreationTokens: 0, totalCostUsd: 0.2 },
  );
  expect(merged.inputTokens).toBe(30);
  expect(merged.totalCostUsd).toBeUndefined();
});

test("parseSdkContextUsage uses session usage not sum of modelUsage", () => {
  const usage = parseSdkContextUsage({
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 120_000,
      cache_creation_input_tokens: 0,
    },
    modelUsage: {
      "claude-sonnet-4-6": {
        inputTokens: 80_000,
        outputTokens: 50,
        cacheReadInputTokens: 400_000,
        cacheCreationInputTokens: 0,
      },
      "claude-haiku-4-5": {
        inputTokens: 20_000,
        outputTokens: 10,
        cacheReadInputTokens: 300_000,
        cacheCreationInputTokens: 0,
      },
    },
  });
  expect(usage?.cacheReadTokens).toBe(120_000);
});

test("parseSdkContextUsage picks subagent model entry instead of max occupancy", () => {
  const usage = parseSdkContextUsage(
    {
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: {
        "claude-sonnet-4-6": {
          inputTokens: 80_000,
          outputTokens: 50,
          cacheReadInputTokens: 400_000,
          cacheCreationInputTokens: 0,
        },
        "claude-haiku-4-5": {
          inputTokens: 5_000,
          outputTokens: 10,
          cacheReadInputTokens: 1_000,
          cacheCreationInputTokens: 0,
        },
      },
    },
    { subagentModelId: "claude-haiku-4-5" },
  );
  expect(usage?.inputTokens).toBe(5_000);
  expect(usage?.cacheReadTokens).toBe(1_000);
});

test("parseSdkUsageBilling prefers modelUsage cache fields for billing", () => {
  const bundle = parseSdkUsageBilling({
    total_cost_usd: 0.18,
    usage: { input_tokens: 33, output_tokens: 904, cache_read_input_tokens: 230827 },
    modelUsage: {
      "claude-sonnet-4-6": {
        inputTokens: 39,
        outputTokens: 904,
        cacheReadInputTokens: 230827,
        cacheCreationInputTokens: 53995,
        costUSD: 0.18,
      },
    },
  });
  expect(bundle?.authoritative).toBe(true);
  expect(bundle?.models[0]?.usage.cacheReadTokens).toBe(230827);
  expect(bundle?.models[0]?.usage.cacheCreationTokens).toBe(53995);
  expect(bundle?.contextUsage.cacheReadTokens).toBe(230827);
});

test("parseSdkUsageBilling sums modelUsage costs when total is absent", () => {
  const bundle = parseSdkUsageBilling({
    modelUsage: {
      "claude-sonnet-4-6": {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 20,
        cacheCreationInputTokens: 0,
        costUSD: 0.12,
      },
      "claude-haiku-4-5": {
        inputTokens: 200,
        outputTokens: 80,
        cacheReadInputTokens: 40,
        cacheCreationInputTokens: 10,
        costUSD: 0.03,
      },
    },
  });
  expect(bundle?.models).toHaveLength(2);
  expect(bundle?.totalCostUsd).toBeCloseTo(0.15);
  expect(bundle?.models[1]?.sdkCostUsd).toBe(0.03);
});

test("parseSdkUsageBilling marks assistant usage as non-authoritative", () => {
  const bundle = parseSdkUsageBilling({
    messageId: "msg_1",
    usage: { input_tokens: 1200, output_tokens: 80 },
  });
  expect(bundle?.authoritative).toBe(false);
});

test("parseUsagePayload reads total_cost_usd from result payload", () => {
  const parsed = parseUsagePayload({
    total_cost_usd: 2.1695,
    usage: { input_tokens: 1000, output_tokens: 200 },
  });
  expect(parsed?.totalCostUsd).toBe(2.1695);
  expect(parsed?.inputTokens).toBe(1000);
});

test("formatRoleModelLabel uses Chinese label for explore", () => {
  expect(formatRoleModelLabel("explore", "claude-opus-4-7")).toBe("探索 · claude-opus-4-7");
  expect(formatRoleModelLabel("planner", "claude-opus-4-7")).toBe("规划 · claude-opus-4-7");
});
