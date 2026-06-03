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

  const routes = (modelId: string) =>
    [
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

