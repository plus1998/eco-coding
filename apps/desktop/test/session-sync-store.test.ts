import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSessionSyncStore } from "../src/main/session-sync-store";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

test.skipIf(!sqliteAvailable)("session sync store saves redis settings and preserves password", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-session-sync-"));
  const store = await createSessionSyncStore(path.join(dir, "eco-coding.sqlite"));

  const saved = store.saveSettings({
    redisEnabled: true,
    redisUrl: "redis://127.0.0.1:6379",
    redisPassword: "secret",
    keyPrefix: "eco-sessions",
  });
  expect(saved.redisEnabled).toBe(true);
  expect(saved.hasRedisPassword).toBe(true);

  const updated = store.saveSettings({
    redisEnabled: true,
    redisUrl: "redis://127.0.0.1:6380",
    redisPassword: "",
    keyPrefix: "eco-sessions",
  });
  expect(updated.redisUrl).toBe("redis://127.0.0.1:6380");
  expect(store.getSettingsWithSecrets().redisPassword).toBe("secret");
});
