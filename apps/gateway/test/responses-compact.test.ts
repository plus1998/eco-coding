import { describe, expect, test } from "bun:test";
import { createTestGatewayFetchHandler } from "./test-bridge-rewrite.js";
import type {
  GatewayConfig,
  GatewayProvider,
  GatewayUsageEvent,
  GatewayUsageObserver,
} from "../src/types.js";

async function postCompact(
  provider: GatewayProvider,
  fetchImpl: typeof fetch,
  model = provider.models[0] ?? provider.upstreamModelId,
  options?: {
    codexTurnMetadataHeader?: string;
    onUsage?: GatewayUsageObserver;
  },
): Promise<Response> {
  const config: GatewayConfig = { host: "127.0.0.1", port: 0, providers: [provider] };
  const handler = createTestGatewayFetchHandler(
    config,
    fetchImpl,
    () => undefined,
    options?.onUsage,
  );
  const headers = new Headers({ "content-type": "application/json" });
  if (options?.codexTurnMetadataHeader !== undefined) {
    headers.set("x-codex-turn-metadata", options.codexTurnMetadataHeader);
  }
  return handler(
    new Request("http://127.0.0.1/v1/responses/compact", {
      method: "POST",
      headers,
      body: JSON.stringify({ model, input: '"compact please"' }),
    }),
  );
}

async function postResponses(
  provider: GatewayProvider,
  fetchImpl: typeof fetch,
  input: unknown,
  model = provider.models[0] ?? provider.upstreamModelId,
  options?: {
    codexTurnMetadataHeader?: string;
    onUsage?: GatewayUsageObserver;
  },
): Promise<Response> {
  const config: GatewayConfig = { host: "127.0.0.1", port: 0, providers: [provider] };
  const handler = createTestGatewayFetchHandler(
    config,
    fetchImpl,
    () => undefined,
    options?.onUsage,
  );
  const headers = new Headers({ "content-type": "application/json" });
  if (options?.codexTurnMetadataHeader !== undefined) {
    headers.set("x-codex-turn-metadata", options.codexTurnMetadataHeader);
  }
  return handler(
    new Request("http://127.0.0.1/v1/responses", {
      method: "POST",
      headers,
      body: JSON.stringify({ model, input }),
    }),
  );
}

function responsesProvider(): GatewayProvider {
  return {
    id: "openai",
    name: "OpenAI",
    upstreamKind: "responses",
    baseUrl: "http://mock.openai.test",
    apiKey: "sk-test",
    upstreamModelId: "gpt-5.4",
    models: ["openai-alias"],
  };
}

describe("POST /v1/responses/compact (gateway pure)", () => {
  test("gateway never forwards compact — Eco Bridge owns it", async () => {
    for (const provider of [
      responsesProvider(),
      {
        id: "llama-local",
        name: "Llama mock",
        upstreamKind: "openai-chat" as const,
        baseUrl: "http://mock.llama.test",
        apiKey: "local-unused",
        upstreamModelId: "Qwopus.gguf",
        models: ["llama-local"],
      },
      {
        id: "anthropic",
        name: "Anthropic",
        upstreamKind: "anthropic-messages" as const,
        baseUrl: "http://mock.anthropic.test",
        apiKey: "sk-ant-test",
        upstreamModelId: "claude-opus-4-6",
        models: ["claude-opus"],
      },
    ]) {
      let fetchCalled = false;
      const response = await postCompact(provider, async () => {
        fetchCalled = true;
        return Response.json({});
      });
      expect(fetchCalled).toBe(false);
      expect(response.status).toBe(501);
      const json = (await response.json()) as { error: { type: string; message: string } };
      expect(json.error.type).toBe("eco_bridge_compact_only");
      expect(json.error.message).toContain("Eco Bridge");
    }
  });

  test("compact rejection emits no usage event", async () => {
    const usageEvents: GatewayUsageEvent[] = [];
    const response = await postCompact(
      responsesProvider(),
      async () => Response.json({}),
      "eco_openai",
      {
        codexTurnMetadataHeader: JSON.stringify({
          thread_id: "codex_root",
          turn_id: "turn_compact",
          request_kind: "compaction",
        }),
        onUsage: (event) => {
          usageEvents.push(event);
        },
      },
    );
    expect(response.status).toBe(501);
    expect(usageEvents).toEqual([]);
  });
});

describe("POST /v1/responses local compaction summaries", () => {
  const summaryInput = [
    {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: "Summarize the conversation while preserving decisions and pending work.",
        },
      ],
    },
  ];
  const compactionMetadata = JSON.stringify({
    thread_id: "codex_root",
    turn_id: "turn_local_compact",
    request_kind: "compaction",
  });

  test("openai-chat forwards a normal summary request and emits one compaction usage event", async () => {
    const provider: GatewayProvider = {
      id: "chat",
      name: "Chat mock",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.chat.test",
      apiKey: "test-key",
      upstreamModelId: "chat-model",
      models: ["chat-model"],
    };
    const usageEvents: GatewayUsageEvent[] = [];
    let fetchCount = 0;
    const response = await postResponses(
      provider,
      async (input, init) => {
        fetchCount += 1;
        expect(String(input)).toBe("http://mock.chat.test/v1/chat/completions");
        const upstreamBody = JSON.parse(String(init?.body)) as { messages: unknown };
        expect(JSON.stringify(upstreamBody.messages)).toContain("Summarize the conversation");
        return Response.json({
          id: "chatcmpl-local-compact",
          object: "chat.completion",
          created: 1,
          model: "chat-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Conversation summary" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
        });
      },
      summaryInput,
      "chat-model",
      {
        codexTurnMetadataHeader: compactionMetadata,
        onUsage: (event) => {
          usageEvents.push(event);
        },
      },
    );

    expect(response.status).toBe(200);
    expect(fetchCount).toBe(1);
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      sourceEventId: "chat:chat:response:chatcmpl-local-compact",
      providerId: "chat",
      stream: false,
      codexTurnMetadata: {
        threadId: "codex_root",
        turnId: "turn_local_compact",
        requestKind: "compaction",
      },
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        modelId: "chat-model",
      },
    });
  });

  test("anthropic-messages forwards a normal summary request and emits one compaction usage event", async () => {
    const provider: GatewayProvider = {
      id: "anthropic",
      name: "Anthropic mock",
      upstreamKind: "anthropic-messages",
      baseUrl: "http://mock.anthropic.test",
      apiKey: "test-key",
      upstreamModelId: "claude-model",
      models: ["claude-model"],
    };
    const usageEvents: GatewayUsageEvent[] = [];
    let fetchCount = 0;
    const response = await postResponses(
      provider,
      async (input, init) => {
        fetchCount += 1;
        expect(String(input)).toBe("http://mock.anthropic.test/v1/messages");
        const upstreamBody = JSON.parse(String(init?.body)) as { messages: unknown };
        expect(JSON.stringify(upstreamBody.messages)).toContain("Summarize the conversation");
        return Response.json(
          {
            id: "msg_local_compact",
            type: "message",
            role: "assistant",
            model: "claude-model",
            content: [{ type: "text", text: "Conversation summary" }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: {
              input_tokens: 14,
              output_tokens: 4,
              cache_read_input_tokens: 2,
              cache_creation_input_tokens: 1,
            },
          },
          { headers: { "request-id": "req_local_compact" } },
        );
      },
      summaryInput,
      "claude-model",
      {
        codexTurnMetadataHeader: compactionMetadata,
        onUsage: (event) => {
          usageEvents.push(event);
        },
      },
    );

    expect(response.status).toBe(200);
    expect(fetchCount).toBe(1);
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      sourceEventId: "anthropic:anthropic:response:msg_local_compact",
      providerId: "anthropic",
      stream: false,
      responseId: "msg_local_compact",
      providerRequestId: "req_local_compact",
      codexTurnMetadata: {
        threadId: "codex_root",
        turnId: "turn_local_compact",
        requestKind: "compaction",
      },
      usage: {
        inputTokens: 14,
        outputTokens: 4,
        cacheReadTokens: 2,
        cacheCreationTokens: 1,
        modelId: "claude-model",
      },
    });
  });
});

describe("POST /v1/responses compaction trigger routing", () => {
  test("openai-chat rejects an array compaction trigger before fetch", async () => {
    const provider: GatewayProvider = {
      id: "chat",
      name: "Chat mock",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.chat.test",
      apiKey: "test-key",
      upstreamModelId: "chat-model",
      models: ["chat-model"],
    };
    let fetchCalled = false;
    const response = await postResponses(provider, async () => {
      fetchCalled = true;
      return Response.json({});
    }, [{ type: "compaction_trigger" }]);

    expect(fetchCalled).toBe(false);
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: { type: "unsupported_error" } });
  });

  test("anthropic-messages rejects a JSON-string compaction trigger before fetch", async () => {
    const provider: GatewayProvider = {
      id: "anthropic",
      name: "Anthropic mock",
      upstreamKind: "anthropic-messages",
      baseUrl: "http://mock.anthropic.test",
      apiKey: "test-key",
      upstreamModelId: "claude-model",
      models: ["claude-model"],
    };
    const input = JSON.stringify([{ type: "message", role: "user" }, { type: "compaction_trigger" }]);
    let fetchCalled = false;
    const response = await postResponses(
      provider,
      async () => {
        fetchCalled = true;
        return Response.json({});
      },
      input,
    );

    expect(fetchCalled).toBe(false);
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: { type: "unsupported_error" } });
  });

  for (const upstreamKind of ["responses", "gateway-delegated"] as const) {
    test(`${upstreamKind} preserves and forwards compaction triggers`, async () => {
      const provider: GatewayProvider = {
        id: upstreamKind,
        name: `${upstreamKind} mock`,
        upstreamKind,
        baseUrl: `http://mock.${upstreamKind}.test`,
        apiKey: "test-key",
        upstreamModelId: `${upstreamKind}-model`,
        models: [`${upstreamKind}-model`],
      };
      const input = [{ type: "message", role: "user" }, { type: "compaction_trigger" }];
      let forwardedInput: unknown;
      const response = await postResponses(
        provider,
        async (_url, init) => {
          forwardedInput = (JSON.parse(String(init?.body)) as { input: unknown }).input;
          return Response.json({ id: `resp_${upstreamKind}`, output: [] });
        },
        input,
      );

      expect(response.status).toBe(200);
      expect(forwardedInput).toEqual(input);
    });
  }

  test("message text mentioning compaction_trigger is not treated as a trigger", async () => {
    const provider: GatewayProvider = {
      id: "chat",
      name: "Chat mock",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.chat.test",
      apiKey: "test-key",
      upstreamModelId: "chat-model",
      models: ["chat-model"],
    };
    const input = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: 'Summarize the term "compaction_trigger".' }],
      },
    ];
    let fetchCalled = false;
    const response = await postResponses(
      provider,
      async () => {
        fetchCalled = true;
        return Response.json({
          id: "chatcmpl-summary",
          object: "chat.completion",
          created: 1,
          model: "chat-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "summary" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      },
      input,
    );

    expect(fetchCalled).toBe(true);
    expect(response.status).toBe(200);
  });
});
