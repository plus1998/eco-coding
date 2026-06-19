import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { AuthService } from "../src/auth/auth-service";
import { DeviceService } from "../src/devices/device-service";
import { PairingService } from "../src/pairing/pairing-service";
import { SqliteStore } from "../src/db/sqlite-store";

const TOKEN_SECRET = "test-secret-that-is-long-enough-for-hmac";

test("registers users, devices, and binds a mobile through one-time pairing", async () => {
  const store = createStore();
  const clock = fixedClock("2026-01-01T00:00:00.000Z");
  const auth = new AuthService({
    store,
    tokenSecret: TOKEN_SECRET,
    accessTokenTtlSeconds: 60,
    refreshTokenTtlSeconds: 3600,
    now: clock,
  });
  const devices = new DeviceService({ store, now: clock });
  const pairing = new PairingService({ store, pairingTtlSeconds: 300, now: clock });

  const user = await auth.registerUser({
    email: "owner@example.com",
    password: "correct horse battery staple",
  });
  const desktop = await devices.registerDevice({
    userId: user.id,
    kind: "desktop",
    name: "Mac Studio",
  });
  const mobile = await devices.registerDevice({
    userId: user.id,
    kind: "mobile",
    name: "iPhone",
  });

  const desktopTokens = await auth.issueDeviceTokenBundle(desktop.device);
  const desktopClaims = await auth.verifyBearerToken(desktopTokens.accessToken);
  expect(desktopClaims).toMatchObject({
    subjectKind: "device",
    deviceId: desktop.device.id,
    deviceKind: "desktop",
  });

  const createdPairing = await pairing.createPairingSession({
    userId: user.id,
    desktopDeviceId: desktop.device.id,
  });
  const binding = await pairing.claimPairingSession({
    userId: user.id,
    mobileDeviceId: mobile.device.id,
    code: createdPairing.code,
  });

  expect(binding).toMatchObject({
    userId: user.id,
    desktopDeviceId: desktop.device.id,
    mobileDeviceId: mobile.device.id,
  });
  expect(binding.capabilities).toContain("approval:decide");
  expect(() =>
    store.claimPairingSessionByCodeHash(createdPairing.session.codeHash, "2026-01-01T00:01:00.000Z"),
  ).not.toThrow();
  expect(store.claimPairingSessionByCodeHash(createdPairing.session.codeHash, "2026-01-01T00:01:00.000Z")).toBeUndefined();

  store.close();
});

test("rejects expired pairing codes", async () => {
  const store = createStore();
  const auth = new AuthService({
    store,
    tokenSecret: TOKEN_SECRET,
    accessTokenTtlSeconds: 60,
    refreshTokenTtlSeconds: 3600,
    now: fixedClock("2026-01-01T00:00:00.000Z"),
  });
  const devices = new DeviceService({ store, now: fixedClock("2026-01-01T00:00:00.000Z") });
  const pairing = new PairingService({
    store,
    pairingTtlSeconds: 1,
    now: fixedClock("2026-01-01T00:00:00.000Z"),
  });
  const user = await auth.registerUser({
    email: "owner2@example.com",
    password: "correct horse battery staple",
  });
  const desktop = await devices.registerDevice({ userId: user.id, kind: "desktop", name: "PC" });
  const mobile = await devices.registerDevice({ userId: user.id, kind: "mobile", name: "Phone" });
  const createdPairing = await pairing.createPairingSession({
    userId: user.id,
    desktopDeviceId: desktop.device.id,
  });
  const expiredPairing = new PairingService({
    store,
    pairingTtlSeconds: 1,
    now: fixedClock("2026-01-01T00:00:02.000Z"),
  });

  await expect(
    expiredPairing.claimPairingSession({
      userId: user.id,
      mobileDeviceId: mobile.device.id,
      code: createdPairing.code,
    }),
  ).rejects.toThrow("Pairing code is invalid or expired.");

  store.close();
});

function createStore(): SqliteStore {
  return new SqliteStore({ database: new Database(":memory:") });
}

function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}
