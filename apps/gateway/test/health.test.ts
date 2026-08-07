import { describe, expect, test } from "bun:test";
import { createTestGatewayFetchHandler } from "./test-bridge-rewrite.js";
import type { GatewayConfig, GatewayProvider } from "../src/types.js";

function testConfig(providers: GatewayProvider[]): GatewayConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    providers,
  };
}

describe("GET /health", () => {
  test("returns ok and provider summary", async () => {
    const provider: GatewayProvider = {
      id: "anthropic",
      name: "Anthropic",
      upstreamKind: "anthropic-messages",
      baseUrl: "https://api.anthropic.com",
      apiKey: "test",
      upstreamModelId: "claude-sonnet-4-20250514",
      models: ["claude-sonnet-4-20250514"],
    };
    const handler = createTestGatewayFetchHandler(testConfig([provider]));
    const response = await handler(new Request("http://127.0.0.1/health"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      service: string;
      providers: Array<{ id: string; upstreamKind: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("eco-gateway");
    expect(body.providers).toHaveLength(1);
    expect(body.providers[0]?.upstreamKind).toBe("anthropic-messages");
  });
});

describe("startEcoGateway (node http)", () => {
  test("listens and serves /health in-process", async () => {
    const { startEcoGateway } = await import("../src/server.js");
    const server = await startEcoGateway({
      host: "127.0.0.1",
      port: 0,
      providers: [
        {
          id: "custom",
          name: "Custom",
          upstreamKind: "openai-chat",
          baseUrl: "http://192.168.110.78:8080",
          apiKey: "local-unused",
          upstreamModelId: "qwen3.6-35b-a3b",
          models: ["qwen3.6-35b-a3b", "eco_custom"],
        },
      ],
    });
    try {
      expect(server.port).toBeGreaterThan(0);
      const response = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { ok: boolean; providers: Array<{ id: string }> };
      expect(body.ok).toBe(true);
      expect(body.providers[0]?.id).toBe("custom");

      server.setProviders([
        {
          id: "custom",
          name: "Custom",
          upstreamKind: "openai-chat",
          baseUrl: "http://192.168.110.78:8080",
          apiKey: "local-unused",
          upstreamModelId: "qwen3.6-35b-a3b",
          models: ["qwen3.6-35b-a3b", "eco_custom", "extra-model"],
        },
      ]);
      expect(server.getProviders()[0]?.models).toContain("extra-model");
    } finally {
      server.stop();
    }
  });
});

describe("PUT /v1/providers", () => {
  test("replaces provider table so new models route", async () => {
    const config = testConfig([
      {
        id: "anthropic",
        name: "Anthropic",
        upstreamKind: "anthropic-messages",
        baseUrl: "https://api.anthropic.com",
        apiKey: "test",
        upstreamModelId: "claude-sonnet-4-20250514",
        models: ["claude-sonnet-4-20250514"],
      },
    ]);
    const handler = createTestGatewayFetchHandler(config);
    const response = await handler(
      new Request("http://127.0.0.1/v1/providers", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          {
            id: "custom",
            name: "Local Llama",
            upstreamKind: "openai-chat",
            baseUrl: "http://192.168.110.78:8080",
            apiKey: "local-unused",
            upstreamModelId: "qwen3.6-35b-a3b",
            models: ["qwen3.6-35b-a3b", "eco_custom"],
          },
        ]),
      }),
    );
    expect(response.status).toBe(200);
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0]?.models).toContain("qwen3.6-35b-a3b");
  });
});
