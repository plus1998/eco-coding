import { expect, test } from "bun:test";
import {
  buildBridgeUpstreamMessagesPayload,
  forwardMessagesViaBridge,
  parseAnthropicStreamEventBlock,
  splitSseBlocks,
} from "../src/main/bridge-upstream";
import type { AnthropicRequest } from "@eco/openai-anthropic-bridge";
import type { IncomingMessage, ServerResponse } from "node:http";

test("buildBridgeUpstreamMessagesPayload passthrough anthropic without responses ir", () => {
  const request: AnthropicRequest = {
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [{ role: "user", content: "hi" }],
  };
  const body = buildBridgeUpstreamMessagesPayload("anthropic", request, "claude-sonnet-4-6", false);
  expect(body).toMatchObject({
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "hi" }],
  });
  expect(body).not.toHaveProperty("stream");
  expect(body).not.toHaveProperty("input");
  expect(body).not.toHaveProperty("store");
  expect(body).not.toHaveProperty("parallel_tool_calls");
});

test("buildBridgeUpstreamMessagesPayload preserves anthropic stream when SDK sends it", () => {
  const request: AnthropicRequest = {
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    stream: true,
    messages: [{ role: "user", content: "hi" }],
  };
  const body = buildBridgeUpstreamMessagesPayload("anthropic", request, "claude-sonnet-4-6", false);
  expect(body).toMatchObject({
    model: "claude-sonnet-4-6",
    stream: true,
    messages: [{ role: "user", content: "hi" }],
  });
});

test("forwardMessagesViaBridge passthrough anthropic json response without sse replay", async () => {
  const originalFetch = globalThis.fetch;
  const upstreamRaw = JSON.stringify({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "upstream-claude",
    content: [{ type: "text", text: "hi" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  let upstreamBody: Record<string, unknown> | undefined;

  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    upstreamBody = JSON.parse(String(init?.body));
    return new Response(upstreamRaw, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const chunks: string[] = [];
    let statusCode = 0;
    let responseHeaders: Record<string, unknown> | undefined;
    const response = {
      writableEnded: false,
      writeHead(status: number, headers?: Record<string, unknown>) {
        statusCode = status;
        responseHeaders = headers;
        return this;
      },
      write(chunk: unknown) {
        chunks.push(String(chunk));
        return true;
      },
      end(chunk?: unknown) {
        if (chunk !== undefined) {
          chunks.push(String(chunk));
        }
        this.writableEnded = true;
        return this;
      },
    } as unknown as ServerResponse;

    await forwardMessagesViaBridge(
      { headers: { "user-agent": "claude-sdk/1.0" } } as unknown as IncomingMessage,
      response,
      {
        route: {
          role: "coder",
          provider: {
            id: "p1",
            name: "Provider",
            baseUrl: "https://api.example.com",
            requestPath: "",
            apiKey: "sk-test",
          },
          modelId: "upstream-claude",
          apiCompat: "anthropic",
          aliasModelId: "alias-claude",
        },
        body: {
          model: "alias-claude",
          max_tokens: 16,
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        },
      },
    );

    expect(upstreamBody).toMatchObject({ model: "upstream-claude", stream: true });
    expect(statusCode).toBe(200);
    expect(responseHeaders).toEqual({ "content-type": "application/json" });
    expect(chunks.join("")).toBe(upstreamRaw);
    expect(chunks.join("")).not.toContain("event:");
  } finally {
    globalThis.fetch = originalFetch;
  }
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
