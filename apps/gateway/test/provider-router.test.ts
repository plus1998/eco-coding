import { describe, expect, test } from "bun:test";
import { buildCodexGatewayModelAlias } from "@eco/shared";
import { defaultProviders } from "../src/provider-config.js";
import {
  buildUpstreamCompactUrl,
  buildUpstreamUrl,
  InvalidProviderRouteAliasError,
  ProviderNotFoundError,
  resolveProviderRoute,
} from "../src/provider-router.js";

describe("resolveProviderRoute", () => {
  const providers = defaultProviders();

  test("matches explicit model id and forwards it upstream", () => {
    const route = resolveProviderRoute("claude-sonnet-4-20250514", providers);
    expect(route.provider.id).toBe("anthropic");
    expect(route.upstreamKind).toBe("anthropic-messages");
    expect(route.upstreamModelId).toBe("claude-sonnet-4-20250514");
  });

  test("matches provider-scoped eco alias for duplicate upstream model ids", () => {
    const providers = [
      {
        id: "deepseek-official",
        name: "DeepSeek",
        upstreamKind: "anthropic-messages" as const,
        baseUrl: "https://api.deepseek.com",
        apiKey: "k1",
        upstreamModelId: "deepseek-v4-flash",
        models: ["deepseek-v4-flash", "eco_deepseek-official", "eco_deepseek-official__deepseek-v4-flash"],
      },
      {
        id: "packyapi",
        name: "PackyAPI",
        upstreamKind: "anthropic-messages" as const,
        baseUrl: "https://www.packyapi.com",
        apiKey: "k2",
        upstreamModelId: "deepseek-v4-flash",
        models: ["deepseek-v4-flash", "eco_packyapi", "eco_packyapi__deepseek-v4-flash"],
      },
    ];
    const route = resolveProviderRoute("eco_packyapi__deepseek-v4-flash", providers);
    expect(route.provider.id).toBe("packyapi");
    expect(route.upstreamModelId).toBe("deepseek-v4-flash");
  });

  test("V1 route alias overrides only the request-level upstream API kind", () => {
    const provider = {
      id: "mixed-wire",
      name: "Mixed Wire",
      upstreamKind: "responses" as const,
      baseUrl: "https://api.example.test",
      apiKey: "k",
      upstreamModelId: "default-model",
      models: ["default-model", "eco_mixed-wire"],
    };

    const chatRoute = resolveProviderRoute(
      buildCodexGatewayModelAlias("mixed-wire", "chat/model.__v1", "openai_chat_completions"),
      [provider],
    );
    expect(chatRoute.provider).toBe(provider);
    expect(chatRoute.upstreamKind).toBe("openai-chat");
    expect(chatRoute.upstreamModelId).toBe("chat/model.__v1");

    const anthropicRoute = resolveProviderRoute(
      buildCodexGatewayModelAlias("mixed-wire", "claude-model", "anthropic"),
      [provider],
    );
    expect(anthropicRoute.upstreamKind).toBe("anthropic-messages");

    const responsesRoute = resolveProviderRoute(
      buildCodexGatewayModelAlias("mixed-wire", "responses-model", "openai_responses"),
      [provider],
    );
    expect(responsesRoute.upstreamKind).toBe("responses");
  });

  test("malformed V1 aliases fail closed instead of falling through to explicit models", () => {
    const malformed = "eco_route_v1.bad";
    const defaultProvider = providers[0];
    if (!defaultProvider) {
      throw new Error("Expected a default provider fixture");
    }
    const provider = {
      ...defaultProvider,
      models: [...defaultProvider.models, malformed],
    };
    expect(() => resolveProviderRoute(malformed, [provider])).toThrow(InvalidProviderRouteAliasError);
  });

  test("matches eco_{providerId} alias using provider upstreamModelId", () => {
    const route = resolveProviderRoute("eco_openai", providers);
    expect(route.provider.id).toBe("openai");
    expect(route.upstreamKind).toBe("responses");
    expect(route.upstreamModelId).toBe("gpt-4.1");
  });

  test("forwards explicit non-default model ids without rewriting to upstreamModelId", () => {
    const custom = [
      {
        id: "custom",
        name: "Custom",
        upstreamKind: "openai-chat" as const,
        baseUrl: "http://192.168.110.78:8080",
        apiKey: "local-unused",
        upstreamModelId: "Qwopus3.6-35B-A3B-Coder-MTP-Q5_K_M.gguf",
        models: ["qwen3.6-35b-a3b", "eco_custom", "Qwopus3.6-35B-A3B-Coder-MTP-Q5_K_M.gguf"],
      },
    ];
    const route = resolveProviderRoute("qwen3.6-35b-a3b", custom);
    expect(route.provider.id).toBe("custom");
    expect(route.upstreamModelId).toBe("qwen3.6-35b-a3b");
  });

  test("throws for unknown model", () => {
    expect(() => resolveProviderRoute("unknown-model", providers)).toThrow(ProviderNotFoundError);
  });
});

describe("buildUpstreamUrl", () => {
  const provider = defaultProviders()[0];
  if (!provider) {
    throw new Error("Expected a default provider fixture");
  }

  test("anthropic-messages → /v1/messages", () => {
    expect(buildUpstreamUrl(provider, "anthropic-messages")).toBe("https://api.anthropic.com/v1/messages");
  });

  test("responses → /v1/responses", () => {
    expect(buildUpstreamUrl(provider, "responses")).toBe("https://api.anthropic.com/v1/responses");
  });

  test("appends requestPath before /v1/...", () => {
    const withPath = {
      ...provider,
      baseUrl: "https://api.example.test",
      requestPath: "/zen",
    };
    expect(buildUpstreamUrl(withPath, "anthropic-messages")).toBe(
      "https://api.example.test/zen/v1/messages",
    );
    expect(buildUpstreamUrl(withPath, "openai-chat")).toBe(
      "https://api.example.test/zen/v1/chat/completions",
    );
    expect(buildUpstreamUrl(withPath, "responses")).toBe(
      "https://api.example.test/zen/v1/responses",
    );
  });

  test("normalizes requestPath without leading slash", () => {
    const withPath = {
      ...provider,
      baseUrl: "https://api.example.test/",
      requestPath: "anthropic/",
    };
    expect(buildUpstreamUrl(withPath, "anthropic-messages")).toBe(
      "https://api.example.test/anthropic/v1/messages",
    );
  });

  test("strips messages-only /anthropic for OpenAI upstream kinds", () => {
    const withAnthropicPath = {
      ...provider,
      baseUrl: "https://api.example.test",
      requestPath: "/anthropic",
    };
    expect(buildUpstreamUrl(withAnthropicPath, "anthropic-messages")).toBe(
      "https://api.example.test/anthropic/v1/messages",
    );
    expect(buildUpstreamUrl(withAnthropicPath, "openai-chat")).toBe(
      "https://api.example.test/v1/chat/completions",
    );
    expect(buildUpstreamUrl(withAnthropicPath, "responses")).toBe(
      "https://api.example.test/v1/responses",
    );
  });
});

describe("buildUpstreamCompactUrl", () => {
  test("appends requestPath before /v1/responses/compact", () => {
    const provider = {
      id: "zen",
      name: "Zen",
      upstreamKind: "responses" as const,
      baseUrl: "https://opencode.ai",
      requestPath: "/zen",
      apiKey: "k",
      upstreamModelId: "m",
      models: ["m"],
    };
    expect(buildUpstreamCompactUrl(provider)).toBe(
      "https://opencode.ai/zen/v1/responses/compact",
    );
  });
});
