import { expect, test } from "bun:test";
import {
  type AnthropicProxyResolvedRoute,
  buildModelsListResponse,
  canonicalModelFamilyIds,
  createModelAlias,
  createStreamingUsageTracker,
  extractUsageFromResponseBody,
  estimateInputTokensFromAnthropicBody,
  injectImagesIntoMessagesBody,
  normalizeThinkingEffortFields,
  resolveProxyRoute,
} from "../src/main/anthropic-proxy";
import type { ProviderConfigSecret } from "../src/main/provider-store";

test("resolves provider routes by local model alias", () => {
  const provider = createProvider("qwen", "Qwen Anthropic", "provider-secret");
  const route: AnthropicProxyResolvedRoute = {
    role: "coder",
    provider,
    modelId: "qwen-coder",
    apiCompat: "anthropic",
    aliasModelId: createModelAlias("coder", provider.id, "qwen-coder"),
  };

  expect(resolveProxyRoute([route], route.aliasModelId)).toEqual(route);
  expect(resolveProxyRoute([route], "qwen-coder")).toEqual(route);
  expect(resolveProxyRoute([route], "missing-model")).toBeUndefined();
});

test("canonicalModelFamilyIds derives gpt-5.4 from gpt-5.4-mini", () => {
  expect(canonicalModelFamilyIds("gpt-5.4-mini")).toEqual(["gpt-5.4"]);
  expect(canonicalModelFamilyIds("claude-sonnet-4-6")).toEqual([]);
});

test("resolveProxyRoute maps canonical gpt-5.4 to unique gpt-5.4-mini explore route", () => {
  const provider = createProvider("openai", "OpenAI", "provider-secret");
  const exploreRoute: AnthropicProxyResolvedRoute = {
    role: "explore",
    provider,
    modelId: "gpt-5.4-mini",
    apiCompat: "anthropic",
    aliasModelId: createModelAlias("explore", provider.id, "gpt-5.4-mini"),
  };
  const plannerRoute: AnthropicProxyResolvedRoute = {
    role: "planner",
    provider,
    modelId: "gpt-5.5",
    apiCompat: "anthropic",
    aliasModelId: createModelAlias("planner", provider.id, "gpt-5.5"),
  };
  expect(resolveProxyRoute([exploreRoute, plannerRoute], "gpt-5.4")).toEqual(exploreRoute);
  expect(resolveProxyRoute([exploreRoute, plannerRoute], "gpt-5.4-mini")).toEqual(exploreRoute);
});

test("resolveProxyRoute does not guess when multiple routes share a family prefix", () => {
  const provider = createProvider("openai", "OpenAI", "provider-secret");
  const routes: AnthropicProxyResolvedRoute[] = [
    {
      role: "explore",
      provider,
      modelId: "gpt-5.4-mini",
      apiCompat: "anthropic",
      aliasModelId: createModelAlias("explore", provider.id, "gpt-5.4-mini"),
    },
    {
      role: "coder",
      provider,
      modelId: "gpt-5.4-turbo",
      apiCompat: "anthropic",
      aliasModelId: createModelAlias("coder", provider.id, "gpt-5.4-turbo"),
    },
  ];
  expect(resolveProxyRoute(routes, "gpt-5.4")).toBeUndefined();
});

test("resolveProxyRoute maps canonical gpt-5.4 to explore when roles share gpt-5.4-mini", () => {
  const provider = createProvider("openai", "OpenAI", "provider-secret");
  const exploreRoute: AnthropicProxyResolvedRoute = {
    role: "explore",
    provider,
    modelId: "gpt-5.4-mini",
    apiCompat: "anthropic",
    aliasModelId: createModelAlias("explore", provider.id, "gpt-5.4-mini"),
  };
  const coderRoute: AnthropicProxyResolvedRoute = {
    role: "coder",
    provider,
    modelId: "gpt-5.4-mini",
    apiCompat: "anthropic",
    aliasModelId: createModelAlias("coder", provider.id, "gpt-5.4-mini"),
  };
  const testerRoute: AnthropicProxyResolvedRoute = {
    role: "tester",
    provider,
    modelId: "gpt-5.4-mini",
    apiCompat: "anthropic",
    aliasModelId: createModelAlias("tester", provider.id, "gpt-5.4-mini"),
  };
  const routes = [coderRoute, exploreRoute, testerRoute];
  expect(resolveProxyRoute(routes, "gpt-5.4")).toEqual(exploreRoute);
  expect(resolveProxyRoute(routes, "gpt-5.4-mini")).toEqual(exploreRoute);
});

test("buildModelsListResponse lists only eco alias ids for SDK discovery", () => {
  const provider = createProvider("openai", "OpenAI", "provider-secret");
  const route: AnthropicProxyResolvedRoute = {
    role: "explore",
    provider,
    modelId: "gpt-5.4-mini",
    apiCompat: "anthropic",
    aliasModelId: createModelAlias("explore", provider.id, "gpt-5.4-mini"),
  };
  const ids = buildModelsListResponse([route]).data.map((entry) => entry.id);
  expect(ids).toEqual([route.aliasModelId]);
  expect(ids).not.toContain("gpt-5.4-mini");
  expect(ids).not.toContain("gpt-5.4");
});

test("buildModelsListResponse lists one alias per configured route", () => {
  const provider = createProvider("openai", "OpenAI", "provider-secret");
  const exploreRoute: AnthropicProxyResolvedRoute = {
    role: "explore",
    provider,
    modelId: "gpt-5.4-mini",
    apiCompat: "anthropic",
    aliasModelId: createModelAlias("explore", provider.id, "gpt-5.4-mini"),
  };
  const coderRoute: AnthropicProxyResolvedRoute = {
    role: "coder",
    provider,
    modelId: "gpt-5.4-mini",
    apiCompat: "anthropic",
    aliasModelId: createModelAlias("coder", provider.id, "gpt-5.4-mini"),
  };
  const ids = buildModelsListResponse([exploreRoute, coderRoute]).data.map((entry) => entry.id);
  expect(ids).toEqual([exploreRoute.aliasModelId, coderRoute.aliasModelId]);
});

test("resolveProxyRoute does not guess SDK built-in Explore model ids", () => {
  const provider = createProvider("anthropic", "Anthropic", "provider-secret");
  const exploreRoute: AnthropicProxyResolvedRoute = {
    role: "explore",
    provider,
    modelId: "claude-haiku-4-5-20251001",
    apiCompat: "anthropic",
    aliasModelId: createModelAlias("explore", provider.id, "claude-haiku-4-5-20251001"),
  };
  const plannerRoute: AnthropicProxyResolvedRoute = {
    role: "planner",
    provider,
    modelId: "claude-sonnet-4-6",
    apiCompat: "anthropic",
    aliasModelId: createModelAlias("planner", provider.id, "claude-sonnet-4-6"),
  };
  expect(resolveProxyRoute([exploreRoute, plannerRoute], "gpt-5.4")).toBeUndefined();
});

test("resolveProxyRoute does not guess SDK default Claude models", () => {
  const provider = createProvider("openai", "OpenAI", "provider-secret");
  const exploreRoute: AnthropicProxyResolvedRoute = {
    role: "explore",
    provider,
    modelId: "gpt-5.4-mini",
    apiCompat: "anthropic",
    aliasModelId: createModelAlias("explore", provider.id, "gpt-5.4-mini"),
  };
  const plannerRoute: AnthropicProxyResolvedRoute = {
    role: "planner",
    provider,
    modelId: "gpt-5.5",
    apiCompat: "anthropic",
    aliasModelId: createModelAlias("planner", provider.id, "gpt-5.5"),
  };
  expect(resolveProxyRoute([exploreRoute, plannerRoute], "claude-haiku-4-5-20251001")).toBeUndefined();
  expect(resolveProxyRoute([exploreRoute, plannerRoute], "claude-sonnet-4-6")).toBeUndefined();
});

test("createModelAlias includes explore role", () => {
  const provider = createProvider("qwen", "Qwen Anthropic", "provider-secret");
  const alias = createModelAlias("explore", provider.id, "qwen-explore");
  expect(alias).toMatch(/^eco-explore-/);
  const route: AnthropicProxyResolvedRoute = {
    role: "explore",
    provider,
    modelId: "qwen-explore",
    apiCompat: "anthropic",
    aliasModelId: alias,
  };
  expect(resolveProxyRoute([route], alias)).toEqual(route);
});

test("lists alias ids for SDK model discovery", () => {
  const provider = createProvider("qwen", "Qwen Anthropic", "provider-secret");
  const route: AnthropicProxyResolvedRoute = {
    role: "planner",
    provider,
    modelId: "qwen-planner",
    apiCompat: "anthropic",
    aliasModelId: createModelAlias("planner", provider.id, "qwen-planner"),
  };

  const response = buildModelsListResponse([route]);
  expect(response.data.map((entry) => entry.id)).toEqual([route.aliasModelId]);
});

test("estimateInputTokensFromAnthropicBody counts messages and system", () => {
  const estimate = estimateInputTokensFromAnthropicBody({
    system: "hello",
    messages: [{ role: "user", content: "world" }],
  });
  expect(estimate).toBeGreaterThan(0);
});

test("injectImagesIntoMessagesBody prepends image blocks to last user message", () => {
  const body = {
    messages: [
      { role: "assistant", content: "hi" },
      { role: "user", content: "describe this" },
    ],
  };
  injectImagesIntoMessagesBody(body, [
    { mediaType: "image/png", data: "abc123" },
  ]);
  const user = body.messages[1] as { content: Array<{ type: string }> };
  expect(Array.isArray(user.content)).toBe(true);
  expect(user.content[0]?.type).toBe("image");
  expect(user.content[1]?.type).toBe("text");
});

test("normalizeThinkingEffortFields removes reasoning effort when thinking is disabled", () => {
  const body: Record<string, unknown> = {
    thinking: { type: "disabled" },
    reasoning_effort: "medium",
    effort: "medium",
    output_config: { effort: "medium", other: true },
  };

  normalizeThinkingEffortFields(body);

  expect(body).toEqual({
    thinking: { type: "disabled" },
    output_config: { other: true },
  });
});

test("normalizeThinkingEffortFields preserves effort when thinking is enabled", () => {
  const body: Record<string, unknown> = {
    thinking: { type: "adaptive" },
    reasoning_effort: "medium",
  };

  normalizeThinkingEffortFields(body);

  expect(body).toEqual({
    thinking: { type: "adaptive" },
    reasoning_effort: "medium",
  });
});

test("extractUsageFromResponseBody reads non-streaming response usage", () => {
  const usage = extractUsageFromResponseBody({
    id: "msg_1",
    type: "message",
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 40,
    },
  });

  expect(usage).toMatchObject({
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheCreationTokens: 40,
  });
});

test("createStreamingUsageTracker reads streaming response usage", () => {
  const tracker = createStreamingUsageTracker();
  tracker.push(
    Buffer.from(
      `event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: {
          usage: {
            input_tokens: 80,
            output_tokens: 1,
            cache_read_input_tokens: 10,
            cache_creation_input_tokens: 12,
          },
        },
      })}\n\n`,
    ),
  );
  tracker.push(
    Buffer.from(
      `event: message_delta\ndata: ${JSON.stringify({
        type: "message_delta",
        usage: { output_tokens: 25 },
      })}\n\n`,
    ),
  );

  expect(tracker.finish()).toMatchObject({
    inputTokens: 80,
    outputTokens: 25,
    cacheReadTokens: 10,
    cacheCreationTokens: 12,
  });
});

function createProvider(
  id: string,
  name: string,
  apiKey: string,
  baseUrl = `https://${id}.example.com`,
  requestPath = "",
): ProviderConfigSecret {
  return {
    id,
    name,
    baseUrl,
    requestPath,
    apiCompat: "anthropic",
    defaultModel: "sonnet",
    enabled: true,
    hasApiKey: true,
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
    apiKey,
  };
}
