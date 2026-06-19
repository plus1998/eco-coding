import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CenterServerDesktopClient } from "../src/main/center-server-client";
import { createCenterServerStore } from "../src/main/center-server-store";
import { DesktopEventCenter } from "../src/main/event-center";
import {
  EVENT_CENTER_JSON_RPC_METHODS,
  IPC_CHANNELS,
} from "../src/shared/ipc";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

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

test.skipIf(!sqliteAvailable)("center server client refreshes tokens and forwards events over websocket", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-center-server-client-"));
  const store = await createCenterServerStore(path.join(dir, "eco-coding.sqlite"));
  store.saveSettings({
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

test.skipIf(!sqliteAvailable)("center server client exchanges device secret when refresh token is absent", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-center-server-client-"));
  const store = await createCenterServerStore(path.join(dir, "eco-coding.sqlite"));
  store.saveSettings({
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

test.skipIf(!sqliteAvailable)("start waits for websocket open before reporting connected", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-center-server-client-"));
  const store = await createCenterServerStore(path.join(dir, "eco-coding.sqlite"));
  store.saveSettings({
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
