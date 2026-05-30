import { expect, test } from "bun:test";
import {
  type AnthropicProxyResolvedRoute,
  buildModelsListResponse,
  createModelAlias,
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
    aliasModelId: createModelAlias("coder", provider.id, "qwen-coder"),
  };

  expect(resolveProxyRoute([route], route.aliasModelId)).toEqual(route);
  expect(resolveProxyRoute([route], "qwen-coder")).toEqual(route);
  expect(resolveProxyRoute([route], "missing-model")).toBeUndefined();
});

test("lists alias and upstream model ids for SDK model discovery", () => {
  const provider = createProvider("qwen", "Qwen Anthropic", "provider-secret");
  const route: AnthropicProxyResolvedRoute = {
    role: "planner",
    provider,
    modelId: "qwen-planner",
    aliasModelId: createModelAlias("planner", provider.id, "qwen-planner"),
  };

  const response = buildModelsListResponse([route]);
  expect(response.data.map((entry) => entry.id)).toEqual([route.aliasModelId, route.modelId]);
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

function createProvider(id: string, name: string, apiKey: string): ProviderConfigSecret {
  return {
    id,
    name,
    baseUrl: `https://${id}.example.com`,
    defaultModel: "sonnet",
    enabled: true,
    hasApiKey: true,
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
    apiKey,
  };
}
