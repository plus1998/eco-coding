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
  test("applies configured model max_tokens and caps unsafe values", async () => {
    const provider: GatewayProvider = {
      id: "deepseek",
      name: "DeepSeek mock",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.deepseek.test",
      apiKey: "test-key",
      upstreamModelId: "deepseek-v4-flash",
      models: ["deepseek-v4-flash"],
      modelMaxOutputTokens: { "deepseek-v4-flash": 384_000 },
    };
    const logs: string[] = [];
    const handler = createGatewayFetchHandler(
      { host: "127.0.0.1", port: 0, providers: [provider] },
      async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          max_tokens?: number;
          max_completion_tokens?: number;
        };
        expect(body.max_tokens).toBe(64_000);
        expect(body.max_completion_tokens).toBeUndefined();
        return Response.json({
          id: "chatcmpl-limit",
          object: "chat.completion",
          created: 1,
          model: "deepseek-v4-flash",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
        });
      },
      (message) => logs.push(message),
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "deepseek-v4-flash", input: '"ping"' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(logs).toContainEqual(expect.stringContaining("requested=384000 applied=64000"));
  });

  test("fails a stream that ends without the [DONE] terminator", async () => {
    const provider: GatewayProvider = {
      id: "truncated",
      name: "Truncated mock",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.truncated.test",
      apiKey: "test-key",
      upstreamModelId: "deepseek-v4-flash",
      models: ["deepseek-v4-flash"],
    };
    const withoutDone = [
      'data: {"id":"chatcmpl-cut","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl-cut","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "",
    ].join("\n");
    const logs: string[] = [];
    const handler = createGatewayFetchHandler(
      { host: "127.0.0.1", port: 0, providers: [provider] },
      async () =>
        new Response(withoutDone, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      (message) => logs.push(message),
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "deepseek-v4-flash", stream: true, input: '"ping"' }),
      }),
    );
    const body = await response.text();

    expect(body).toContain('"type":"response.failed"');
    expect(body).toContain("ended before the [DONE] terminator");
    expect(logs).toContainEqual(
      expect.stringContaining("finish_reason=stop done=false"),
    );
  });

  test("fails a [DONE] stream when finish_reason is missing", async () => {
    const provider: GatewayProvider = {
      id: "missing-finish",
      name: "Missing finish mock",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.missing-finish.test",
      apiKey: "test-key",
      upstreamModelId: "deepseek-v4-flash",
      models: ["deepseek-v4-flash"],
    };
    const missingFinish = [
      'data: {"id":"chatcmpl-cut","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const handler = createGatewayFetchHandler(
      { host: "127.0.0.1", port: 0, providers: [provider] },
      async () =>
        new Response(missingFinish, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "deepseek-v4-flash", stream: true, input: '"ping"' }),
      }),
    );
    const body = await response.text();

    expect(body).toContain('"type":"response.failed"');
    expect(body).toContain('"code":"missing_finish_reason"');
  });

  test("rejects a successful streaming response without a body", async () => {
    const provider: GatewayProvider = {
      id: "bodyless",
      name: "Bodyless mock",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.bodyless.test",
      apiKey: "test-key",
      upstreamModelId: "deepseek-v4-flash",
      models: ["deepseek-v4-flash"],
    };
    const handler = createGatewayFetchHandler(
      { host: "127.0.0.1", port: 0, providers: [provider] },
      async () =>
        new Response(null, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "deepseek-v4-flash", stream: true, input: '"ping"' }),
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toContain("successful response without a body");
  });

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

  test("Chat route wraps apply_patch custom tool and restores custom_tool_call", async () => {
    const provider: GatewayProvider = {
      id: "chat-provider",
      name: "Chat mock",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.chat.test",
      apiKey: "test-key",
      upstreamModelId: "deepseek-v4",
      models: ["deepseek-v4"],
    };
    const alias = buildCodexGatewayModelAlias(
      provider.id,
      "deepseek-v4",
      "openai_chat_completions",
    );
    const patch = "*** Begin Patch\n*** Add File: a.txt\n+hi\n*** End Patch";
    let upstreamBody: {
      tools?: { type?: string; function?: { name?: string; parameters?: unknown } }[];
      messages?: { role?: string; tool_calls?: unknown[] }[];
    } = {};
    const handler = createGatewayFetchHandler(
      { host: "127.0.0.1", port: 0, providers: [provider] },
      async (_input, init) => {
        upstreamBody = JSON.parse(String(init?.body)) as typeof upstreamBody;
        return Response.json({
          id: "chatcmpl-custom",
          object: "chat.completion",
          created: 1,
          model: "deepseek-v4",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "call_patch",
                    type: "function",
                    function: {
                      name: "apply_patch",
                      arguments: JSON.stringify({ input: patch }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        });
      },
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: alias,
          stream: false,
          input: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "patch" }],
            },
          ],
          tools: [
            {
              type: "custom",
              name: "apply_patch",
              description: "Apply freeform patch",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(upstreamBody.tools?.[0]).toMatchObject({
      type: "function",
      function: { name: "apply_patch" },
    });
    expect(JSON.stringify(upstreamBody.tools?.[0]?.function?.parameters)).toContain('"input"');
    const body = (await response.json()) as {
      output?: { type?: string; name?: string; input?: string }[];
    };
    expect(body.output?.[0]).toMatchObject({
      type: "custom_tool_call",
      name: "apply_patch",
      input: patch,
    });
  });

  test("applies GatewayConfig upstreamUserAgent override on upstream fetch", async () => {
    const provider: GatewayProvider = {
      id: "ua-provider",
      name: "UA mock",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.ua.test",
      apiKey: "test-key",
      upstreamModelId: "ua-model",
      models: ["ua-model"],
    };
    let seenUa: string | null = null;
    const handler = createGatewayFetchHandler(
      {
        host: "127.0.0.1",
        port: 0,
        providers: [provider],
        upstreamUserAgent: "eco-custom-ua/1",
      },
      async (_input, init) => {
        const headers = new Headers(init?.headers);
        seenUa = headers.get("user-agent");
        return Response.json({
          id: "chatcmpl-ua",
          object: "chat.completion",
          created: 1,
          model: "ua-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
        });
      },
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "codex-client/9",
        },
        body: JSON.stringify({ model: "ua-model", input: '"ping"' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(seenUa).toBe("eco-custom-ua/1");
  });
});
