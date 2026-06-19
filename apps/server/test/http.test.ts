import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { AuthService } from "../src/auth/auth-service";
import { SqliteStore } from "../src/db/sqlite-store";
import { DeviceService } from "../src/devices/device-service";
import { handleEcoHttpRequest } from "../src/http";
import { PairingService } from "../src/pairing/pairing-service";
import { MemoryPresenceStore } from "../src/presence/presence-store";
import { RpcGateway } from "../src/rpc/rpc-gateway";

const TOKEN_SECRET = "test-secret-that-is-long-enough-for-hmac";

test("supports the complete single-instance HTTP management flow", async () => {
  const store = new SqliteStore({ database: new Database(":memory:") });
  const auth = new AuthService({
    store,
    tokenSecret: TOKEN_SECRET,
    accessTokenTtlSeconds: 60,
    refreshTokenTtlSeconds: 3600,
  });
  const devices = new DeviceService({ store });
  const pairing = new PairingService({ store, pairingTtlSeconds: 300 });
  const rpc = new RpcGateway({
    store,
    presence: new MemoryPresenceStore(),
    rpcTimeoutMs: 1000,
  });
  const client = createRouteClient({ store, auth, devices, pairing, rpc });

  try {
    const registered = await client.post<{
      user: { id: string };
      tokens: { accessToken: string; refreshToken: string };
    }>("/v1/auth/register", {
      email: "owner@example.com",
      password: "correct horse battery staple",
    });
    const userAccessToken = registered.tokens.accessToken;

    const desktop = await client.post<{
      device: { id: string; kind: "desktop" };
      deviceSecret: string;
      tokens: { accessToken: string };
    }>("/v1/devices/register", { kind: "desktop", name: "Studio" }, userAccessToken);
    const mobile = await client.post<{
      device: { id: string; kind: "mobile" };
      deviceSecret: string;
      tokens: { accessToken: string };
    }>("/v1/devices/register", { kind: "mobile", name: "Phone" }, userAccessToken);
    const unboundMobile = await client.post<{
      device: { id: string; kind: "mobile" };
      deviceSecret: string;
      tokens: { accessToken: string };
    }>("/v1/devices/register", { kind: "mobile", name: "Tablet" }, userAccessToken);

    const pairingSession = await client.post<{
      pairingId: string;
      code: string;
      qrPayload: string;
      expiresAt: string;
    }>("/v1/pairing", {}, desktop.tokens.accessToken);
    expect(pairingSession.qrPayload).toContain(pairingSession.code);

    const pendingPairing = await client.get<{ status: "pending" }>(
      `/v1/pairing/${pairingSession.pairingId}`,
      desktop.tokens.accessToken,
    );
    expect(pendingPairing.status).toBe("pending");

    const claimed = await client.post<{
      binding: { id: string; desktopDeviceId: string; mobileDeviceId: string };
    }>("/v1/pairing/claim", { code: pairingSession.code }, mobile.tokens.accessToken);
    expect(claimed.binding).toMatchObject({
      desktopDeviceId: desktop.device.id,
      mobileDeviceId: mobile.device.id,
    });

    await rpc.connect({
      sessionId: "sess_desktop",
      userId: registered.user.id,
      deviceId: desktop.device.id,
      deviceKind: "desktop",
      capabilities: ["events:publish", "rpc:receive", "device:pair"],
      send() {},
    });

    const presence = await client.get<{ devices: Array<{ id: string; kind: string; online: boolean }> }>(
      "/v1/presence",
      userAccessToken,
    );
    expect(presence.devices).toContainEqual(
      expect.objectContaining({
        id: desktop.device.id,
        kind: "desktop",
        online: true,
      }),
    );

    const mobilePresence = await client.get<{
      devices: Array<{ id: string; kind: string; online: boolean }>;
    }>("/v1/presence", mobile.tokens.accessToken);
    expect(mobilePresence.devices).toContainEqual(
      expect.objectContaining({
        id: desktop.device.id,
        kind: "desktop",
        online: true,
      }),
    );
    expect(mobilePresence.devices.some((device) => "deviceId" in device)).toBe(false);

    const unboundMobilePresence = await client.get<{
      devices: Array<{ id: string; kind: string; online: boolean }>;
    }>("/v1/presence", unboundMobile.tokens.accessToken);
    expect(unboundMobilePresence.devices.map((device) => device.id)).not.toContain(desktop.device.id);

    const listedDevices = await client.get<{
      devices: Array<{ id: string; online: boolean; disabledAt: string | null }>;
    }>("/v1/devices", userAccessToken);
    expect(listedDevices.devices).toContainEqual(
      expect.objectContaining({
        id: desktop.device.id,
        online: true,
        disabledAt: null,
      }),
    );

    const listedBindings = await client.get<{ bindings: Array<{ id: string; revokedAt: string | null }> }>(
      "/v1/bindings",
      userAccessToken,
    );
    expect(listedBindings.bindings).toHaveLength(1);
    expect(listedBindings.bindings[0]?.revokedAt).toBeNull();

    const mobileBindings = await client.get<{ bindings: Array<{ id: string; revokedAt: string | null }> }>(
      "/v1/bindings",
      mobile.tokens.accessToken,
    );
    expect(mobileBindings.bindings).toEqual([
      expect.objectContaining({
        id: claimed.binding.id,
        revokedAt: null,
      }),
    ]);

    const unboundMobileBindings = await client.get<{ bindings: Array<{ id: string }> }>(
      "/v1/bindings",
      unboundMobile.tokens.accessToken,
    );
    expect(unboundMobileBindings.bindings).toEqual([]);

    const revokedBinding = await client.delete<{ binding: { id: string; revokedAt: string } }>(
      `/v1/bindings/${claimed.binding.id}`,
      userAccessToken,
    );
    expect(revokedBinding.binding.revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const disabledMobile = await client.delete<{ device: { id: string; disabledAt: string } }>(
      `/v1/devices/${mobile.device.id}`,
      userAccessToken,
    );
    expect(disabledMobile.device.disabledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const disabledTokenResponse = await client.raw("GET", "/v1/me", undefined, mobile.tokens.accessToken);
    expect(disabledTokenResponse.status).toBe(401);

    const audit = await client.get<{ auditLogs: Array<{ action: string }> }>(
      "/v1/audit-logs?limit=10",
      userAccessToken,
    );
    expect(audit.auditLogs.map((log) => log.action)).toContain("binding.revoke");
    expect(audit.auditLogs.map((log) => log.action)).toContain("device.disable");

    await client.post("/v1/auth/logout", {
      refreshToken: registered.tokens.refreshToken,
    });
    const refreshAfterLogout = await client.raw("POST", "/v1/auth/refresh", {
      refreshToken: registered.tokens.refreshToken,
    });
    expect(refreshAfterLogout.status).toBe(400);
  } finally {
    store.close();
  }
});

function createRouteClient(input: {
  store: SqliteStore;
  auth: AuthService;
  devices: DeviceService;
  pairing: PairingService;
  rpc: RpcGateway;
}) {
  async function raw(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    accessToken?: string,
  ): Promise<Response> {
    const headers = new Headers();
    if (body) {
      headers.set("content-type", "application/json");
    }
    if (accessToken) {
      headers.set("authorization", `Bearer ${accessToken}`);
    }
    const request = new Request(`http://eco.test${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return handleEcoHttpRequest({
      request,
      url: new URL(request.url),
      auth: input.auth,
      devices: input.devices,
      pairing: input.pairing,
      rpc: input.rpc,
      store: input.store,
    });
  }
  return {
    raw,
    async get<TResult>(path: string, accessToken?: string): Promise<TResult> {
      return readJsonResponse<TResult>(await raw("GET", path, undefined, accessToken));
    },
    async post<TResult = { ok: true }>(
      path: string,
      body: Record<string, unknown>,
      accessToken?: string,
    ): Promise<TResult> {
      return readJsonResponse<TResult>(await raw("POST", path, body, accessToken));
    },
    async delete<TResult>(path: string, accessToken: string): Promise<TResult> {
      return readJsonResponse<TResult>(await raw("DELETE", path, undefined, accessToken));
    },
  };
}

async function readJsonResponse<TResult>(response: Response): Promise<TResult> {
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(JSON.stringify(payload));
  }
  return payload as TResult;
}
