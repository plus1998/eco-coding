import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCenterServerStore } from "../src/main/center-server-store";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

test.skipIf(!sqliteAvailable)("center server store saves settings and preserves secrets", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-center-server-"));
  const store = await createCenterServerStore(path.join(dir, "eco-coding.sqlite"));

  const saved = store.saveSettings({
    enabled: true,
    serverUrl: "https://center.example.com/",
    deviceId: "dev_1",
    deviceName: "My Desktop",
    deviceSecret: "secret_abc",
    accessToken: "access_1",
    refreshToken: "refresh_1",
    accessTokenExpiresAt: "2030-01-01T00:00:00.000Z",
  });
  expect(saved.enabled).toBe(true);
  expect(saved.serverUrl).toBe("https://center.example.com");
  expect(saved.deviceId).toBe("dev_1");
  expect(saved.hasDeviceSecret).toBe(true);
  expect(saved.hasRefreshToken).toBe(true);

  const updated = store.saveSettings({
    enabled: true,
    serverUrl: "https://center.example.com",
    deviceSecret: "",
    refreshToken: "",
  });
  expect(updated.deviceName).toBe("My Desktop");
  const secrets = store.getSettingsWithSecrets();
  expect(secrets.deviceSecret).toBe("secret_abc");
  expect(secrets.refreshToken).toBe("refresh_1");
});
