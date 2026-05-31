import { expect, test } from "bun:test";
import { resolveUsageRoute } from "../src/main/billing-resolver";
import type { ProviderConfigSecret } from "../src/main/provider-store";
import { createModelAlias } from "../src/main/anthropic-proxy";

test("resolveUsageRoute maps eco alias to route", () => {
  const provider = createProvider();
  const routes = [
    { role: "planner" as const, provider, modelId: "sonnet" },
    { role: "coder" as const, provider, modelId: "haiku" },
  ];
  const alias = createModelAlias("coder", provider.id, "haiku");
  const resolved = resolveUsageRoute("planner", alias, routes);
  expect(resolved?.role).toBe("coder");
  expect(resolved?.modelId).toBe("haiku");
});

test("resolveUsageRoute prefers role route when SDK reports planner model id for eco role", () => {
  const provider = createProvider();
  const routes = [
    { role: "planner" as const, provider, modelId: "claude-opus-4-7" },
    { role: "coder" as const, provider, modelId: "claude-haiku-4-5" },
  ];
  const resolved = resolveUsageRoute("coder", "claude-opus-4-7", routes);
  expect(resolved?.role).toBe("coder");
  expect(resolved?.modelId).toBe("claude-haiku-4-5");
});

test("resolveUsageRoute unique model id still resolves correctly", () => {
  const provider = createProvider();
  const routes = [
    { role: "planner" as const, provider, modelId: "claude-opus-4-7" },
    { role: "coder" as const, provider, modelId: "claude-haiku-4-5" },
  ];
  const resolved = resolveUsageRoute("coder", "claude-haiku-4-5", routes);
  expect(resolved?.role).toBe("coder");
  expect(resolved?.modelId).toBe("claude-haiku-4-5");
});

test("resolveUsageRoute maps unique explore model when SDK result role is planner", () => {
  const provider = createProvider();
  const routes = [
    { role: "planner" as const, provider, modelId: "claude-opus-4-7" },
    { role: "explore" as const, provider, modelId: "claude-haiku-4-5" },
  ];
  const resolved = resolveUsageRoute("planner", "claude-haiku-4-5", routes);
  expect(resolved?.role).toBe("explore");
  expect(resolved?.modelId).toBe("claude-haiku-4-5");
});

test("resolveUsageRoute maps explore eco alias when SDK result role is planner", () => {
  const provider = createProvider();
  const routes = [
    { role: "planner" as const, provider, modelId: "claude-opus-4-7" },
    { role: "explore" as const, provider, modelId: "claude-haiku-4-5" },
  ];
  const alias = createModelAlias("explore", provider.id, "claude-haiku-4-5");
  const resolved = resolveUsageRoute("planner", alias, routes);
  expect(resolved?.role).toBe("explore");
  expect(resolved?.modelId).toBe("claude-haiku-4-5");
});

test("resolveUsageRoute preserves models.dev mapping for billing", () => {
  const provider = createProvider();
  const routes = [
    { role: "planner" as const, provider, modelId: "vendor-model" },
    {
      role: "coder" as const,
      provider,
      modelId: "custom-alias",
      modelsDevMapping: { providerKey: "anthropic", modelId: "claude-haiku-4-5" },
    },
  ];
  const alias = createModelAlias("coder", provider.id, "custom-alias");
  const resolved = resolveUsageRoute("planner", alias, routes);
  expect(resolved?.role).toBe("coder");
  expect(resolved?.modelsDevMapping).toEqual({
    providerKey: "anthropic",
    modelId: "claude-haiku-4-5",
  });
});

function createProvider(): ProviderConfigSecret {
  return {
    id: "anthropic-compatible",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "sonnet",
    enabled: true,
    hasApiKey: true,
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
    apiKey: "secret",
  };
}
