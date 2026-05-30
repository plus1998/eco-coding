import { expect, test } from "bun:test";
import {
  lookupModelCostInCatalog,
  parseModelsDevCatalog,
  resolveProviderKeyFromBaseUrl,
} from "../src/models-dev-pricing";

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
