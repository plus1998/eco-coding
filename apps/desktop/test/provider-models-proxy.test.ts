import { describe, expect, mock, test } from "bun:test";
import { listProviderUpstreamModels, testProviderConnection } from "../src/main/provider-models";
import type { ProviderStore } from "../src/main/provider-store";

interface FakeProxyAgent {
  url: string;
  close(): void;
}

const undiciCalls: Array<{ url: string; dispatcherUrl?: string }> = [];
const closedDispatchers: string[] = [];

mock.module("undici", () => ({
  fetch: async (input: RequestInfo | URL, init?: { dispatcher?: FakeProxyAgent }) => {
    undiciCalls.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      dispatcherUrl: init?.dispatcher?.url,
    });
    if (input.toString().includes("/v1/models")) {
      return new Response(JSON.stringify({ data: [{ id: "model-a" }] }));
    }
    return new Response(
      JSON.stringify({
        type: "message",
        role: "assistant",
        model: "model-a",
        content: [{ type: "text", text: "hi" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200 },
    );
  },
  ProxyAgent: class {
    constructor(public url: string) {}
    close() {
      closedDispatchers.push(this.url);
    }
  },
}));

function providerStore(overrides: Record<string, unknown> = {}): ProviderStore {
  return {
    getProviderWithSecret: () => ({
      id: "p1",
      name: "P1",
      baseUrl: "https://api.example.com",
      requestPath: "",
      version: "v1",
      apiCompat: "anthropic",
      apiKey: "k",
      enabled: true,
      ...overrides,
    }),
  } as unknown as ProviderStore;
}

describe("provider test / model list proxy routing", () => {
  test("no proxy: injected fetcher is used, undici dispatchers are not created", async () => {
    const captured: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      captured.push(input.toString());
      return new Response(
        JSON.stringify({
          type: "message",
          role: "assistant",
          model: "model-a",
          content: [{ type: "text", text: "hi" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    undiciCalls.length = 0;
    const result = await testProviderConnection(
      providerStore(),
      { providerId: "p1", defaultModel: "model-a" },
      fetcher,
    );
    expect(result.ok).toBe(true);
    expect(captured).toEqual(["https://api.example.com/v1/messages"]);
    expect(undiciCalls).toEqual([]);
    expect(closedDispatchers).toEqual([]);
  });

  test("global proxy is used when the provider has none", async () => {
    undiciCalls.length = 0;
    const result = await testProviderConnection(
      providerStore(),
      { providerId: "p1", defaultModel: "model-a" },
      async () => {
        throw new Error("injected fetcher must not be used when a proxy is set");
      },
      undefined,
      "socks5://global.example:1080",
    );
    expect(result.ok).toBe(true);
    expect(undiciCalls.map((call) => call.dispatcherUrl)).toEqual([
      "socks5://global.example:1080",
    ]);
  });

  test("per-provider proxy wins over the global proxy", async () => {
    undiciCalls.length = 0;
    const result = await testProviderConnection(
      providerStore({ upstreamProxyUrl: "socks5://per.example:7890" }),
      { providerId: "p1", defaultModel: "model-a" },
      async () => {
        throw new Error("injected fetcher must not be used when a proxy is set");
      },
      undefined,
      "socks5://global.example:1080",
    );
    expect(result.ok).toBe(true);
    expect(undiciCalls.map((call) => call.dispatcherUrl)).toEqual([
      "socks5://per.example:7890",
    ]);
  });

  test("model listing uses per-provider proxy and closes the dispatcher afterwards", async () => {
    undiciCalls.length = 0;
    closedDispatchers.length = 0;
    const result = await listProviderUpstreamModels(
      providerStore({ upstreamProxyUrl: "socks5://per.example:7890" }),
      { providerId: "p1" },
    );
    expect(result).toEqual({ ok: true, models: [{ id: "model-a" }] });
    expect(undiciCalls.map((call) => call.dispatcherUrl)).toEqual([
      "socks5://per.example:7890",
    ]);
    expect(closedDispatchers).toEqual(["socks5://per.example:7890"]);
  });

  test("inline request proxy is honored without a stored provider", async () => {
    undiciCalls.length = 0;
    const result = await testProviderConnection(
      providerStore({ id: undefined }),
      {
        baseUrl: "https://inline.example.com",
        defaultModel: "model-a",
        upstreamProxyUrl: "socks5://inline.example:7890",
      },
      async () => {
        throw new Error("injected fetcher must not be used when a proxy is set");
      },
    );
    expect(result.ok).toBe(true);
    expect(undiciCalls.map((call) => call.dispatcherUrl)).toEqual([
      "socks5://inline.example:7890",
    ]);
  });
});
