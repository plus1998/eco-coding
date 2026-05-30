import { describe, expect, test } from "bun:test";
import {
  buildMessagesUrl,
  buildModelsListUrl,
  buildProviderTestRequestBody,
  parseUpstreamModelsPayload,
  testProviderConnection,
} from "../src/main/provider-models";
import type { ProviderStore } from "../src/main/provider-store";

describe("buildModelsListUrl", () => {
  test("uses origin only and drops anthropic-style path suffix", () => {
    expect(buildModelsListUrl("https://api.deepseek.com/anthropic")).toBe("https://api.deepseek.com/v1/models");
    expect(buildModelsListUrl("https://api.deepseek.com/anthropic/")).toBe("https://api.deepseek.com/v1/models");
  });

  test("works for bare host and local proxy", () => {
    expect(buildModelsListUrl("https://api.deepseek.com")).toBe("https://api.deepseek.com/v1/models");
    expect(buildModelsListUrl("http://127.0.0.1:55302")).toBe("http://127.0.0.1:55302/v1/models");
  });
});

describe("buildMessagesUrl", () => {
  test("preserves anthropic-style path suffix on baseURL", () => {
    expect(buildMessagesUrl("https://api.deepseek.com/anthropic")).toBe(
      "https://api.deepseek.com/anthropic/v1/messages",
    );
  });

  test("works for bare host", () => {
    expect(buildMessagesUrl("https://api.anthropic.com")).toBe("https://api.anthropic.com/v1/messages");
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
      { baseUrl: "https://api.example.com", defaultModel: "claude-sonnet-4-6", apiKey: "bad" },
      fetcher,
    );

    expect(result).toEqual({ ok: false, error: "上游 401：invalid api key" });
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
});
