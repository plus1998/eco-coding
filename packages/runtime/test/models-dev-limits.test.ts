import { expect, test } from "bun:test";
import { mergeBreakdownWithOccupancy, parseContextCommandHeader, parseContextCommandResult } from "../src/context-breakdown";
import {
  computeOccupancyRatio,
  computeWindowOccupancy,
  DEFAULT_AUTOCOMPACT_BUFFER,
  effectiveContextLimit,
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

test("parseContextCommandResult maps Claude and Cursor style categories", () => {
  const segments = parseContextCommandResult(`
Messages: 10K
MCP tools: 2K
Memory files: 500
Subagents: 1.2K
Custom extension: 300
Total: 14K
`);
  expect(segments.find((s) => s.key === "conversation")?.tokens).toBe(10_000);
  expect(segments.find((s) => s.key === "mcp")?.tokens).toBe(2000);
  expect(segments.find((s) => s.key === "rules")?.tokens).toBe(500);
  expect(segments.find((s) => s.key === "subagentDefinitions")?.tokens).toBe(1200);
  expect(segments.find((s) => s.key === "unattributed")?.tokens).toBe(300);
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

test("parseContextCommandHeader parses Claude Code summary line", () => {
  const header = parseContextCommandHeader(`
claude-sonnet-4-20250514 · 76k/200k tokens (38%)
System prompt: 2.7k tokens
`);
  expect(header).toEqual({ occupied: 76_000, limit: 200_000, occupancyPct: 38 });
});

test("parseContextCommandHeader parses compact numeric forms", () => {
  const header = parseContextCommandHeader("gpt-5.5 · 17k/1.1M tokens (2%)");
  expect(header?.occupied).toBe(17_000);
  expect(header?.limit).toBe(1_100_000);
  expect(header?.occupancyPct).toBe(2);
});

test("effectiveContextLimit deducts autocompact buffer and output reserve", () => {
  expect(effectiveContextLimit(200_000)).toBe(200_000 - DEFAULT_AUTOCOMPACT_BUFFER - 20_000);
  expect(effectiveContextLimit(200_000, 8_000)).toBe(200_000 - DEFAULT_AUTOCOMPACT_BUFFER - 8_000);
  expect(effectiveContextLimit(40_000)).toBe(20_000);
});
