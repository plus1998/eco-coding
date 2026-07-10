import { expect, test } from "bun:test";
import type { ProviderConfigSecret } from "../src/main/provider-store";
import { countProviderInputTokens } from "../src/main/provider-token-counter";

function provider(overrides: Partial<ProviderConfigSecret> = {}): ProviderConfigSecret {
  return {
    id: "provider_1",
    name: "Provider",
    baseUrl: "https://gateway.test",
    requestPath: "",
    apiCompat: "anthropic",
    tokenCountMode: "local_heuristic",
    defaultModel: "model-1",
    enabled: true,
    hasApiKey: true,
    apiKey: "secret",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const anthropicBody = {
  model: "alias-model",
  system: "You are helpful",
  messages: [{ role: "user", content: "Hello" }],
};

test("local_heuristic reports heuristic precision without network access", async () => {
  let fetched = false;
  const result = await countProviderInputTokens({
    mode: "local_heuristic",
    provider: provider(),
    modelId: "model-1",
    anthropicBody,
    fetcher: async () => {
      fetched = true;
      throw new Error("must not fetch");
    },
  });

  expect(result.tokens).toBeGreaterThan(0);
  expect(result.precision).toBe("heuristic");
  expect(result.source).toBe("eco:local_heuristic");
  expect(fetched).toBe(false);
});

test("anthropic_messages calls the explicit count_tokens endpoint", async () => {
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> | undefined;
  const result = await countProviderInputTokens({
    mode: "anthropic_messages",
    provider: provider({ requestPath: "/anthropic" }),
    modelId: "real-model",
    anthropicBody,
    fetcher: async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ input_tokens: 321 });
    },
  });

  expect(capturedUrl).toBe("https://gateway.test/anthropic/v1/messages/count_tokens");
  expect(capturedBody?.model).toBe("real-model");
  expect(result).toEqual({
    tokens: 321,
    precision: "provider_exact",
    source: "https://gateway.test/anthropic/v1/messages/count_tokens",
  });
});

test("openai_responses converts the Anthropic request before counting", async () => {
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> | undefined;
  const result = await countProviderInputTokens({
    mode: "openai_responses",
    provider: provider({ apiCompat: "openai_responses", requestPath: "/zen" }),
    modelId: "gpt-test",
    anthropicBody,
    fetcher: async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ object: "response.input_tokens", input_tokens: 456 });
    },
  });

  expect(capturedUrl).toBe("https://gateway.test/zen/v1/responses/input_tokens");
  expect(capturedBody?.model).toBe("gpt-test");
  expect(capturedBody?.input).toBeDefined();
  expect(capturedBody).not.toHaveProperty("messages");
  expect(result.precision).toBe("provider_exact");
  expect(result.tokens).toBe(456);
});

test("llama_tokenize applies the chat template before tokenization", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const result = await countProviderInputTokens({
    mode: "llama_tokenize",
    provider: provider({ apiCompat: "openai_chat_completions" }),
    modelId: "llama-model",
    anthropicBody,
    fetcher: async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url, body });
      if (url.endsWith("/apply-template")) {
        return Response.json({ prompt: "<s>[INST] Hello [/INST]" });
      }
      return Response.json({ tokens: [1, 2, 3, 4, 5] });
    },
  });

  expect(calls.map((call) => call.url)).toEqual([
    "https://gateway.test/apply-template",
    "https://gateway.test/tokenize",
  ]);
  expect(calls[0]?.body.messages).toBeArray();
  expect(calls[1]?.body).toMatchObject({
    content: "<s>[INST] Hello [/INST]",
    add_special: false,
    parse_special: true,
  });
  expect(result).toEqual({
    tokens: 5,
    precision: "tokenizer_exact",
    source: "https://gateway.test/apply-template -> https://gateway.test/tokenize",
  });
});

test("explicit provider counting failure is not replaced by a heuristic", async () => {
  let calls = 0;
  await expect(
    countProviderInputTokens({
      mode: "anthropic_messages",
      provider: provider(),
      modelId: "model-1",
      anthropicBody,
      fetcher: async () => {
        calls += 1;
        return new Response("unsupported endpoint", { status: 404 });
      },
    }),
  ).rejects.toThrow("HTTP 404；unsupported endpoint");
  expect(calls).toBe(1);
});

test("llama_tokenize rejects tool requests rather than silently undercounting", async () => {
  let fetched = false;
  await expect(
    countProviderInputTokens({
      mode: "llama_tokenize",
      provider: provider({ apiCompat: "openai_chat_completions" }),
      modelId: "llama-model",
      anthropicBody: {
        ...anthropicBody,
        tools: [
          {
            name: "Read",
            description: "Read a file",
            input_schema: { type: "object", properties: {} },
          },
        ],
      },
      fetcher: async () => {
        fetched = true;
        throw new Error("must not fetch");
      },
    }),
  ).rejects.toThrow("无法从 /apply-template 文档化接口精确计入 tools");
  expect(fetched).toBe(false);
});

test("invalid token count mode is rejected instead of normalized to local heuristic", async () => {
  const { normalizeProviderTokenCountMode } = await import("../src/shared/provider-token-count");
  expect(() => normalizeProviderTokenCountMode("invented_mode")).toThrow("无效的 Provider token 计数模式");
});

test("provider token counter rejects an invalid runtime mode instead of treating it as llama_tokenize", async () => {
  let fetched = false;
  await expect(
    countProviderInputTokens({
      mode: "invented_mode" as never,
      provider: provider(),
      modelId: "model-1",
      anthropicBody,
      fetcher: async () => {
        fetched = true;
        throw new Error("must not fetch");
      },
    }),
  ).rejects.toThrow("无效的 Provider token 计数模式");
  expect(fetched).toBe(false);
});

test("Anthropic proxy uses the provider's explicit token count adapter", async () => {
  const { startAnthropicModelProxy } = await import("../src/main/anthropic-proxy");
  const upstreamRequests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const upstream = Bun.serve({
    port: 0,
    fetch: async (request) => {
      upstreamRequests.push({
        path: new URL(request.url).pathname,
        body: (await request.json()) as Record<string, unknown>,
      });
      return Response.json({ input_tokens: 777 });
    },
  });
  const proxy = await startAnthropicModelProxy([
    {
      role: "planner",
      provider: provider({
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        tokenCountMode: "anthropic_messages",
      }),
      modelId: "real-model",
    },
  ]);

  try {
    const response = await fetch(`${proxy.baseUrl}/v1/messages/count_tokens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: proxy.routes[0]?.aliasModelId,
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ input_tokens: 777 });
    expect(upstreamRequests).toEqual([
      {
        path: "/v1/messages/count_tokens",
        body: { model: "real-model", messages: [{ role: "user", content: "hello" }] },
      },
    ]);
  } finally {
    await proxy.close();
    upstream.stop(true);
  }
});
