import { describe, expect, test } from "bun:test";
import {
  GATEWAY_LOGICAL_REQUEST_ID_HEADER,
  GATEWAY_PROVIDER_ID_HEADER,
  GATEWAY_REQUESTED_MODEL_HEADER,
} from "../src/provider-router.js";
import type { GatewayConfig, GatewayProvider } from "../src/types.js";
import {
  copyUpstreamRequestIdHeaders,
  headersWithLogicalRequestIdentity,
  headersWithUpstreamRequestId,
  readUpstreamRequestId,
} from "../src/upstream/request-id-headers.js";
import { createTestGatewayFetchHandler } from "./test-bridge-rewrite.js";

describe("upstream request-id headers", () => {
  test("readUpstreamRequestId prefers request-id then x-request-id", () => {
    expect(
      readUpstreamRequestId(
        new Headers({
          "x-request-id": "x",
          "request-id": "req",
        }),
      ),
    ).toBe("req");
    expect(readUpstreamRequestId(new Headers({ "openai-request-id": "oai" }))).toBe("oai");
    expect(readUpstreamRequestId(new Headers())).toBeUndefined();
  });

  test("copyUpstreamRequestIdHeaders does not overwrite existing dest values", () => {
    const dest = copyUpstreamRequestIdHeaders(
      new Headers({ "request-id": "from-up", "x-request-id": "x-up" }),
      new Headers({ "request-id": "already" }),
    );
    expect(dest.get("request-id")).toBe("already");
    expect(dest.get("x-request-id")).toBe("x-up");
  });

  test("headersWithUpstreamRequestId merges onto rebuilt content-type", () => {
    const headers = headersWithUpstreamRequestId(new Headers({ "request-id": "req_1" }), {
      "content-type": "application/json",
    });
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("request-id")).toBe("req_1");
  });

  test("messages→chat conversion echoes upstream x-request-id", async () => {
    const provider: GatewayProvider = {
      id: "chat",
      name: "Chat",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.chat.test",
      apiKey: "sk-test",
      upstreamModelId: "chat-model",
      models: ["chat-model"],
    };
    const config: GatewayConfig = {
      host: "127.0.0.1",
      port: 0,
      providers: [provider],
    };
    const handler = createTestGatewayFetchHandler(config, async () =>
      Response.json(
        {
          id: "chatcmpl-msg",
          object: "chat.completion",
          created: 1,
          model: "chat-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "hi from chat" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        },
        { headers: { "x-request-id": "req_chat_convert" } },
      ),
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "chat",
          [GATEWAY_REQUESTED_MODEL_HEADER]: "eco-coder-alias",
        },
        body: JSON.stringify({
          model: "chat-model",
          max_tokens: 64,
          stream: false,
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req_chat_convert");
  });

  test("messages→responses JSON conversion echoes upstream request-id", async () => {
    const provider: GatewayProvider = {
      id: "resp",
      name: "Responses",
      upstreamKind: "responses",
      baseUrl: "http://mock.resp.test",
      apiKey: "sk-test",
      upstreamModelId: "gpt-test",
      models: ["gpt-test"],
    };
    const config: GatewayConfig = { host: "127.0.0.1", port: 0, providers: [provider] };
    const handler = createTestGatewayFetchHandler(config, async () =>
      Response.json(
        {
          id: "resp_json",
          object: "response",
          status: "completed",
          model: "gpt-test",
          output: [
            {
              type: "message",
              id: "msg_1",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "ok" }],
            },
          ],
          usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
        },
        { headers: { "request-id": "req_resp_json" } },
      ),
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "resp",
        },
        body: JSON.stringify({
          model: "gpt-test",
          max_tokens: 64,
          stream: false,
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("request-id")).toBe("req_resp_json");
  });

  test("headersWithLogicalRequestIdentity rewrites request-id and preserves provider metadata", () => {
    const headers = headersWithLogicalRequestIdentity(
      new Headers({ "request-id": "provider_req", "x-request-id": "x_provider" }),
      "req_logical_eco",
      { "content-type": "application/json" },
    );
    expect(headers.get("request-id")).toBe("req_logical_eco");
    expect(headers.get("x-eco-provider-request-id")).toBe("provider_req");
    expect(headers.get("x-request-id")).toBe("x_provider");
    expect(headers.get("content-type")).toBe("application/json");
  });

  test("headersWithLogicalRequestIdentity leaves upstream request-id when logical id absent", () => {
    const headers = headersWithLogicalRequestIdentity(
      new Headers({ "request-id": "provider_only" }),
      undefined,
      { "content-type": "application/json" },
    );
    expect(headers.get("request-id")).toBe("provider_only");
    expect(headers.get("x-eco-provider-request-id")).toBeNull();
  });

  test("messages face exposes ECO logicalRequestId as request-id for Claude SDK", async () => {
    const provider: GatewayProvider = {
      id: "chat",
      name: "Chat",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.chat.test",
      apiKey: "sk-test",
      upstreamModelId: "chat-model",
      models: ["chat-model"],
    };
    const config: GatewayConfig = {
      host: "127.0.0.1",
      port: 0,
      providers: [provider],
    };
    const handler = createTestGatewayFetchHandler(config, async () =>
      Response.json(
        {
          id: "chatcmpl-msg",
          object: "chat.completion",
          created: 1,
          model: "chat-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "hi from chat" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        },
        { headers: { "request-id": "provider_chat_1" } },
      ),
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "chat",
          [GATEWAY_REQUESTED_MODEL_HEADER]: "eco-coder-alias",
          [GATEWAY_LOGICAL_REQUEST_ID_HEADER]: "req_bridge_logical_1",
        },
        body: JSON.stringify({
          model: "chat-model",
          max_tokens: 64,
          stream: false,
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("request-id")).toBe("req_bridge_logical_1");
    expect(response.headers.get("x-eco-provider-request-id")).toBe("provider_chat_1");
  });

  test("native anthropic-messages non-stream rewrites request-id to logicalRequestId", async () => {
    const provider: GatewayProvider = {
      id: "anth",
      name: "Anthropic",
      upstreamKind: "anthropic-messages",
      baseUrl: "http://mock.anth.test",
      apiKey: "sk-test",
      upstreamModelId: "claude-test",
      models: ["claude-test"],
    };
    const config: GatewayConfig = { host: "127.0.0.1", port: 0, providers: [provider] };
    const handler = createTestGatewayFetchHandler(config, async () =>
      Response.json(
        {
          id: "msg_native",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          model: "claude-test",
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        },
        { headers: { "request-id": "provider_native_1" } },
      ),
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "anth",
          [GATEWAY_LOGICAL_REQUEST_ID_HEADER]: "req_native_logical",
        },
        body: JSON.stringify({
          model: "claude-test",
          max_tokens: 16,
          stream: false,
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("request-id")).toBe("req_native_logical");
    expect(response.headers.get("x-eco-provider-request-id")).toBe("provider_native_1");
  });

  test("native anthropic-messages stream rewrites request-id to logicalRequestId", async () => {
    const provider: GatewayProvider = {
      id: "anth_stream",
      name: "Anthropic",
      upstreamKind: "anthropic-messages",
      baseUrl: "http://mock.anth-stream.test",
      apiKey: "sk-test",
      upstreamModelId: "claude-stream",
      models: ["claude-stream"],
    };
    const config: GatewayConfig = { host: "127.0.0.1", port: 0, providers: [provider] };
    const sse = [
      "event: message_start",
      'data: {"type":"message_start","message":{"id":"msg_s","type":"message","role":"assistant","content":[],"model":"claude-stream","stop_reason":null,"usage":{"input_tokens":1,"output_tokens":0}}}',
      "",
      "event: content_block_start",
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      "",
      "event: content_block_delta",
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
      "",
      "event: content_block_stop",
      'data: {"type":"content_block_stop","index":0}',
      "",
      "event: message_delta",
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}',
      "",
      "event: message_stop",
      'data: {"type":"message_stop"}',
      "",
    ].join("\n");
    const handler = createTestGatewayFetchHandler(
      config,
      async () =>
        new Response(sse, {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "request-id": "provider_stream_1",
          },
        }),
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "anth_stream",
          [GATEWAY_LOGICAL_REQUEST_ID_HEADER]: "req_stream_logical",
        },
        body: JSON.stringify({
          model: "claude-stream",
          max_tokens: 16,
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("request-id")).toBe("req_stream_logical");
    expect(response.headers.get("x-eco-provider-request-id")).toBe("provider_stream_1");
    await response.text();
  });
});
