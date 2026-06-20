import { expect, test } from "bun:test";
import {
  buildRedisConnectionUrl,
  ECO_SERVER_REDIS_URL,
  MemoryPresenceStore,
} from "../src/presence/presence-store";

test("buildRedisConnectionUrl uses fixed redis endpoint", () => {
  expect(buildRedisConnectionUrl()).toBe(ECO_SERVER_REDIS_URL);
  expect(buildRedisConnectionUrl("   ")).toBe(ECO_SERVER_REDIS_URL);
});

test("buildRedisConnectionUrl injects password", () => {
  expect(buildRedisConnectionUrl("secret")).toBe("redis://:secret@127.0.0.1:6379");
});

test("memory presence store tracks device routes by session", async () => {
  const store = new MemoryPresenceStore();
  await store.setDeviceRoute({
    instanceId: "server-a",
    sessionId: "sess_1",
    userId: "usr_1",
    deviceId: "dev_1",
    deviceKind: "desktop",
    connectedAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
  });

  expect(await store.getDeviceRoute("dev_1")).toMatchObject({ instanceId: "server-a" });
  expect(await store.listDeviceRoutesForUser("usr_1")).toHaveLength(1);

  await store.deleteDeviceRoute({ deviceId: "dev_1", userId: "usr_1", sessionId: "other" });
  expect(await store.getDeviceRoute("dev_1")).toMatchObject({ instanceId: "server-a" });

  await store.deleteDeviceRoute({ deviceId: "dev_1", userId: "usr_1", sessionId: "sess_1" });
  expect(await store.getDeviceRoute("dev_1")).toBeUndefined();
});
