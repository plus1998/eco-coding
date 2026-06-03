import { expect, test } from "bun:test";
import {
  type AnthropicProxyResolvedRoute,
  buildModelsListResponse,
  createModelAlias,
  createStreamingUsageTracker,
  extractUsageFromResponseBody,
  estimateInputTokensFromAnthropicBody,
  injectImagesIntoMessagesBody,
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

test("lists alias and upstream model ids for SDK model discovery", () => {
  const provider = createProvider("qwen", "Qwen Anthropic", "provider-secret");
  const route: AnthropicProxyResolvedRoute = {
    role: "planner",
    provider,
    modelId: "qwen-planner",
    apiCompat: "anthropic",
    aliasModelId: createModelAlias("planner", provider.id, "qwen-planner"),
  };

  const response = buildModelsListResponse([route]);
  expect(response.data.map((entry) => entry.id)).toEqual([route.aliasModelId, route.modelId]);
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
