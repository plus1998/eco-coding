import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProviderStore } from "../src/main/provider-store";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

test.skipIf(!sqliteAvailable)("fresh provider store does not auto-seed providers or routes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-provider-store-"));
  const store = await createProviderStore(path.join(dir, "eco-coding.sqlite"));

  const settings = store.getSettings();
  expect(settings.providers).toHaveLength(0);
  expect(settings.routeProfiles).toHaveLength(0);
});

test.skipIf(!sqliteAvailable)("route profiles have no active flag semantics", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-provider-profiles-"));
  const store = await createProviderStore(path.join(dir, "eco-coding.sqlite"));

  const provider = store.saveProvider({
    name: "P",
    baseUrl: "https://api.example.com",
    apiKey: "k",
    defaultModel: "m1",
    enabled: true,
  });

  const routes = (modelId: string) => [
    { role: "planner" as const, providerId: provider.id, modelId },
    { role: "explore" as const, providerId: provider.id, modelId },
    { role: "architect" as const, providerId: provider.id, modelId },
    { role: "coder" as const, providerId: provider.id, modelId },
    { role: "reviewer" as const, providerId: provider.id, modelId },
    { role: "tester" as const, providerId: provider.id, modelId },
  ];

  const first = store.saveRouteProfile({
    name: "方案一",
    routes: routes("m1"),
  });

  const second = store.saveRouteProfile({
    name: "方案二",
    routes: routes("m2"),
  });

  const profiles = store.getSettings().routeProfiles;
  expect(profiles).toHaveLength(2);
  expect(profiles.every((profile) => !("isActive" in profile))).toBe(true);
  expect(first.id).not.toBe(second.id);
});

test.skipIf(!sqliteAvailable)(
  "settings expose built-in agents without derived saved orchestrations",
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-provider-orchestration-"));
    const store = await createProviderStore(path.join(dir, "eco-coding.sqlite"));

    const provider = store.saveProvider({
      name: "P",
      baseUrl: "https://api.example.com",
      apiKey: "k",
      defaultModel: "m1",
      enabled: true,
    });

    store.saveRouteProfile({
      name: "默认编程",
      routes: [
        { role: "planner", providerId: provider.id, modelId: "planner-model" },
        { role: "explore", providerId: provider.id, modelId: "explore-model" },
        { role: "architect", providerId: provider.id, modelId: "architect-model" },
        { role: "coder", providerId: provider.id, modelId: "coder-model" },
        { role: "reviewer", providerId: provider.id, modelId: "reviewer-model" },
        { role: "tester", providerId: provider.id, modelId: "tester-model" },
      ],
    });

    const settings = store.getSettings();
    expect(settings.agentTemplates.map((template) => template.id)).toContain("builtin.coding.coder");
    expect(settings.mainAgentConfigs).toEqual([]);
    expect(settings.mainAgentPrompts).toEqual([]);
    expect(settings.subagentOrchestrations).toEqual([]);
    expect(settings.routeProfiles).toHaveLength(1);
    expect(settings.routeProfiles[0]?.name).toBe("默认编程");
  },
);

test.skipIf(!sqliteAvailable)("provider token count mode is persisted explicitly", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-provider-token-count-mode-"));
  const store = await createProviderStore(path.join(dir, "eco-coding.sqlite"));

  const provider = store.saveProvider({
    name: "P",
    baseUrl: "https://api.example.com",
    apiKey: "k",
    defaultModel: "m1",
    tokenCountMode: "openai_responses",
    enabled: true,
  });
  expect(provider.tokenCountMode).toBe("openai_responses");
  expect(store.getProviderWithSecret(provider.id)?.tokenCountMode).toBe("openai_responses");

  expect(() =>
    store.saveProvider({
      id: provider.id,
      name: "P",
      baseUrl: "https://api.example.com",
      apiKey: "",
      defaultModel: "m1",
      tokenCountMode: "invalid" as never,
      enabled: true,
    }),
  ).toThrow("无效的 Provider token 计数模式");
});

test.skipIf(!sqliteAvailable)("candidate model manual pricing preserves zero values", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-provider-candidate-zero-"));
  const store = await createProviderStore(path.join(dir, "eco-coding.sqlite"));

  const provider = store.saveProvider({
    name: "P",
    baseUrl: "https://api.example.com",
    apiKey: "k",
    defaultModel: "m1",
    enabled: true,
  });

  const saved = store.saveCandidateModel({
    providerId: provider.id,
    modelId: "free-model",
    manualSpec: {
      inputPerM: 0,
      outputPerM: 0,
      cacheReadPerM: 0,
      cacheWritePerM: 0,
      priceMultiplier: 0,
    },
  });

  expect(saved.manualSpec).toEqual({
    inputPerM: 0,
    outputPerM: 0,
    cacheReadPerM: 0,
    cacheWritePerM: 0,
    priceMultiplier: 0,
  });
  expect(store.listCandidateModels(provider.id)[0]?.manualSpec).toEqual(saved.manualSpec);
});

test.skipIf(!sqliteAvailable)("deletes the only unreferenced provider and its candidate models", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-provider-delete-only-"));
  const store = await createProviderStore(path.join(dir, "eco-coding.sqlite"));

  const provider = store.saveProvider({
    name: "Only",
    baseUrl: "https://api.example.com",
    apiKey: "k",
    defaultModel: "m1",
    enabled: true,
  });
  store.saveCandidateModel({
    providerId: provider.id,
    modelId: "m1",
  });

  store.deleteProvider(provider.id);

  expect(store.listProviders()).toEqual([]);
  expect(store.listCandidateModels(provider.id)).toEqual([]);
});

test.skipIf(!sqliteAvailable)(
  "deleting a provider removes legacy route profiles that reference it",
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-provider-delete-route-"));
    const store = await createProviderStore(path.join(dir, "eco-coding.sqlite"));

    const provider = store.saveProvider({
      name: "Referenced",
      baseUrl: "https://api.example.com",
      apiKey: "k",
      defaultModel: "m1",
      enabled: true,
    });
    store.saveCandidateModel({
      providerId: provider.id,
      modelId: "m1",
    });
    store.saveRouteProfile({
      name: "Uses provider",
      routes: [
        { role: "planner", providerId: provider.id, modelId: "m1" },
        { role: "explore", providerId: provider.id, modelId: "m1" },
        { role: "architect", providerId: provider.id, modelId: "m1" },
        { role: "coder", providerId: provider.id, modelId: "m1" },
        { role: "reviewer", providerId: provider.id, modelId: "m1" },
        { role: "tester", providerId: provider.id, modelId: "m1" },
      ],
    });

    store.deleteProvider(provider.id);

    expect(store.listProviders()).toEqual([]);
    expect(store.listCandidateModels(provider.id)).toEqual([]);
    expect(store.listRouteProfiles()).toEqual([]);
  },
);

test.skipIf(!sqliteAvailable)("deleting an unreferenced provider does not rewrite routes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-provider-delete-unreferenced-"));
  const store = await createProviderStore(path.join(dir, "eco-coding.sqlite"));

  const retained = store.saveProvider({
    name: "Retained",
    baseUrl: "https://retained.example.com",
    apiKey: "k",
    defaultModel: "retained-model",
    enabled: true,
  });
  const removed = store.saveProvider({
    name: "Removed",
    baseUrl: "https://removed.example.com",
    apiKey: "k",
    defaultModel: "removed-model",
    enabled: true,
  });
  store.saveRouteProfile({
    name: "Retained routes",
    routes: [
      { role: "planner", providerId: retained.id, modelId: "planner-model" },
      { role: "explore", providerId: retained.id, modelId: "explore-model" },
      { role: "architect", providerId: retained.id, modelId: "architect-model" },
      { role: "coder", providerId: retained.id, modelId: "coder-model" },
      { role: "reviewer", providerId: retained.id, modelId: "reviewer-model" },
      { role: "tester", providerId: retained.id, modelId: "tester-model" },
    ],
  });
  const routesBeforeDelete = store.listRouteProfiles()[0]?.routes;

  store.deleteProvider(removed.id);

  expect(store.listProviders().map((entry) => entry.id)).toEqual([retained.id]);
  expect(store.listRouteProfiles()[0]?.routes).toEqual(routesBeforeDelete);
});

test.skipIf(!sqliteAvailable)("rejects deleting an unknown provider", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-provider-delete-missing-"));
  const store = await createProviderStore(path.join(dir, "eco-coding.sqlite"));

  expect(() => store.deleteProvider("missing")).toThrow("找不到 Provider：missing");
});
