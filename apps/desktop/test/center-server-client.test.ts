import { afterEach, expect, test } from "bun:test";
import { ECO_RPC_METHODS } from "@eco/shared";
import { CenterServerDesktopClient } from "../src/main/center-server-client";
import type { CenterServerSettingsSecret, CenterServerStore } from "../src/main/center-server-store";
import { DesktopEventCenter } from "../src/main/event-center";
import type { CenterServerConnectionStatus, CenterServerSettingsView } from "../src/shared/center-server";
import { CenterServerRemoveConnectionError } from "../src/shared/center-server";
import {
  EVENT_CENTER_JSON_RPC_METHODS,
  IPC_CHANNELS,
  type ThreadRunProjectionSnapshot,
} from "../src/shared/ipc";

const fixedNow = () => new Date("2030-01-01T00:00:00.000Z");

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  readonly sent: string[] = [];
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.({}));
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  receive(data: string): void {
    this.onmessage?.({ data });
  }
}

afterEach(() => {
  FakeWebSocket.instances = [];
});

test("center server client refreshes tokens and forwards events over websocket", async () => {
  const store = createFakeCenterServerStore({
    enabled: true,
    serverUrl: "http://127.0.0.1:8787",
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    deviceSecret: "device_secret",
    refreshToken: "refresh_token",
    accessToken: "expired_access",
    accessTokenExpiresAt: "2020-01-01T00:00:00.000Z",
  });

  const fetchCalls: string[] = [];
  const fetchImpl = async (input: string | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.endsWith("/v1/auth/refresh")) {
      return new Response(
        JSON.stringify({
          accessToken: "fresh_access",
          refreshToken: "fresh_refresh",
          expiresAt: "2030-06-01T00:00:00.000Z",
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  eventCenter.registerCommand(IPC_CHANNELS.threadList, () => [{ id: "thr_1" }]);

  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    fetch: fetchImpl as typeof fetch,
    webSocketConstructor: FakeWebSocket as unknown as new (url: string) => FakeWebSocket,
    now: fixedNow,
    reconnectDelayMs: 60_000,
  });

  await client.start();
  expect(fetchCalls.some((url) => url.endsWith("/v1/auth/refresh"))).toBe(true);
  expect(client.getSnapshot().status.state).toBe("connected");
  expect(FakeWebSocket.instances[0]?.url).toContain("/v1/rpc?access_token=fresh_access");

  eventCenter.publishSettingsUpdated({
    threadId: "settings",
    type: "settings.updated",
    message: "settings saved",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(FakeWebSocket.instances[0]?.sent.length).toBe(1);

  FakeWebSocket.instances[0]?.receive(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "rpc_1",
      method: EVENT_CENTER_JSON_RPC_METHODS.invoke,
      params: {
        channel: IPC_CHANNELS.threadList,
        args: [],
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const lastSent = FakeWebSocket.instances[0]?.sent.at(-1);
  expect(lastSent).toContain(IPC_CHANNELS.threadList);
  expect(lastSent).toContain("thr_1");

  client.dispose();
});

test("center server client throttles mobile streaming projections and sends only the latest snapshot", async () => {
  const store = createConnectedCenterServerStore();
  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    webSocketConstructor: FakeWebSocket as unknown as new (url: string) => FakeWebSocket,
    now: fixedNow,
    mobileStreamingProjectionThrottleMs: 20,
  });

  await client.start();
  eventCenter.publishThreadLiveEvent({
    threadId: "thr_stream",
    type: "message.delta",
    message: "raw delta",
    role: "planner",
    stream: true,
  });
  eventCenter.publishThreadLiveEvent(projectionEvent("first", "message.delta"));
  eventCenter.publishThreadLiveEvent(projectionEvent("latest", "message.delta"));

  expect(FakeWebSocket.instances[0]?.sent).toHaveLength(0);
  await Bun.sleep(30);
  expect(FakeWebSocket.instances[0]?.sent).toHaveLength(1);
  expect(FakeWebSocket.instances[0]?.sent[0]).toContain("latest");
  client.dispose();
});

test("center server client flushes a final projection without waiting for the mobile throttle", async () => {
  const store = createConnectedCenterServerStore();
  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    webSocketConstructor: FakeWebSocket as unknown as new (url: string) => FakeWebSocket,
    now: fixedNow,
    mobileStreamingProjectionThrottleMs: 20,
  });

  await client.start();
  eventCenter.publishThreadLiveEvent(projectionEvent("streaming", "message.delta"));
  eventCenter.publishThreadLiveEvent(projectionEvent("complete", "message.final"));

  expect(FakeWebSocket.instances[0]?.sent).toHaveLength(1);
  expect(FakeWebSocket.instances[0]?.sent[0]).toContain("complete");
  await Bun.sleep(30);
  expect(FakeWebSocket.instances[0]?.sent).toHaveLength(1);
  client.dispose();
});

test("center server client exchanges device secret when refresh token is absent", async () => {
  const store = createFakeCenterServerStore({
    enabled: true,
    serverUrl: "http://127.0.0.1:8787",
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    deviceSecret: "device_secret",
    accessToken: "expired_access",
    accessTokenExpiresAt: "2020-01-01T00:00:00.000Z",
  });

  const fetchImpl = async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/devices/token")) {
      return new Response(
        JSON.stringify({
          device: {
            id: "dev_1",
            userId: "user_1",
            kind: "desktop",
            name: "Eco Desktop",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: null,
            disabledAt: null,
          },
          tokens: {
            accessToken: "device_access",
            refreshToken: "device_refresh",
            expiresAt: "2030-06-01T00:00:00.000Z",
          },
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    fetch: fetchImpl as typeof fetch,
    webSocketConstructor: FakeWebSocket as unknown as new (url: string) => FakeWebSocket,
    now: fixedNow,
    reconnectDelayMs: 60_000,
  });

  await client.start();
  expect(client.getSnapshot().status.state).toBe("connected");
  expect(store.getSettingsWithSecrets().refreshToken).toBe("device_refresh");
  client.dispose();
});

test("start waits for websocket open before reporting connected", async () => {
  const store = createFakeCenterServerStore({
    enabled: true,
    serverUrl: "http://127.0.0.1:8787",
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    deviceSecret: "device_secret",
    accessToken: "fresh_access",
    accessTokenExpiresAt: "2030-06-01T00:00:00.000Z",
  });

  class ManualOpenWebSocket {
    static OPEN = 1;
    static instances: ManualOpenWebSocket[] = [];
    readyState = 0;
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
    readonly url: string;

    constructor(url: string) {
      this.url = url;
      ManualOpenWebSocket.instances.push(this);
    }

    send(): void {}

    open(): void {
      this.readyState = ManualOpenWebSocket.OPEN;
      this.onopen?.({});
    }

    close(): void {}
  }

  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    webSocketConstructor: ManualOpenWebSocket as unknown as new (url: string) => ManualOpenWebSocket,
    now: fixedNow,
    reconnectDelayMs: 60_000,
  });

  const startPromise = client.start();
  await Promise.resolve();
  expect(client.getSnapshot().status.state).toBe("connecting");

  ManualOpenWebSocket.instances[0]?.open();
  await startPromise;
  expect(client.getSnapshot().status.state).toBe("connected");

  client.dispose();
});

test("center server client returns parse errors for malformed json-rpc messages", async () => {
  const store = createFakeCenterServerStore({
    enabled: true,
    serverUrl: "http://127.0.0.1:8787",
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    deviceSecret: "device_secret",
    accessToken: "fresh_access",
    accessTokenExpiresAt: "2030-06-01T00:00:00.000Z",
  });
  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    webSocketConstructor: FakeWebSocket as unknown as new (url: string) => FakeWebSocket,
    now: fixedNow,
    reconnectDelayMs: 60_000,
  });

  await client.start();
  FakeWebSocket.instances[0]?.receive("{");
  await new Promise((resolve) => setTimeout(resolve, 0));

  const lastSent = FakeWebSocket.instances[0]?.sent.at(-1);
  expect(lastSent).toContain("-32700");
  expect(lastSent).toContain("Invalid JSON-RPC JSON payload.");

  client.dispose();
});

test("center server client treats presence notifications as refresh signals", async () => {
  const store = createFakeCenterServerStore({
    enabled: true,
    serverUrl: "http://127.0.0.1:8787",
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    deviceSecret: "device_secret",
    accessToken: "fresh_access",
    accessTokenExpiresAt: "2030-06-01T00:00:00.000Z",
  });
  const statusSnapshots: CenterServerConnectionStatus[] = [];
  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    webSocketConstructor: FakeWebSocket as unknown as new (url: string) => FakeWebSocket,
    now: fixedNow,
    reconnectDelayMs: 60_000,
    onStatusChange: (snapshot) => {
      statusSnapshots.push(snapshot.status);
    },
  });

  await client.start();
  FakeWebSocket.instances[0]?.receive(
    JSON.stringify({
      jsonrpc: "2.0",
      method: ECO_RPC_METHODS.event,
      params: {
        protocolVersion: 1,
        id: "evt_presence",
        kind: "presence.device",
        source: "center-server",
        occurredAt: "2030-01-01T00:00:00.000Z",
        payload: {
          type: "device.online",
          deviceId: "dev_mobile_1",
          deviceKind: "mobile",
          online: true,
          lastSeenAt: "2030-01-01T00:00:00.000Z",
        },
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(statusSnapshots.at(-1)?.state).toBe("connected");
  expect(statusSnapshots.at(-1)?.lastPresenceChangedAt).toBe("2030-01-01T00:00:00.000Z");
  expect(FakeWebSocket.instances[0]?.sent).toHaveLength(0);

  client.dispose();
});

test("center server client reports error instead of staying in connecting after websocket failure", async () => {
  class FailingWebSocket {
    static OPEN = 1;
    readyState = 0;
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onclose: ((event: { code?: number; reason?: string }) => void) | null = null;

    constructor(_url: string) {
      queueMicrotask(() => {
        this.onerror?.({});
        this.onclose?.({ code: 1006, reason: "Connection refused" });
      });
    }

    send(): void {}

    close(): void {}
  }

  const store = createFakeCenterServerStore({
    enabled: true,
    serverUrl: "http://127.0.0.1:8787",
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    deviceSecret: "device_secret",
    accessToken: "fresh_access",
    accessTokenExpiresAt: "2030-06-01T00:00:00.000Z",
  });

  const statusSnapshots: CenterServerConnectionStatus[] = [];
  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    webSocketConstructor: FailingWebSocket as unknown as new (url: string) => FailingWebSocket,
    now: fixedNow,
    reconnectDelayMs: 60_000,
    onStatusChange: (snapshot) => {
      statusSnapshots.push(snapshot.status);
    },
  });

  await client.start();
  expect(client.getSnapshot().status.state).toBe("error");
  expect(client.getSnapshot().status.lastError).toContain("Connection refused");
  expect(statusSnapshots.some((status) => status.state === "connecting")).toBe(true);
  expect(statusSnapshots.at(-1)?.state).toBe("error");

  client.dispose();
});

test("center server client retries connection after failure", async () => {
  let attempt = 0;

  class FlakyWebSocket {
    static OPEN = 1;
    static instances: FlakyWebSocket[] = [];
    readyState = 0;
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onclose: ((event: { code?: number; reason?: string }) => void) | null = null;

    constructor(_url: string) {
      FlakyWebSocket.instances.push(this);
      const currentAttempt = ++attempt;
      queueMicrotask(() => {
        if (currentAttempt === 1) {
          this.onerror?.({});
          this.onclose?.({ code: 1006, reason: "Connection refused" });
          return;
        }
        this.readyState = FlakyWebSocket.OPEN;
        this.onopen?.({});
      });
    }

    send(): void {}

    close(): void {}
  }

  const store = createFakeCenterServerStore({
    enabled: true,
    serverUrl: "http://127.0.0.1:8787",
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    deviceSecret: "device_secret",
    accessToken: "fresh_access",
    accessTokenExpiresAt: "2030-06-01T00:00:00.000Z",
  });

  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    webSocketConstructor: FlakyWebSocket as unknown as new (url: string) => FlakyWebSocket,
    now: fixedNow,
    reconnectDelayMs: 20,
  });

  await client.start();
  expect(client.getSnapshot().status.state).toBe("error");

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(client.getSnapshot().status.state).toBe("connected");
  expect(FlakyWebSocket.instances.length).toBe(2);

  client.dispose();
});

test("center server client lists bindings, presence, and revokes bindings", async () => {
  const store = createFakeCenterServerStore({
    enabled: true,
    serverUrl: "http://127.0.0.1:8787",
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    deviceSecret: "device_secret",
    accessToken: "fresh_access",
    accessTokenExpiresAt: "2030-06-01T00:00:00.000Z",
  });

  const fetchCalls: Array<{ url: string; method: string; authorization?: string }> = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const authorization = new Headers(init?.headers).get("authorization") ?? undefined;
    fetchCalls.push({ url, method, authorization });

    if (url.endsWith("/v1/bindings") && method === "GET") {
      return new Response(
        JSON.stringify({
          bindings: [
            {
              id: "bind_1",
              userId: "user_1",
              desktopDeviceId: "dev_1",
              mobileDeviceId: "dev_mobile_1",
              capabilities: ["events:read", "rpc:invoke"],
              createdAt: "2026-01-01T00:00:00.000Z",
              revokedAt: null,
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/v1/presence") && method === "GET") {
      return new Response(
        JSON.stringify({
          devices: [
            {
              id: "dev_mobile_1",
              userId: "user_1",
              kind: "mobile",
              name: "Eco Mobile",
              createdAt: "2026-01-01T00:00:00.000Z",
              lastSeenAt: "2026-01-02T00:00:00.000Z",
              disabledAt: null,
              online: true,
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/v1/bindings/bind_1") && method === "DELETE") {
      return new Response(
        JSON.stringify({
          binding: {
            id: "bind_1",
            userId: "user_1",
            desktopDeviceId: "dev_1",
            mobileDeviceId: "dev_mobile_1",
            capabilities: ["events:read", "rpc:invoke"],
            createdAt: "2026-01-01T00:00:00.000Z",
            revokedAt: "2026-01-03T00:00:00.000Z",
          },
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };

  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    fetch: fetchImpl as typeof fetch,
    now: fixedNow,
    reconnectDelayMs: 60_000,
  });

  const bindings = await client.listBindings();
  expect(bindings).toHaveLength(1);
  expect(bindings[0]?.mobileDeviceId).toBe("dev_mobile_1");

  const presence = await client.listPresence();
  expect(presence).toHaveLength(1);
  expect(presence[0]?.online).toBe(true);

  const revoked = await client.revokeBinding("bind_1");
  expect(revoked.revokedAt).toBe("2026-01-03T00:00:00.000Z");

  expect(fetchCalls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        url: expect.stringContaining("/v1/bindings"),
        method: "GET",
        authorization: "Bearer fresh_access",
      }),
      expect.objectContaining({
        url: expect.stringContaining("/v1/presence"),
        method: "GET",
        authorization: "Bearer fresh_access",
      }),
      expect.objectContaining({
        url: expect.stringContaining("/v1/bindings/bind_1"),
        method: "DELETE",
        authorization: "Bearer fresh_access",
      }),
    ]),
  );

  client.dispose();
});

test("center server client falls back to device secret when refresh token is invalid", async () => {
  const store = createFakeCenterServerStore({
    enabled: true,
    serverUrl: "http://127.0.0.1:8787",
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    deviceSecret: "device_secret",
    refreshToken: "stale_refresh",
    accessToken: "expired_access",
    accessTokenExpiresAt: "2020-01-01T00:00:00.000Z",
  });

  const fetchCalls: string[] = [];
  const fetchImpl = async (input: string | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.endsWith("/v1/auth/refresh")) {
      return new Response(JSON.stringify({ error: "Refresh token is invalid or expired." }), { status: 401 });
    }
    if (url.endsWith("/v1/devices/token")) {
      return new Response(
        JSON.stringify({
          device: {
            id: "dev_1",
            userId: "user_1",
            kind: "desktop",
            name: "Eco Desktop",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: null,
            disabledAt: null,
          },
          tokens: {
            accessToken: "device_access",
            refreshToken: "device_refresh",
            expiresAt: "2030-06-01T00:00:00.000Z",
          },
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    fetch: fetchImpl as typeof fetch,
    webSocketConstructor: FakeWebSocket as unknown as new (url: string) => FakeWebSocket,
    now: fixedNow,
    reconnectDelayMs: 60_000,
  });

  await client.start();
  expect(fetchCalls.some((url) => url.endsWith("/v1/auth/refresh"))).toBe(true);
  expect(fetchCalls.some((url) => url.endsWith("/v1/devices/token"))).toBe(true);
  expect(client.getSnapshot().status.state).toBe("connected");
  expect(store.getSettingsWithSecrets().refreshToken).toBe("device_refresh");
  client.dispose();
});

test("center server client stops reconnecting when credentials are fully invalid", async () => {
  const store = createFakeCenterServerStore({
    enabled: true,
    serverUrl: "http://127.0.0.1:8787",
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    deviceSecret: "device_secret",
    refreshToken: "stale_refresh",
    accessToken: "expired_access",
    accessTokenExpiresAt: "2020-01-01T00:00:00.000Z",
  });

  const fetchImpl = async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/auth/refresh") || url.endsWith("/v1/devices/token")) {
      return new Response(JSON.stringify({ error: "Refresh token is invalid or expired." }), { status: 401 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    fetch: fetchImpl as typeof fetch,
    webSocketConstructor: FakeWebSocket as unknown as new (url: string) => FakeWebSocket,
    now: fixedNow,
    reconnectDelayMs: 10,
  });

  await client.start();
  expect(client.getSnapshot().status.state).toBe("error");
  expect(client.getSnapshot().status.lastError).toContain("重新登录");

  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(FakeWebSocket.instances.length).toBe(0);
  client.dispose();
});

test("center server client maps invalid device credentials to reauth message", async () => {
  const store = createFakeCenterServerStore({
    enabled: true,
    serverUrl: "http://127.0.0.1:8787",
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    deviceSecret: "device_secret",
    accessToken: "expired_access",
    accessTokenExpiresAt: "2020-01-01T00:00:00.000Z",
  });

  const fetchImpl = async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/devices/token")) {
      return new Response(JSON.stringify({ error: "Device credentials are invalid." }), { status: 401 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    fetch: fetchImpl as typeof fetch,
    webSocketConstructor: FakeWebSocket as unknown as new (url: string) => FakeWebSocket,
    now: fixedNow,
    reconnectDelayMs: 10,
  });

  await client.start();
  expect(client.getSnapshot().status.state).toBe("error");
  expect(client.getSnapshot().status.lastError).toBe("登录已失效，请重新登录。");

  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(FakeWebSocket.instances.length).toBe(0);
  client.dispose();
});

test("center server client removeConnection deletes remote device and clears local config", async () => {
  const store = createFakeCenterServerStore({
    enabled: true,
    serverUrl: "http://127.0.0.1:8787",
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    deviceSecret: "device_secret",
    accessToken: "valid_access",
    accessTokenExpiresAt: "2030-06-01T00:00:00.000Z",
  });

  const calls: string[] = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/v1/devices/dev_1") && init?.method === "DELETE") {
      return new Response(
        JSON.stringify({ device: { id: "dev_1", disabledAt: "2030-01-01T00:00:00.000Z" } }),
        {
          status: 200,
        },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    fetch: fetchImpl as typeof fetch,
    webSocketConstructor: FakeWebSocket as unknown as new (url: string) => FakeWebSocket,
    now: fixedNow,
  });

  const result = await client.removeConnection();
  expect(calls.some((call) => call.startsWith("DELETE"))).toBe(true);
  expect(result.settings.serverUrl).toBe("");
  expect(result.settings.hasDeviceSecret).toBe(false);
  expect(result.status.state).toBe("disabled");
  client.dispose();
});

test("center server client removeConnection skips delete when device is inactive", async () => {
  const store = createFakeCenterServerStore({
    enabled: true,
    serverUrl: "http://127.0.0.1:8787",
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    deviceSecret: "device_secret",
    accessToken: "expired_access",
    accessTokenExpiresAt: "2020-01-01T00:00:00.000Z",
  });

  const fetchImpl = async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/devices/token")) {
      return new Response(JSON.stringify({ error: "Device is not active." }), { status: 401 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    fetch: fetchImpl as typeof fetch,
    webSocketConstructor: FakeWebSocket as unknown as new (url: string) => FakeWebSocket,
    now: fixedNow,
  });

  const result = await client.removeConnection();
  expect(result.settings.serverUrl).toBe("");
  expect(result.notice).toContain("设备已在服务端注销");
  client.dispose();
});

test("center server client removeConnection throws recoverable error when auth fails", async () => {
  const store = createFakeCenterServerStore({
    enabled: true,
    serverUrl: "http://127.0.0.1:8787",
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    deviceSecret: "device_secret",
    accessToken: "expired_access",
    accessTokenExpiresAt: "2020-01-01T00:00:00.000Z",
  });

  const fetchImpl = async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/devices/token")) {
      return new Response(JSON.stringify({ error: "Device credentials are invalid." }), { status: 401 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    fetch: fetchImpl as typeof fetch,
    webSocketConstructor: FakeWebSocket as unknown as new (url: string) => FakeWebSocket,
    now: fixedNow,
  });

  await expect(client.removeConnection()).rejects.toBeInstanceOf(CenterServerRemoveConnectionError);
  expect(store.getSettingsWithSecrets().serverUrl).toBe("http://127.0.0.1:8787");
  client.dispose();
});

test("center server client removeConnection forceLocal clears without network", async () => {
  const store = createFakeCenterServerStore({
    enabled: true,
    serverUrl: "http://127.0.0.1:8787",
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    deviceSecret: "device_secret",
    accessToken: "valid_access",
    accessTokenExpiresAt: "2030-06-01T00:00:00.000Z",
  });

  const fetchImpl = async () => {
    throw new Error("Network unavailable");
  };

  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new CenterServerDesktopClient({
    store,
    eventCenter,
    fetch: fetchImpl as typeof fetch,
    webSocketConstructor: FakeWebSocket as unknown as new (url: string) => FakeWebSocket,
    now: fixedNow,
  });

  const result = await client.removeConnection({ forceLocal: true });
  expect(result.settings.serverUrl).toBe("");
  client.dispose();
});

function createFakeCenterServerStore(initial: Partial<CenterServerSettingsSecret> = {}): CenterServerStore {
  let settings: CenterServerSettingsSecret = {
    enabled: false,
    serverUrl: "",
    deviceName: "Eco Desktop",
    hasDeviceSecret: false,
    hasRefreshToken: false,
    deviceSecret: "",
    accessToken: "",
    refreshToken: "",
    ...initial,
  };
  settings = normalizeFakeSettings(settings);

  const store = {
    getSettings(status: CenterServerConnectionStatus = { state: "disconnected" }) {
      return { settings: toView(settings), status };
    },
    getSettingsWithSecrets() {
      return settings;
    },
    saveSettings(input: Partial<CenterServerSettingsSecret>) {
      settings = normalizeFakeSettings({
        ...settings,
        ...input,
        deviceSecret: input.deviceSecret || settings.deviceSecret,
        refreshToken: input.refreshToken || settings.refreshToken,
      });
      return toView(settings);
    },
    saveTokens(input: { accessToken: string; refreshToken?: string; accessTokenExpiresAt: string }) {
      settings = normalizeFakeSettings({
        ...settings,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken ?? settings.refreshToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
      });
      return toView(settings);
    },
    markConnected(connectedAt: string) {
      settings = {
        ...settings,
        lastConnectedAt: connectedAt,
        lastError: undefined,
      };
    },
    markError(message: string) {
      settings = {
        ...settings,
        lastError: message,
      };
    },
    clearRefreshToken() {
      settings = normalizeFakeSettings({
        ...settings,
        refreshToken: "",
        accessToken: "",
        accessTokenExpiresAt: "",
      });
    },
    clearDeviceCredentials() {
      settings = normalizeFakeSettings({
        ...settings,
        deviceId: "",
        deviceSecret: "",
        refreshToken: "",
        accessToken: "",
        accessTokenExpiresAt: "",
      });
    },
    clearConnection() {
      settings = normalizeFakeSettings({
        enabled: false,
        serverUrl: "",
        deviceName: "Eco Desktop",
        deviceId: "",
        deviceSecret: "",
        refreshToken: "",
        accessToken: "",
        accessTokenExpiresAt: "",
        hasDeviceSecret: false,
        hasRefreshToken: false,
        lastConnectedAt: undefined,
        lastError: undefined,
      });
    },
  };

  return store as unknown as CenterServerStore;
}

function createConnectedCenterServerStore(): CenterServerStore {
  return createFakeCenterServerStore({
    enabled: true,
    serverUrl: "http://127.0.0.1:8787",
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    deviceSecret: "device_secret",
    accessToken: "fresh_access",
    accessTokenExpiresAt: "2030-06-01T00:00:00.000Z",
  });
}

function projectionEvent(
  text: string,
  eventType: "message.delta" | "message.final",
): {
  threadId: string;
  type: "thread.run_projection_updated";
  message: string;
  role: "system";
  stream: false;
  projection: ThreadRunProjectionSnapshot;
} {
  return {
    threadId: "thr_stream",
    type: "thread.run_projection_updated",
    message: "projection updated",
    role: "system",
    stream: false,
    projection: {
      thread: {
        threadId: "thr_stream",
        status: eventType === "message.delta" ? "running" : "idle",
        generatedAt: fixedNow().toISOString(),
      },
      attempts: [],
      agents: [],
      requestSpans: [],
      timeline: [
        {
          id: "stream_item",
          sequence: 1,
          eventType,
          scope: "main",
          text,
          at: fixedNow().toISOString(),
          role: "planner",
        },
      ],
      diagnostics: [],
      sourceEventCount: 1,
    },
  };
}

function normalizeFakeSettings(settings: CenterServerSettingsSecret): CenterServerSettingsSecret {
  return {
    ...settings,
    hasDeviceSecret: Boolean(settings.deviceSecret),
    hasRefreshToken: Boolean(settings.refreshToken),
  };
}

function toView(settings: CenterServerSettingsSecret): CenterServerSettingsView {
  return {
    enabled: settings.enabled,
    serverUrl: settings.serverUrl,
    deviceName: settings.deviceName,
    hasDeviceSecret: Boolean(settings.deviceSecret),
    hasRefreshToken: Boolean(settings.refreshToken),
    ...(settings.deviceId ? { deviceId: settings.deviceId } : {}),
    ...(settings.accessTokenExpiresAt ? { accessTokenExpiresAt: settings.accessTokenExpiresAt } : {}),
    ...(settings.lastConnectedAt ? { lastConnectedAt: settings.lastConnectedAt } : {}),
    ...(settings.lastError ? { lastError: settings.lastError } : {}),
  };
}
