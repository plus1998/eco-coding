import { describe, expect, test } from "bun:test";
import { createGatewayFetchHandler } from "../src/server.js";
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
  const handler = createGatewayFetchHandler(
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
  const handler = createGatewayFetchHandler(
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

describe("POST /v1/responses/compact", () => {
  test("openai-chat providers explicitly reject Responses compact", async () => {
    const provider: GatewayProvider = {
      id: "llama-local",
      name: "Llama mock",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.llama.test",
      apiKey: "local-unused",
      upstreamModelId: "Qwopus.gguf",
      models: ["llama-local"],
    };
    let fetchCalled = false;
    const response = await postCompact(provider, async () => {
      fetchCalled = true;
      return Response.json({});
    });

    expect(fetchCalled).toBe(false);
    expect(response.status).toBe(501);
    const json = (await response.json()) as { error: { type: string; message: string } };
    expect(json.error.type).toBe("unsupported_error");
    expect(json.error.message).toContain("does not support");
  });

  test("responses providers preserve an upstream compact 404 as failure", async () => {
    const response = await postCompact(
      responsesProvider(),
      async () => new Response("not found", { status: 404 }),
    );

    expect(response.status).toBe(404);
    const json = (await response.json()) as { error: { type: string; message: string } };
    expect(json.error.type).toBe("upstream_error");
    expect(json.error.message).toContain("not found");
    expect(json.error.message).toContain("provider openai");
  });

  test("responses providers report compact network failures as 502", async () => {
    const response = await postCompact(responsesProvider(), async () => {
      throw new Error("connection refused");
    });

    expect(response.status).toBe(502);
    const json = (await response.json()) as { error: { type: string; message: string } };
    expect(json.error.type).toBe("upstream_error");
    expect(json.error.message).toContain("connection refused");
  });

  for (const [name, responseFactory, expectedMessage] of [
    ["empty body", () => new Response("", { status: 200 }), "empty compact response body"],
    ["invalid JSON", () => new Response("not-json", { status: 200 }), "not valid JSON"],
    ["empty output", () => Response.json({ id: "resp_empty", output: [] }), "output is missing or empty"],
    [
      "no compaction item",
      () => Response.json({ output: [{ type: "message", role: "assistant", content: [] }] }),
      "exactly one compaction item",
    ],
    [
      "multiple compaction items",
      () =>
        Response.json({
          output: [
            { type: "compaction", encrypted_content: "opaque-1" },
            { type: "compaction", encrypted_content: "opaque-2" },
          ],
        }),
      "exactly one compaction item",
    ],
    [
      "missing encrypted content",
      () => Response.json({ output: [{ type: "compaction" }] }),
      "encrypted_content is missing or empty",
    ],
    [
      "blank encrypted content",
      () => Response.json({ output: [{ type: "compaction", encrypted_content: "   " }] }),
      "encrypted_content is missing or empty",
    ],
  ] as const) {
    test(`responses providers reject a 200 compact response with ${name}`, async () => {
      const response = await postCompact(responsesProvider(), async () => responseFactory());

      expect(response.status).toBe(502);
      const json = (await response.json()) as { error: { type: string; message: string } };
      expect(json.error.type).toBe("upstream_error");
      expect(json.error.message).toContain(expectedMessage);
    });
  }

  test("responses providers pass through a valid compact response", async () => {
    const response = await postCompact(
      responsesProvider(),
      async (input, init) => {
        expect(String(input)).toBe("http://mock.openai.test/v1/responses/compact");
        const body = JSON.parse(String(init?.body)) as { model: string };
        expect(body.model).toBe("gpt-5.4");
        return Response.json({
          id: "resp_compact_1",
          object: "response.compaction",
          output: [
            { type: "message", role: "user", content: [{ type: "input_text", text: "retained" }] },
            { type: "compaction", id: "cmp_1", encrypted_content: "opaque" },
          ],
        });
      },
      "eco_openai",
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as { id: string; output: Array<{ type: string }> };
    expect(json.id).toBe("resp_compact_1");
    expect(json.output).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "retained" }] },
      { type: "compaction", id: "cmp_1", encrypted_content: "opaque" },
    ]);
  });

  test("valid compaction metadata emits exactly one normalized usage event", async () => {
    const usageEvents: GatewayUsageEvent[] = [];
    const response = await postCompact(
      responsesProvider(),
      async () =>
        Response.json(
          {
            id: "resp_compact_usage",
            object: "response.compaction",
            model: "gpt-5.4",
            output: [{ type: "compaction", encrypted_content: "opaque" }],
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              total_tokens: 120,
              input_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 },
            },
          },
          { headers: { "x-request-id": "req_compact_usage" } },
        ),
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

    expect(response.status).toBe(200);
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      source: "responses",
      sourceEventId: "responses:openai:response:resp_compact_usage",
      providerId: "openai",
      requestedModel: "eco_openai",
      upstreamModelId: "gpt-5.4",
      stream: false,
      responseId: "resp_compact_usage",
      providerRequestId: "req_compact_usage",
      codexTurnMetadata: {
        threadId: "codex_root",
        turnId: "turn_compact",
        requestKind: "compaction",
      },
      usage: {
        inputTokens: 50,
        outputTokens: 20,
        cacheReadTokens: 40,
        cacheCreationTokens: 10,
        modelId: "gpt-5.4",
      },
    });
  });

  test("missing, malformed, or non-compaction metadata emits no compact usage event", async () => {
    const usageEvents: GatewayUsageEvent[] = [];
    const metadataHeaders = [
      undefined,
      "not-json",
      JSON.stringify({ thread_id: "codex_root", request_kind: "compaction" }),
      JSON.stringify({
        thread_id: "codex_root",
        turn_id: "turn_wrong_kind",
        request_kind: "turn",
      }),
    ];

    for (const codexTurnMetadataHeader of metadataHeaders) {
      const response = await postCompact(
        responsesProvider(),
        async () =>
          Response.json({
            id: "resp_unattributed_compact",
            output: [{ type: "compaction", encrypted_content: "opaque" }],
            usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
          }),
        "openai-alias",
        {
          ...(codexTurnMetadataHeader !== undefined && { codexTurnMetadataHeader }),
          onUsage: (event) => {
            usageEvents.push(event);
          },
        },
      );
      expect(response.status).toBe(200);
    }

    expect(usageEvents).toEqual([]);
  });

  test("anthropic-messages providers explicitly reject Responses compact", async () => {
    const provider: GatewayProvider = {
      id: "anthropic",
      name: "Anthropic",
      upstreamKind: "anthropic-messages",
      baseUrl: "http://mock.anthropic.test",
      apiKey: "sk-ant-test",
      upstreamModelId: "claude-opus-4-6",
      models: ["claude-opus"],
    };
    let fetchCalled = false;
    const response = await postCompact(provider, async () => {
      fetchCalled = true;
      return Response.json({});
    });

    expect(fetchCalled).toBe(false);
    expect(response.status).toBe(501);
    const json = (await response.json()) as { error: { type: string; message: string } };
    expect(json.error.type).toBe("unsupported_error");
    expect(json.error.message).toContain("does not support");
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
