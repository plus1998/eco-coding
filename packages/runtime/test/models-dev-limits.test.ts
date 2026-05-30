import { expect, test } from "bun:test";
import { mergeBreakdownWithOccupancy, parseContextCommandResult } from "../src/context-breakdown";
import {
  computeOccupancyRatio,
  computeWindowOccupancy,
  formatContextLimit,
  lookupModelLimitsInCatalog,
  occupancyPercent,
} from "../src/models-dev-limits";
import { parseModelsDevCatalog } from "../src/models-dev-pricing";

const mockCatalog = parseModelsDevCatalog({
  anthropic: {
    id: "anthropic",
    models: {
      "claude-sonnet-4-6": {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        limit: { context: 200000, output: 64000 },
        cost: { input: 3, output: 15 },
      },
    },
  },
});

test("lookupModelLimitsInCatalog exact match", () => {
  const result = lookupModelLimitsInCatalog(mockCatalog, "anthropic", "claude-sonnet-4-6");
  expect(result?.limits.contextTokens).toBe(200000);
  expect(result?.limits.maxOutputTokens).toBe(64000);
});

test("formatContextLimit compacts token counts", () => {
  expect(formatContextLimit(200_000)).toBe("200K");
  expect(formatContextLimit(1_000_000)).toBe("1.0M");
});

test("computeWindowOccupancy uses input and cache only", () => {
  expect(
    computeWindowOccupancy({
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheCreationTokens: 100,
    }),
  ).toBe(1300);
});

test("computeOccupancyRatio at threshold", () => {
  const { atThreshold } = computeOccupancyRatio(170_000, 200_000, 0.85);
  expect(atThreshold).toBe(true);
});

test("occupancyPercent caps at 100", () => {
  expect(occupancyPercent(250_000, 200_000)).toBe(100);
});

test("parseContextCommandResult parses labeled lines", () => {
  const segments = parseContextCommandResult(`
System prompt: 461 tokens
Tool definitions: 8.3K
Conversation: 42.8K
`);
  expect(segments.find((s) => s.key === "systemPrompt")?.tokens).toBe(461);
  expect(segments.find((s) => s.key === "toolDefinitions")?.tokens).toBe(8300);
  expect(segments.find((s) => s.key === "conversation")?.tokens).toBe(42800);
});

test("parseContextCommandResult fallback conversation", () => {
  const segments = parseContextCommandResult("no structured data", 50_000);
  expect(segments).toHaveLength(1);
  expect(segments[0]?.key).toBe("conversation");
  expect(segments[0]?.tokens).toBe(50_000);
});

test("mergeBreakdownWithOccupancy adds unattributed gap", () => {
  const segments = mergeBreakdownWithOccupancy(
    [{ key: "conversation", label: "对话", tokens: 520_000, color: "#ea580c" }],
    840_000,
  );
  expect(segments.find((s) => s.key === "unattributed")?.tokens).toBe(320_000);
});
