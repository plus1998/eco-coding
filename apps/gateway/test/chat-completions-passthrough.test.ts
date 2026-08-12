import { describe, expect, test } from "bun:test";
import {
  GATEWAY_BRIDGE_BINDING_ID_HEADER,
  GATEWAY_PROVIDER_ID_HEADER,
  GATEWAY_REQUESTED_MODEL_HEADER,
  GATEWAY_RUN_ATTEMPT_ID_HEADER,
  GATEWAY_THREAD_ID_HEADER,
} from "../src/provider-router.js";
import type { GatewayProvider, GatewayRequestLifecycleEvent, GatewayUsageEvent } from "../src/types.js";
import { createTestGatewayFetchHandler } from "./test-bridge-rewrite.js";

const UPSTREAM_CHAT_SSE = [
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"llama","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}',
  "",
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"llama","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  "",
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"llama","choices":[],"usage":{"prompt_tokens":9,"completion_tokens":3,"total_tokens":12}}',
  "",
  "data: [DONE]",
  "",
].join("\n");

describe("POST /v1/chat/completions passthrough face", () => {
  test("forwards openai-chat body/SSE in original Chat Completions format", async () => {
    const provider: GatewayProvider = {
      id: "llama",
      name: "Llama",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.llama.test",
      apiKey: "sk-test",
      upstreamModelId: "llama-local",
      models: ["llama-local"],
    };
    let upstreamUrl = "";
    let upstreamBody: Record<string, unknown> | undefined;
    const usageEvents: GatewayUsageEvent[] = [];
    const lifecycle: GatewayRequestLifecycleEvent[] = [];
    const handler = createTestGatewayFetchHandler(
      { host: "127.0.0.1", port: 0, providers: [provider] },
      async (input, init) => {
        upstreamUrl = String(input);
        upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(UPSTREAM_CHAT_SSE, {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "x-request-id": "req_chat_1",
          },
        });
      },
      undefined,
      (event) => {
        usageEvents.push(event);
      },
      (event) => {
        lifecycle.push(event);
      },
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "llama",
          [GATEWAY_REQUESTED_MODEL_HEADER]: "alias-llama",
          [GATEWAY_THREAD_ID_HEADER]: "thr_pi_1",
          [GATEWAY_BRIDGE_BINDING_ID_HEADER]: "cbb_test",
          [GATEWAY_RUN_ATTEMPT_ID_HEADER]: "attempt_1",
        },
        body: JSON.stringify({
          model: "llama-local",
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(upstreamUrl).toBe("http://mock.llama.test/v1/chat/completions");
    expect(upstreamBody?.model).toBe("llama-local");
    expect(upstreamBody?.stream).toBe(true);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain('"object":"chat.completion.chunk"');
    expect(text).toContain("data: [DONE]");
    expect(text).not.toContain("response.created");
    expect(text).not.toContain("message_start");

    expect(usageEvents.some((e) => e.source === "chat_completions")).toBe(true);
    expect(usageEvents[0]?.bridgeBindingId).toBe("cbb_test");
    expect(lifecycle.some((e) => e.source === "chat_completions" && e.type === "logical.completed")).toBe(
      true,
    );
  });

  test("rejects anthropic-messages upstream on chat face (no disguise)", async () => {
    const provider: GatewayProvider = {
      id: "anthropic",
      name: "Anthropic",
      upstreamKind: "anthropic-messages",
      baseUrl: "http://mock.anthropic.test",
      apiKey: "sk-test",
      upstreamModelId: "claude",
      models: ["claude"],
    };
    let fetched = false;
    const handler = createTestGatewayFetchHandler(
      { host: "127.0.0.1", port: 0, providers: [provider] },
      async () => {
        fetched = true;
        return Response.json({ ok: true });
      },
    );
    const response = await handler(
      new Request("http://127.0.0.1/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "anthropic",
        },
        body: JSON.stringify({
          model: "claude",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("openai-chat");
    expect(fetched).toBe(false);
  });

  test("non-stream JSON passthrough preserves chat.completion object", async () => {
    const provider: GatewayProvider = {
      id: "chat",
      name: "Chat",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.chat.test",
      apiKey: "sk",
      upstreamModelId: "m1",
      models: ["m1"],
    };
    const handler = createTestGatewayFetchHandler(
      { host: "127.0.0.1", port: 0, providers: [provider] },
      async () =>
        Response.json({
          id: "chatcmpl-json",
          object: "chat.completion",
          created: 1,
          model: "m1",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
        }),
    );
    const response = await handler(
      new Request("http://127.0.0.1/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "chat",
        },
        body: JSON.stringify({
          model: "m1",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { object: string; choices: unknown[] };
    expect(body.object).toBe("chat.completion");
    expect(body.choices).toHaveLength(1);
  });
});
