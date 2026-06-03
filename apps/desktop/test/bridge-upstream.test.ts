import { expect, test } from "bun:test";
import {
  buildBridgeUpstreamMessagesPayload,
  parseAnthropicStreamEventBlock,
  splitSseBlocks,
} from "../src/main/bridge-upstream";
import type { AnthropicRequest } from "@eco/openai-anthropic-bridge";

test("buildBridgeUpstreamMessagesPayload normalizes anthropic user content", () => {
  const request: AnthropicRequest = {
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [{ role: "user", content: "hi" }],
  };
  const body = buildBridgeUpstreamMessagesPayload("anthropic", request, "claude-sonnet-4-6", false);
  expect(body).toMatchObject({
    model: "claude-sonnet-4-6",
    stream: false,
    messages: [{ role: "user", content: '[{"type":"text","text":"hi"}]' }],
  });
});

test("parseAnthropicStreamEventBlock reads text_delta from SSE block", () => {
  const block = [
    "event: content_block_delta",
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}',
  ].join("\n");
  const event = parseAnthropicStreamEventBlock(block);
  expect(event?.type).toBe("content_block_delta");
  expect(event?.delta).toMatchObject({ type: "text_delta", text: "Hi" });
});

test("splitSseBlocks splits event stream chunks", () => {
  const { blocks, remainder } = splitSseBlocks("event: ping\ndata: {}\n\nevent: done\ndata: {}\n\npart");
  expect(blocks).toHaveLength(2);
  expect(remainder).toBe("part");
});
