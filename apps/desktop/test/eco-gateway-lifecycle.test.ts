import { describe, expect, test } from "bun:test";
import { buildGatewayProvidersFromEcoProviders } from "../src/main/eco-gateway-lifecycle";

describe("eco gateway provider model limits", () => {
  test("preserves candidate max output tokens by upstream model id", () => {
    const result = buildGatewayProvidersFromEcoProviders([
      {
        id: "deepseek",
        name: "DeepSeek",
        enabled: true,
        baseUrl: "https://api.example.test/v1",
        apiKey: "secret",
        apiCompat: "openai_chat_completions",
        defaultModel: "deepseek-v4-flash",
        models: [
          { modelId: "deepseek-v4-flash", maxOutputTokens: 384_000 },
          { modelId: "deepseek-v4-pro", maxOutputTokens: 128_000 },
        ],
        modelIds: ["route-only-model"],
      },
    ]);

    expect(result.providers[0]).toMatchObject({
      baseUrl: "https://api.example.test",
      models: expect.arrayContaining([
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "route-only-model",
      ]),
      modelMaxOutputTokens: {
        "deepseek-v4-flash": 384_000,
        "deepseek-v4-pro": 128_000,
      },
    });
  });

  test("forwards requestPath into gateway provider payload", () => {
    const result = buildGatewayProvidersFromEcoProviders([
      {
        id: "opencode",
        name: "OpenCode Zen",
        enabled: true,
        baseUrl: "https://opencode.ai/v1",
        requestPath: "zen/",
        apiKey: "secret",
        apiCompat: "openai_responses",
        defaultModel: "claude-sonnet-4",
      },
    ]);

    expect(result.providers[0]).toMatchObject({
      baseUrl: "https://opencode.ai",
      requestPath: "/zen",
    });
  });

  test("omits empty requestPath from gateway payload", () => {
    const result = buildGatewayProvidersFromEcoProviders([
      {
        id: "plain",
        name: "Plain",
        enabled: true,
        baseUrl: "https://api.example.test",
        requestPath: "  ",
        apiKey: "secret",
        apiCompat: "anthropic",
        defaultModel: "claude-sonnet-4",
      },
    ]);

    expect(result.providers[0]?.requestPath).toBeUndefined();
  });
});
