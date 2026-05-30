import { test, expect } from "bun:test";
import {
  accumulateThreadCost,
  formatCostUsd,
  mergeUsageTotals,
  parseModelUsage,
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
