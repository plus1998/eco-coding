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
  "settings expose built-in agents and migrated orchestration profiles",
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
    expect(settings.orchestrationProfiles).toHaveLength(1);
    expect(settings.orchestrationProfiles[0]).toMatchObject({
      name: "默认编程",
      preset: "coding",
      mainAgent: {
        agentKey: "main",
        modelRef: { providerId: provider.id, modelId: "planner-model" },
      },
    });
    expect(
      settings.orchestrationProfiles[0]?.agents.find((agent) => agent.agentKey === "coder")?.modelRef.modelId,
    ).toBe("coder-model");
  },
);
