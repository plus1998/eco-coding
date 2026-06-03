import { expect, test } from "bun:test";
import {
  expandAssistantMessageContent,
  normalizeAnthropicContentBlocks,
  tryParseSerializedAnthropicContentBlocks,
} from "../src/anthropic-content-normalize.js";

const sampleJson =
  '[{"type":"text","text":"The dashboard tabs are in the admin panel."},{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/tmp/main.tsx","offset":3220,"limit":80}}]';

test("tryParseSerializedAnthropicContentBlocks detects embedded content array", () => {
  const blocks = tryParseSerializedAnthropicContentBlocks(sampleJson);
  expect(blocks).toHaveLength(2);
  expect(blocks?.[0]?.type).toBe("text");
  expect(blocks?.[1]?.name).toBe("Read");
});

test("normalizeAnthropicContentBlocks expands a single text block", () => {
  const normalized = normalizeAnthropicContentBlocks([
    { type: "text", text: sampleJson },
  ]);
  expect(normalized).toHaveLength(2);
  expect(normalized[0]?.type).toBe("text");
  expect(normalized[1]?.type).toBe("tool_use");
});

test("expandAssistantMessageContent leaves proper blocks unchanged", () => {
  const expanded = expandAssistantMessageContent([
    { type: "text", text: "hello" },
    { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a.ts" } },
  ]);
  expect(expanded).toHaveLength(2);
});
