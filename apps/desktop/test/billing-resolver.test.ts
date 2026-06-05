import { expect, test } from "bun:test";
import {
  manualSpecToRates,
  resolvePublicModelId,
  resolveRatesForRoute,
  resolveRuntimeRoutesFromSettings,
  resolveUsageRoute,
} from "../src/main/billing-resolver";
import type { ProviderConfigSecret } from "../src/main/provider-store";
import { createModelAlias } from "../src/main/anthropic-proxy";
import type { ModelSettingsSnapshot } from "../src/shared/ipc";

test("resolvePublicModelId maps OTel SDK alias to upstream model id", () => {
  const provider = createProvider();
  const routes = [
    { role: "planner" as const, provider, modelId: "claude-opus-4-7" },
    { role: "coder" as const, provider, modelId: "claude-haiku-4-5" },
  ];
  const alias = createModelAlias("planner", provider.id, "claude-opus-4-7");
  expect(resolvePublicModelId("planner", alias, routes)).toBe("claude-opus-4-7");
  expect(resolvePublicModelId("planner", undefined, routes)).toBe("claude-opus-4-7");
});

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

test("manualSpecToRates returns rates when input and output are set", () => {
  expect(
    manualSpecToRates({
      inputPerM: 3,
      outputPerM: 15,
      cacheReadPerM: 0.3,
    }),
  ).toEqual({
    input: 3,
    output: 15,
    cacheRead: 0.3,
  });
});

test("resolveRatesForRoute prefers models.dev lookup over manual spec", () => {
  const lookup = {
    providerKey: "anthropic",
    modelId: "claude-sonnet-4",
    rates: { input: 1, output: 2 },
  };
  expect(
    resolveRatesForRoute(lookup, { inputPerM: 9, outputPerM: 9 }),
  ).toEqual({ input: 1, output: 2 });
});

test("resolveRatesForRoute falls back to manual spec", () => {
  expect(resolveRatesForRoute(null, { inputPerM: 4, outputPerM: 8 })).toEqual({
    input: 4,
    output: 8,
  });
});

test("resolveRuntimeRoutesFromSettings returns empty routes without override", () => {
  const provider = createProvider();
  const settings: ModelSettingsSnapshot = {
    providers: [
      {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        requestPath: provider.requestPath,
        apiCompat: provider.apiCompat,
        defaultModel: provider.defaultModel,
        enabled: provider.enabled,
        hasApiKey: provider.hasApiKey,
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt,
      },
    ],
    routeProfiles: [],
  };
  expect(resolveRuntimeRoutesFromSettings(settings, [provider])).toEqual([]);
});

test("resolveRuntimeRoutesFromSettings preserves manualSpec and modelsDevMapping", () => {
  const provider = createProvider();
  const settings: ModelSettingsSnapshot = { providers: [], routeProfiles: [] };
  const routes = resolveRuntimeRoutesFromSettings(settings, [provider], [
    {
      role: "planner",
      providerId: provider.id,
      modelId: "vendor-model",
      modelsDevMapping: { providerKey: "anthropic", modelId: "claude-sonnet-4" },
      manualSpec: { inputPerM: 3, outputPerM: 15, contextTokens: 200_000 },
    },
  ]);
  expect(routes).toHaveLength(1);
  expect(routes[0]?.modelsDevMapping).toEqual({
    providerKey: "anthropic",
    modelId: "claude-sonnet-4",
  });
  expect(routes[0]?.manualSpec).toEqual({
    inputPerM: 3,
    outputPerM: 15,
    contextTokens: 200_000,
  });
});

function createProvider(): ProviderConfigSecret {
  return {
    id: "anthropic-compatible",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    requestPath: "",
    apiCompat: "anthropic",
    defaultModel: "sonnet",
    enabled: true,
    hasApiKey: true,
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
    apiKey: "secret",
  };
}
