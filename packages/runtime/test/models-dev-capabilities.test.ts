import { expect, test } from "bun:test";
import {
  extractCapabilitiesFromModelEntry,
  lookupModelCapabilitiesInCatalog,
  unresolvedModelCapabilities,
} from "../src/models-dev-capabilities";
import { parseModelsDevCatalog } from "../src/models-dev-pricing";

const mockCatalog = parseModelsDevCatalog({
  anthropic: {
    id: "anthropic",
    models: {
      "claude-sonnet-4-6": {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        reasoning: true,
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        cost: { input: 3, output: 15 },
      },
      "claude-haiku-4-5": {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        reasoning: false,
        modalities: { input: ["text"], output: ["text"] },
        cost: { input: 0.8, output: 4 },
      },
    },
  },
});

test("extractCapabilitiesFromModelEntry detects image and reasoning", () => {
  const entry = mockCatalog.anthropic!.models["claude-sonnet-4-6"]!;
  const caps = extractCapabilitiesFromModelEntry(entry);
  expect(caps.supportsImageInput).toBe(true);
  expect(caps.supportsReasoning).toBe(true);
  expect(caps.capabilitiesResolved).toBe(true);
});

test("lookupModelCapabilitiesInCatalog exact match", () => {
  const result = lookupModelCapabilitiesInCatalog(mockCatalog, "anthropic", "claude-sonnet-4-6");
  expect(result?.capabilities.supportsImageInput).toBe(true);
  expect(result?.capabilities.supportsReasoning).toBe(true);
});

test("lookupModelCapabilitiesInCatalog resolves sonnet alias", () => {
  const result = lookupModelCapabilitiesInCatalog(mockCatalog, "anthropic", "sonnet");
  expect(result?.modelId).toContain("claude-sonnet");
  expect(result?.capabilities.supportsReasoning).toBe(true);
});

test("lookupModelCapabilitiesInCatalog returns null when unmatched", () => {
  const result = lookupModelCapabilitiesInCatalog(mockCatalog, "anthropic", "unknown-model-xyz");
  expect(result).toBeNull();
});

test("unresolvedModelCapabilities marks unresolved", () => {
  const caps = unresolvedModelCapabilities();
  expect(caps.capabilitiesResolved).toBe(false);
  expect(caps.supportsImageInput).toBe(false);
});
