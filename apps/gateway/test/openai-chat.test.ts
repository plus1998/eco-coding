import { describe, expect, test } from "bun:test";
import { buildCodexGatewayModelAlias } from "@eco/shared";
import { createGatewayFetchHandler } from "../src/server.js";
import { collectResponsesSseEvents } from "../src/upstream/responses-passthrough.js";
import type { GatewayConfig, GatewayProvider, GatewayUsageEvent } from "../src/types.js";

const UPSTREAM_CHAT_SSE = [
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"llama","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}',
  "",
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"llama","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  "",
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"llama","choices":[],"usage":{"prompt_tokens":9,"completion_tokens":3,"total_tokens":12,"prompt_tokens_details":{"cached_tokens":4}}}',
  "",
  "data: [DONE]",
  "",
].join("\n");

describe("openai-chat upstream", () => {
  test("V1 route alias overrides a Responses provider to Chat for this request", async () => {
    const provider: GatewayProvider = {
      id: "mixed-wire",
      name: "Mixed wire mock",
      upstreamKind: "responses",
      baseUrl: "http://mock.mixed.test",
      apiKey: "test-key",
      upstreamModelId: "responses-default",
      models: ["responses-default"],
    };
    const alias = buildCodexGatewayModelAlias(
      provider.id,
      "chat/model.__v1",
      "openai_chat_completions",
    );
    const usageEvents: GatewayUsageEvent[] = [];
    const handler = createGatewayFetchHandler(
      { host: "127.0.0.1", port: 0, providers: [provider] },
      async (input, init) => {
        expect(String(input)).toBe("http://mock.mixed.test/v1/chat/completions");
        const body = JSON.parse(String(init?.body)) as { model: string };
        expect(body.model).toBe("chat/model.__v1");
        return Response.json({
          id: "chatcmpl-override",
          object: "chat.completion",
          created: 1,
          model: "chat/model.__v1",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
        });
      },
      () => undefined,
      (event) => usageEvents.push(event),
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: alias, stream: false, input: '"ping"' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(usageEvents[0]).toMatchObject({
      providerId: "mixed-wire",
      requestedModel: alias,
      upstreamModelId: "chat/model.__v1",
    });
  });

  test("POST /v1/responses bridges to /v1/chat/completions and streams Responses SSE", async () => {
    const provider: GatewayProvider = {
      id: "llama-local",
      name: "Llama mock",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.llama.test",
      apiKey: "local-unused",
      upstreamModelId: "Qwopus.gguf",
      models: ["llama-local"],
    };
    const config: GatewayConfig = { host: "127.0.0.1", port: 0, providers: [provider] };

    const mockFetch: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("http://mock.llama.test/v1/chat/completions");
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        stream: boolean;
        messages: { role: string; content: string }[];
      };
      // Explicit model ids in `models` are forwarded as-is; only eco_{id} uses upstreamModelId.
      expect(body.model).toBe("llama-local");
      expect(body.stream).toBe(true);
      expect(body.messages.some((m) => m.role === "user")).toBe(true);
      return new Response(UPSTREAM_CHAT_SSE, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const usageEvents: GatewayUsageEvent[] = [];
    const handler = createGatewayFetchHandler(
      config,
      mockFetch,
      () => undefined,
      (event) => {
        usageEvents.push(event);
      },
    );
    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-codex-turn-metadata": JSON.stringify({
            thread_id: "codex_child",
            turn_id: "turn_chat_stream",
            parent_thread_id: "codex_root",
            subagent_kind: "collab_spawn",
            request_kind: "turn",
          }),
        },
        body: JSON.stringify({
          model: "llama-local",
          stream: true,
          input: '"ping"',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.body).not.toBeNull();
    const eventTypes = await collectResponsesSseEvents(response.body!);
    expect(eventTypes).toContain("response.created");
    expect(eventTypes).toContain("response.completed");
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      source: "responses",
      sourceEventId: "chat:llama-local:response:chatcmpl-1",
      providerId: "llama-local",
      requestedModel: "llama-local",
      upstreamModelId: "llama-local",
      stream: true,
      responseId: "chatcmpl-1",
      codexTurnMetadata: {
        threadId: "codex_child",
        turnId: "turn_chat_stream",
        parentThreadId: "codex_root",
        subagentKind: "collab_spawn",
        requestKind: "turn",
      },
      usage: {
        inputTokens: 5,
        outputTokens: 3,
        cacheReadTokens: 4,
        cacheCreationTokens: 0,
        modelId: "llama",
      },
    });
  });

  test("non-stream Chat usage keeps the exact Codex turn metadata", async () => {
    const provider: GatewayProvider = {
      id: "llama-local",
      name: "Llama mock",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.llama.test",
      apiKey: "local-unused",
      upstreamModelId: "Qwopus.gguf",
      models: ["llama-local"],
    };
    const config: GatewayConfig = { host: "127.0.0.1", port: 0, providers: [provider] };
    const mockFetch: typeof fetch = async () =>
      Response.json({
        id: "chatcmpl-json",
        object: "chat.completion",
        created: 1,
        model: "llama",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hi" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
      });

    const usageEvents: GatewayUsageEvent[] = [];
    const handler = createGatewayFetchHandler(
      config,
      mockFetch,
      () => undefined,
      (event) => usageEvents.push(event),
    );
    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-codex-turn-metadata": JSON.stringify({
            thread_id: "codex_root",
            turn_id: "turn_chat_json",
            request_kind: "turn",
          }),
        },
        body: JSON.stringify({
          model: "llama-local",
          stream: false,
          input: '"ping"',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "resp_chatcmpl-json" });
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      sourceEventId: "chat:llama-local:response:chatcmpl-json",
      stream: false,
      codexTurnMetadata: {
        threadId: "codex_root",
        turnId: "turn_chat_json",
        requestKind: "turn",
      },
      usage: {
        inputTokens: 7,
        outputTokens: 2,
      },
    });
  });
});
