import { expect, test } from "bun:test";
import {
  buildEcoJsonRpcNotification,
  buildEcoJsonRpcRequest,
  buildEcoJsonRpcSuccess,
  ECO_RPC_METHODS,
  type EcoJsonRpcMessage,
} from "@eco/shared";
import type { AuthService } from "../src/auth/auth-service";
import type { MongoStore } from "../src/db/mongo-store";
import type { DeviceService } from "../src/devices/device-service";
import { handleEcoHttpRequest } from "../src/http";
import { TrafficMeter, trafficMeter } from "../src/metrics/traffic-meter";
import type { PairingService } from "../src/pairing/pairing-service";
import { MemoryPresenceStore } from "../src/presence/presence-store";
import { RpcGateway, type RpcPeer } from "../src/rpc/rpc-gateway";
import type {
  AccessTokenClaims,
  DeviceBindingRecord,
  DeviceRecord,
} from "../src/types";

test("GET /v1/metrics/traffic requires device:admin and reports http counters", async () => {
  trafficMeter.reset();
  trafficMeter.configure({ instanceId: "srv_test_metrics" });

  const auth = createAuthStub({
    admin: {
      tokenType: "access",
      subjectKind: "user",
      tokenId: "tok_admin",
      userId: "usr_1",
      capabilities: ["device:admin"],
      issuedAt: 0,
      expiresAt: Number.MAX_SAFE_INTEGER,
    },
    mobile: {
      tokenType: "access",
      subjectKind: "device",
      tokenId: "tok_mobile",
      userId: "usr_1",
      deviceId: "dev_mobile",
      deviceKind: "mobile",
      capabilities: ["events:read", "rpc:invoke"],
      issuedAt: 0,
      expiresAt: Number.MAX_SAFE_INTEGER,
    },
  });

  const client = createRouteClient(auth);

  trafficMeter.recordHttp({
    route: "POST /v1/auth/register",
    status: 201,
    bytesIn: 40,
    bytesOut: 200,
  });
  trafficMeter.recordHttp({
    route: "GET /v1/presence",
    status: 200,
    bytesIn: 0,
    bytesOut: 120,
  });

  const forbidden = await client.raw("GET", "/v1/metrics/traffic", undefined, "mobile-token");
  expect(forbidden.status).toBe(403);

  const snapshot = await client.get<{
    instanceId: string;
    totals: { requests: number; bytesIn: number; bytesOut: number };
    httpByRoute: Array<{ key: string; count: number; bytesOut: number }>;
    windows: { "60s": { requests: number } };
  }>("/v1/metrics/traffic", "admin-token");

  expect(snapshot.instanceId).toBe("srv_test_metrics");
  expect(snapshot.totals.requests).toBeGreaterThanOrEqual(3);
  expect(snapshot.httpByRoute.some((row) => row.key === "GET /v1/presence")).toBe(true);
  expect(snapshot.httpByRoute.some((row) => row.key === "POST /v1/auth/register")).toBe(true);
  expect(snapshot.windows["60s"].requests).toBeGreaterThanOrEqual(3);

  await client.post("/v1/metrics/traffic/reset", {}, "admin-token");
  const afterReset = await client.get<{
    instanceId: string;
    totals: { requests: number };
    httpByRoute: Array<{ key: string }>;
  }>("/v1/metrics/traffic", "admin-token");
  expect(afterReset.instanceId).toBe("srv_test_metrics");
  expect(afterReset.httpByRoute.every((row) => !row.key.includes("/v1/auth/register"))).toBe(true);
  expect(afterReset.totals.requests).toBeGreaterThanOrEqual(1);
});

test("RpcGateway attributes invoke channel and event fanout into a traffic meter", async () => {
  const meter = new TrafficMeter({ instanceId: "srv_rpc_metrics" });
  const binding: DeviceBindingRecord = {
    id: "bind_metrics",
    userId: "usr_1",
    desktopDeviceId: "dev_desktop",
    mobileDeviceId: "dev_mobile",
    capabilities: ["events:read", "rpc:invoke", "approval:decide"],
    createdAt: "2026-01-01T00:00:00.000Z",
    revokedAt: null,
  };
  const store = createFakeMongoStore({
    binding,
    devices: [
      {
        id: "dev_desktop",
        userId: "usr_1",
        kind: "desktop",
        name: "Studio",
        secretHash: "hash",
        metadata: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: null,
        disabledAt: null,
      },
      {
        id: "dev_mobile",
        userId: "usr_1",
        kind: "mobile",
        name: "Phone",
        secretHash: "hash",
        metadata: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: null,
        disabledAt: null,
      },
    ],
  });

  const desktopMessages: EcoJsonRpcMessage[] = [];
  const mobileMessages: EcoJsonRpcMessage[] = [];
  const desktopPeer: RpcPeer = {
    sessionId: "sess_desktop_metrics",
    userId: "usr_1",
    deviceId: "dev_desktop",
    deviceKind: "desktop",
    capabilities: ["events:publish", "rpc:receive", "device:pair"],
    send(message) {
      desktopMessages.push(message);
    },
  };
  const mobilePeer: RpcPeer = {
    sessionId: "sess_mobile_metrics",
    userId: "usr_1",
    deviceId: "dev_mobile",
    deviceKind: "mobile",
    capabilities: ["events:read", "rpc:invoke", "approval:decide"],
    send(message) {
      mobileMessages.push(message);
    },
  };

  const gateway = new RpcGateway({
    store,
    presence: new MemoryPresenceStore(),
    rpcTimeoutMs: 1000,
    traffic: meter,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  await gateway.connect(desktopPeer);
  await gateway.connect(mobilePeer);
  desktopMessages.length = 0;
  mobileMessages.length = 0;

  await gateway.handleMessage(
    mobilePeer,
    JSON.stringify(
      buildEcoJsonRpcRequest("req_1", ECO_RPC_METHODS.invoke, {
        desktopDeviceId: "dev_desktop",
        channel: "thread:list",
        args: [],
      }),
    ),
  );
  const forwarded = desktopMessages[0] as { id: string };
  expect(forwarded?.id).toBeTruthy();
  await gateway.handleMessage(
    desktopPeer,
    JSON.stringify(buildEcoJsonRpcSuccess(forwarded.id, { threads: ["a"] })),
  );

  await gateway.handleMessage(
    desktopPeer,
    JSON.stringify(
      buildEcoJsonRpcNotification(ECO_RPC_METHODS.event, {
        protocolVersion: 1,
        id: "evt_1",
        kind: "thread.projection",
        source: "desktop",
        occurredAt: "2026-01-01T00:00:00.000Z",
        aggregateKey: "thread:1",
        payload: { threadId: "t1" },
      }),
    ),
  );

  const snap = meter.snapshot();
  expect(snap.rpcByMethod.some((row) => row.key === ECO_RPC_METHODS.invoke && row.count >= 1)).toBe(
    true,
  );
  expect(
    snap.invokeByChannel.some((row) => row.key === "thread:list" && row.bytesIn > 0 && row.bytesOut > 0),
  ).toBe(true);
  expect(
    snap.eventByKind.some((row) => row.key === "thread.projection" && row.count === 1 && row.bytesOut > 0),
  ).toBe(true);
  expect(mobileMessages.some((message) => "result" in message)).toBe(true);
});

function createAuthStub(tokens: { admin: AccessTokenClaims; mobile: AccessTokenClaims }): AuthService {
  return {
    async verifyBearerToken(token: string): Promise<AccessTokenClaims> {
      if (token === "admin-token") {
        return tokens.admin;
      }
      if (token === "mobile-token") {
        return tokens.mobile;
      }
      throw new Error("Invalid access token.");
    },
  } as AuthService;
}

function createFakeMongoStore(input: {
  binding: DeviceBindingRecord;
  devices: DeviceRecord[];
}): MongoStore {
  return {
    async touchDevice() {},
    async updateDeviceProfile() {
      return input.devices[0]!;
    },
    async findActiveBinding(_userId: string, desktopDeviceId: string, mobileDeviceId: string) {
      if (
        input.binding.desktopDeviceId === desktopDeviceId &&
        input.binding.mobileDeviceId === mobileDeviceId &&
        !input.binding.revokedAt
      ) {
        return input.binding;
      }
      return null;
    },
    async listActiveBindingsForDesktop(_userId: string, desktopDeviceId: string) {
      return input.binding.desktopDeviceId === desktopDeviceId && !input.binding.revokedAt
        ? [input.binding]
        : [];
    },
    async listActiveBindingsForMobile(_userId: string, mobileDeviceId: string) {
      return input.binding.mobileDeviceId === mobileDeviceId && !input.binding.revokedAt
        ? [input.binding]
        : [];
    },
    async createAuditLog() {
      return {
        id: "aud_1",
        userId: input.binding.userId,
        action: "rpc.invoke",
        status: "accepted" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
    },
  } as unknown as MongoStore;
}

function createRouteClient(auth: AuthService) {
  const store = {} as MongoStore;
  const devices = {} as DeviceService;
  const pairing = {} as PairingService;
  const rpc = {
    async listOnlineDevices() {
      return [];
    },
  } as unknown as RpcGateway;

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
      auth,
      devices,
      pairing,
      rpc,
      store,
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
  };
}

async function readJsonResponse<TResult>(response: Response): Promise<TResult> {
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(JSON.stringify(payload));
  }
  return payload as TResult;
}
