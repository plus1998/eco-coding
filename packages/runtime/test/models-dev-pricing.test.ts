import { expect, test } from "bun:test";
import {
  buildModelPricingSummary,
  expandModelLookupCandidates,
  formatModelPricingLabel,
  formatRatePerMillion,
  lookupModelCostInCatalog,
  parseModelsDevCatalog,
  resolveProviderKeyFromBaseUrl,
} from "../src/models-dev-pricing";
import { lookupModelLimitsInCatalog } from "../src/models-dev-limits";

const mockCatalog = parseModelsDevCatalog({
  anthropic: {
    id: "anthropic",
    models: {
      "claude-sonnet-4-6": {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
      },
      "claude-haiku-4-5": {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        cost: { input: 0.8, output: 4, cache_read: 0.08, cache_write: 1 },
      },
    },
  },
});

test("resolveProviderKeyFromBaseUrl maps anthropic", () => {
  expect(resolveProviderKeyFromBaseUrl("https://api.anthropic.com")).toBe("anthropic");
});

test("lookupModelCostInCatalog exact match", () => {
  const result = lookupModelCostInCatalog(mockCatalog, "anthropic", "claude-sonnet-4-6");
  expect(result?.rates.input).toBe(3);
  expect(result?.rates.output).toBe(15);
  expect(result?.rates.cacheRead).toBe(0.3);
  expect(result?.rates.cacheWrite).toBe(3.75);
});

test("lookupModelCostInCatalog resolves sonnet alias", () => {
  const result = lookupModelCostInCatalog(mockCatalog, "anthropic", "sonnet");
  expect(result?.modelId).toContain("claude-sonnet");
  expect(result?.rates.input).toBe(3);
});

test("lookupModelCostInCatalog searches all providers when hint missing", () => {
  const result = lookupModelCostInCatalog(mockCatalog, null, "claude-haiku-4-5");
  expect(result?.rates.input).toBe(0.8);
});

test("expandModelLookupCandidates normalizes openrouter anthropic ids", () => {
  expect(expandModelLookupCandidates("claude-opus-4-7", "openrouter")).toEqual([
    "claude-opus-4-7",
    "claude-opus-4.7",
    "anthropic/claude-opus-4-7",
    "anthropic/claude-opus-4.7",
  ]);
});

const openRouterCatalog = parseModelsDevCatalog({
  openrouter: {
    id: "openrouter",
    models: {
      "anthropic/claude-opus-4.7": {
        id: "anthropic/claude-opus-4.7",
        limit: { context: 1_000_000, output: 128_000 },
        cost: { input: 5, output: 25 },
      },
      "anthropic/claude-opus-4": {
        id: "anthropic/claude-opus-4",
        limit: { context: 200_000, output: 32_000 },
        cost: { input: 4, output: 20 },
      },
    },
  },
});

test("formatRatePerMillion compacts USD display", () => {
  expect(formatRatePerMillion(5)).toBe("$5");
  expect(formatRatePerMillion(0.5)).toBe("$0.5");
  expect(formatRatePerMillion(6.25)).toBe("$6.25");
});

test("formatModelPricingLabel uses Chinese segments", () => {
  const lookup = lookupModelCostInCatalog(mockCatalog, "anthropic", "claude-sonnet-4-6");
  expect(lookup).not.toBeNull();
  const label = formatModelPricingLabel(lookup!);
  expect(label).toContain("输入 $3/M");
  expect(label).toContain("缓存读 $0.3/M");
});

test("buildModelPricingSummary extracts rates", () => {
  const lookup = lookupModelCostInCatalog(mockCatalog, "anthropic", "claude-sonnet-4-6");
  const summary = buildModelPricingSummary(lookup!);
  expect(summary.inputPerM).toBe(3);
  expect(summary.cacheWritePerM).toBe(3.75);
});

test("lookupModelLimitsInCatalog resolves hyphenated id on openrouter", () => {
  const result = lookupModelLimitsInCatalog(openRouterCatalog, "openrouter", "claude-opus-4-7");
  expect(result?.modelId).toBe("anthropic/claude-opus-4.7");
  expect(result?.limits.contextTokens).toBe(1_000_000);
});
