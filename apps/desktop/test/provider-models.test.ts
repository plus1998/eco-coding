import { describe, expect, test } from "bun:test";
import { normalizeUpstreamApiCompat } from "../src/shared/api-compat";
import {
  buildChatCompletionsUrl,
  buildMessagesUrl,
  buildOpenAICompatUpstreamUrl,
  buildResponsesInputTokensUrl,
  buildModelsListUrl,
  buildProviderRequestBaseUrl,
  buildProviderTestRequestBody,
  describeProviderCompatRouting,
  normalizeRequestPath,
  parseUpstreamModelsPayload,
  resolveModelsListUrl,
  splitBaseUrlAndRequestPath,
  buildRouteTestDedupeKey,
  testProviderConnection,
  testRoleRoutes,
} from "../src/main/provider-models";
import type { ProviderStore } from "../src/main/provider-store";

describe("splitBaseUrlAndRequestPath", () => {
  test("splits legacy baseURL with path suffix", () => {
    expect(splitBaseUrlAndRequestPath("https://api.deepseek.com/anthropic")).toEqual({
      baseUrl: "https://api.deepseek.com",
      requestPath: "/anthropic",
    });
  });

  test("leaves bare origin unchanged", () => {
    expect(splitBaseUrlAndRequestPath("https://api.anthropic.com")).toEqual({
      baseUrl: "https://api.anthropic.com",
      requestPath: "",
    });
  });
});

describe("buildProviderRequestBaseUrl", () => {
  test("combines baseURL and request path", () => {
    expect(buildProviderRequestBaseUrl("https://api.deepseek.com", "/anthropic")).toBe(
      "https://api.deepseek.com/anthropic",
    );
  });

  test("normalizes request path without leading slash", () => {
    expect(buildProviderRequestBaseUrl("https://api.deepseek.com", "anthropic")).toBe(
      "https://api.deepseek.com/anthropic",
    );
  });
});

describe("buildModelsListUrl", () => {
  test("uses bare baseURL", () => {
    expect(buildModelsListUrl("https://api.deepseek.com")).toBe("https://api.deepseek.com/v1/models");
    expect(buildModelsListUrl("http://127.0.0.1:55302")).toBe("http://127.0.0.1:55302/v1/models");
  });

  test("ignores messages-only request path (DeepSeek /anthropic)", () => {
    expect(buildModelsListUrl("https://api.deepseek.com", "/anthropic")).toBe(
      "https://api.deepseek.com/v1/models",
    );
    expect(buildModelsListUrl("https://api.deepseek.com/anthropic")).toBe("https://api.deepseek.com/v1/models");
  });

  test("includes service path prefix (OpenCode Zen)", () => {
    expect(buildModelsListUrl("https://opencode.ai/zen")).toBe("https://opencode.ai/zen/v1/models");
    expect(buildModelsListUrl("https://opencode.ai", "/zen")).toBe("https://opencode.ai/zen/v1/models");
  });

  test("strips OpenAI-compat endpoint suffixes from baseURL", () => {
    expect(buildModelsListUrl("https://api.example.com/v1/chat/completions")).toBe(
      "https://api.example.com/v1/models",
    );
    expect(buildModelsListUrl("https://api.example.com", "/v1/responses")).toBe(
      "https://api.example.com/v1/models",
    );
  });

  test("returns undefined when baseURL is empty", () => {
    expect(buildModelsListUrl("")).toBeUndefined();
    expect(buildModelsListUrl("  ")).toBeUndefined();
  });
});

describe("resolveModelsListUrl", () => {
  test("rejects empty base with clear error", () => {
    const result = resolveModelsListUrl("", "/anthropic");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("baseURL");
    }
  });
});

describe("describeProviderCompatRouting", () => {
  test("documents OpenAI Responses path when apiCompat is openai_responses", () => {
    const routing = describeProviderCompatRouting(
      "https://api.deepseek.com",
      "/anthropic",
      "openai_responses",
    );
    expect(routing.apiCompat).toBe("openai_responses");
    expect(routing.chatApi).toBe("openai-v1-responses");
    expect(routing.chatUrl).toBe("https://api.deepseek.com/v1/responses");
  });

  test("documents OpenAI Chat Completions path", () => {
    const routing = describeProviderCompatRouting(
      "https://api.deepseek.com",
      "",
      "openai_chat_completions",
    );
    expect(routing.chatApi).toBe("openai-v1-chat-completions");
    expect(routing.chatUrl).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  test("normalizes legacy openai apiCompat to openai_responses", () => {
    expect(normalizeUpstreamApiCompat("openai")).toBe("openai_responses");
  });

  test("buildOpenAICompatUpstreamUrl prefers /v1/responses", () => {
    expect(buildOpenAICompatUpstreamUrl("https://api.example.com", "/zen")).toBe(
      "https://api.example.com/zen/v1/responses",
    );
  });

  test("buildResponsesInputTokensUrl targets /v1/responses/input_tokens", () => {
    expect(buildResponsesInputTokensUrl("https://api.example.com", "/zen")).toBe(
      "https://api.example.com/zen/v1/responses/input_tokens",
    );
    expect(buildResponsesInputTokensUrl("https://api.deepseek.com", "/anthropic")).toBe(
      "https://api.deepseek.com/v1/responses/input_tokens",
    );
  });

  test("buildChatCompletionsUrl targets /v1/chat/completions", () => {
    expect(buildChatCompletionsUrl("https://api.example.com", "/zen")).toBe(
      "https://api.example.com/zen/v1/chat/completions",
    );
  });

  test("documents Anthropic messages path vs OpenAI models list", () => {
    const routing = describeProviderCompatRouting("https://api.deepseek.com", "/anthropic");
    expect(routing.modelsDiscoveryApi).toBe("openai-get-v1-models");
    expect(routing.chatApi).toBe("anthropic-v1-messages");
    expect(routing.modelsListUrl).toBe("https://api.deepseek.com/v1/models");
    expect(routing.chatUrl).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect(routing.compatNotes.some((n) => n.includes("OpenAI"))).toBe(true);
    expect(routing.compatNotes.some((n) => n.includes("Anthropic"))).toBe(true);
  });
});

describe("buildMessagesUrl", () => {
  test("appends request path before /v1/messages", () => {
    expect(buildMessagesUrl("https://api.deepseek.com", "/anthropic")).toBe(
      "https://api.deepseek.com/anthropic/v1/messages",
    );
  });

  test("works for bare host", () => {
    expect(buildMessagesUrl("https://api.anthropic.com")).toBe("https://api.anthropic.com/v1/messages");
  });

  test("supports legacy combined baseURL", () => {
    expect(buildMessagesUrl("https://api.deepseek.com/anthropic")).toBe(
      "https://api.deepseek.com/anthropic/v1/messages",
    );
  });
});

describe("normalizeRequestPath", () => {
  test("adds leading slash and trims trailing slash", () => {
    expect(normalizeRequestPath("anthropic/")).toBe("/anthropic");
  });
});

describe("parseUpstreamModelsPayload", () => {
  test("parses Anthropic-style models list", () => {
    const models = parseUpstreamModelsPayload({
      data: [
        { id: "claude-opus-4-7", display_name: "Opus 4.7", type: "model" },
        { id: "claude-sonnet-4-6", display_name: "Sonnet 4.6", type: "model" },
      ],
    });
    expect(models).toEqual([
      { id: "claude-opus-4-7", displayName: "Opus 4.7" },
      { id: "claude-sonnet-4-6", displayName: "Sonnet 4.6" },
    ]);
  });

  test("parses OpenAI-style models list", () => {
    const models = parseUpstreamModelsPayload({
      data: [{ id: "gpt-4o", object: "model" }],
    });
    expect(models).toEqual([{ id: "gpt-4o", displayName: undefined }]);
  });

  test("parses Ollama native tags list", () => {
    const models = parseUpstreamModelsPayload({
      models: [{ name: "qwen2.5-coder:7b", model: "qwen2.5-coder:7b" }],
    });
    expect(models).toEqual([{ id: "qwen2.5-coder:7b", displayName: "qwen2.5-coder:7b" }]);
  });
});

describe("buildProviderTestRequestBody", () => {
  test("disables thinking and allows enough tokens for a short reply", () => {
    expect(buildProviderTestRequestBody("qwen3")).toEqual({
      model: "qwen3",
      max_tokens: 256,
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "disabled" },
    });
  });
});

describe("testProviderConnection", () => {
  test("requires default model", async () => {
    const store = { getProviderWithSecret: () => undefined } as unknown as ProviderStore;
    const result = await testProviderConnection(store, {
      baseUrl: "https://api.example.com",
      defaultModel: "  ",
    });
    expect(result).toEqual({ ok: false, error: "请先选择默认模型。" });
  });

  test("returns upstream error details", async () => {
    const store = { getProviderWithSecret: () => undefined } as unknown as ProviderStore;
    const fetcher = async () =>
      new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 });

    const result = await testProviderConnection(
      store,
      {
        baseUrl: "https://api.example.com",
        requestPath: "",
        defaultModel: "claude-sonnet-4-6",
        apiKey: "bad",
      },
      fetcher,
    );

    expect(result).toEqual({ ok: false, error: "上游 401：invalid api key" });
  });

  test("uses request path for messages endpoint", async () => {
    const store = { getProviderWithSecret: () => undefined } as unknown as ProviderStore;
    const fetcher = async (url: string) => {
      expect(url).toBe("https://api.deepseek.com/anthropic/v1/messages");
      return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 });
    };

    const result = await testProviderConnection(
      store,
      {
        baseUrl: "https://api.deepseek.com",
        requestPath: "/anthropic",
        defaultModel: "deepseek-chat",
      },
      fetcher,
    );

    expect(result).toEqual({ ok: true, reply: "ok" });
  });

  test("succeeds when assistant text is returned", async () => {
    const store = { getProviderWithSecret: () => undefined } as unknown as ProviderStore;
    const fetcher = async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.example.com/v1/messages");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "claude-sonnet-4-6",
        max_tokens: 256,
        messages: [{ role: "user", content: "hi" }],
        thinking: { type: "disabled" },
      });
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "Hello! How can I help?" }] }),
        { status: 200 },
      );
    };

    const result = await testProviderConnection(
      store,
      { baseUrl: "https://api.example.com", defaultModel: "claude-sonnet-4-6" },
      fetcher,
    );

    expect(result).toEqual({ ok: true, reply: "Hello! How can I help?" });
  });

  test("accepts thinking-only replies when text is absent", async () => {
    const store = { getProviderWithSecret: () => undefined } as unknown as ProviderStore;
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "thinking", thinking: "The user said hi." }],
        }),
        { status: 200 },
      );

    const result = await testProviderConnection(
      store,
      { baseUrl: "https://api.example.com", defaultModel: "qwen3" },
      fetcher,
    );

    expect(result).toEqual({ ok: true, reply: "The user said hi." });
  });

  test("accepts OpenAI chat completions replies without anthropic conversion loss", async () => {
    const store = { getProviderWithSecret: () => undefined } as unknown as ProviderStore;
    const fetcher = async (url: string) => {
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      return new Response(
        JSON.stringify({
          id: "gen-test",
          object: "chat.completion",
          model: "xiaomi/mimo-v2.5-20260422",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "Hi there! How can I help you today?",
                reasoning: "The user said hi.",
              },
            },
          ],
          usage: {
            prompt_tokens: 250,
            completion_tokens: 141,
            total_tokens: 391,
            prompt_tokens_details: { cached_tokens: 192 },
          },
        }),
        { status: 200 },
      );
    };

    const result = await testProviderConnection(
      store,
      {
        baseUrl: "https://openrouter.ai/api",
        apiCompat: "openai_chat_completions",
        defaultModel: "xiaomi/mimo-v2.5-20260422",
      },
      fetcher,
    );

    expect(result).toEqual({ ok: true, reply: "Hi there! How can I help you today?" });
  });

  test("falls back to reasoning text for reasoning-only chat completions replies", async () => {
    const store = { getProviderWithSecret: () => undefined } as unknown as ProviderStore;
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          id: "gen-test",
          object: "chat.completion",
          model: "xiaomi/mimo-v2.5-20260422",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "",
                reasoning: "Hi there! How can I help you today?",
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200 },
      );

    const result = await testProviderConnection(
      store,
      {
        baseUrl: "https://openrouter.ai/api",
        apiCompat: "openai_chat_completions",
        defaultModel: "xiaomi/mimo-v2.5-20260422",
      },
      fetcher,
    );

    expect(result).toEqual({ ok: true, reply: "Hi there! How can I help you today?" });
  });
});

describe("buildRouteTestDedupeKey", () => {
  test("combines provider id and model id", () => {
    expect(buildRouteTestDedupeKey("p1", "claude-sonnet", "anthropic")).toBe("p1:claude-sonnet:anthropic");
    expect(buildRouteTestDedupeKey(" p1 ", " claude-sonnet ", "openai_responses")).toBe(
      "p1:claude-sonnet:openai_responses",
    );
  });
});

describe("testRoleRoutes", () => {
  test("dedupes identical provider and model to a single upstream call", async () => {
    const store = {
      getProviderWithSecret: (id: string) =>
        id === "p1"
          ? {
              id: "p1",
              name: "Test",
              baseUrl: "https://api.example.com",
              requestPath: "",
              apiCompat: "anthropic",
              apiKey: "key",
              enabled: true,
            }
          : undefined,
    } as unknown as ProviderStore;

    let callCount = 0;
    const fetcher = async () => {
      callCount += 1;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 });
    };

    const result = await testRoleRoutes(
      store,
      {
        routes: [
          { role: "planner", providerId: "p1", modelId: "shared-model" },
          { role: "explore", providerId: "p1", modelId: "shared-model" },
          { role: "coder", providerId: "p1", modelId: "shared-model" },
          { role: "reviewer", providerId: "p1", modelId: "other-model" },
        ],
      },
      fetcher,
    );

    expect(callCount).toBe(2);
    expect(result.passed).toBe(4);
    expect(result.results.every((entry) => entry.ok)).toBe(true);
    expect(result.results.map((entry) => entry.modelId)).toEqual([
      "shared-model",
      "shared-model",
      "shared-model",
      "other-model",
    ]);
  });

  test("tests each configured role against /v1/messages", async () => {
    const store = {
      getProviderWithSecret: (id: string) =>
        id === "p1"
          ? {
              id: "p1",
              name: "Test",
              baseUrl: "https://api.example.com",
              requestPath: "",
              apiCompat: "anthropic",
              apiKey: "key",
              enabled: true,
            }
          : undefined,
    } as unknown as ProviderStore;

    let callCount = 0;
    const fetcher = async () => {
      callCount += 1;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 });
    };

    const result = await testRoleRoutes(
      store,
      {
        routes: [
          { role: "planner", providerId: "p1", modelId: "model-a" },
          { role: "coder", providerId: "p1", modelId: "model-b", thinkingEffort: "low" },
        ],
      },
      fetcher,
    );

    expect(callCount).toBe(2);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results.map((entry) => entry.ok)).toEqual([true, true]);
  });
});
