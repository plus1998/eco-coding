import { expect, test } from "bun:test";
import { SupabaseCenterDesktopClient } from "../src/main/supabase-center-client";
import type { CenterServerSettingsSecret, CenterServerStore } from "../src/main/center-server-store";
import { DesktopEventCenter } from "../src/main/event-center";
import type { CenterServerConnectionStatus, CenterServerSettingsView } from "../src/shared/center-server";

const fixedNow = () => new Date("2030-01-01T00:00:00.000Z");
const USER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const DEVICE_ID = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

/** Minimal JWT so @supabase/supabase-js setSession accepts the token structure. */
function testAccessJwt(sub = USER_ID): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      role: "authenticated",
      aud: "authenticated",
      exp: Math.floor(fixedNow().getTime() / 1000) + 3600,
      iat: Math.floor(fixedNow().getTime() / 1000),
    }),
  ).toString("base64url");
  return `${header}.${payload}.test_sig`;
}

const ACCESS_JWT = testAccessJwt();

test("supabase center client signs in, registers device, and marks connected", async () => {
  const store = createFakeStore();
  const fetchCalls: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.includes("/auth/v1/token") || url.includes("/auth/v1/signup")) {
      return jsonResponse({
        access_token: ACCESS_JWT,
        refresh_token: "refresh_jwt",
        expires_in: 3600,
        expires_at: Math.floor(fixedNow().getTime() / 1000) + 3600,
        token_type: "bearer",
        user: authUser(),
      });
    }
    if (url.includes("/functions/v1/device-register")) {
      expect(init?.headers && new Headers(init.headers).get("authorization")).toContain(ACCESS_JWT);
      return jsonResponse({
        device: {
          id: DEVICE_ID,
          user_id: USER_ID,
          kind: "desktop",
          name: "Eco Desktop",
          metadata: { hostname: "host", platform: "win32" },
          created_at: "2030-01-01T00:00:00.000Z",
          last_seen_at: null,
          disabled_at: null,
        },
        device_secret: "device_secret_once",
      });
    }
    if (url.includes("/auth/v1/user")) {
      return jsonResponse(authUser());
    }
    if (url.includes("/rest/v1/device_bindings")) {
      return jsonResponse([]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const eventCenter = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const client = new SupabaseCenterDesktopClient({
    store,
    eventCenter,
    fetch: fetchImpl as typeof fetch,
    now: fixedNow,
  });

  const result = await client.signInAndRegisterDesktop({
    supabaseUrl: "https://example.supabase.co",
    anonKey: "anon_key",
    email: "you@example.com",
    password: "secret",
    deviceName: "Eco Desktop",
  });

  expect(result.device.id).toBe(DEVICE_ID);
  expect(result.user.email).toBe("you@example.com");
  expect(result.settings.hasDeviceSecret).toBe(true);
  expect(result.settings.supabaseUrl).toBe("https://example.supabase.co");
  expect(store.getSettingsWithSecrets().deviceSecret).toBe("device_secret_once");
  expect(store.getSettingsWithSecrets().anonKey).toBe("anon_key");
  expect(client.getSnapshot().status.state).toBe("connected");
  expect(fetchCalls.some((url) => url.includes("device-register"))).toBe(true);
  expect(fetchCalls.some((url) => url.includes("/rest/v1/device_bindings"))).toBe(true);

  client.dispose();
});

test("supabase center client testConnection hits auth health", async () => {
  const store = createFakeStore({
    supabaseUrl: "https://example.supabase.co",
    anonKey: "stored_anon",
  });
  const client = new SupabaseCenterDesktopClient({
    store,
    eventCenter: new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" }),
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("/auth/v1/health");
      return jsonResponse({ version: "v1", name: "GoTrue" });
    }) as typeof fetch,
    now: fixedNow,
  });

  const result = await client.testConnection({
    supabaseUrl: "https://example.supabase.co",
    anonKey: "",
  });
  expect(result.ok).toBe(true);
  client.dispose();
});

test("supabase center client createPairing invokes pairing-create and builds supabase QR", async () => {
  const store = createFakeStore({
    enabled: true,
    supabaseUrl: "https://example.supabase.co",
    anonKey: "anon_key",
    deviceId: DEVICE_ID,
    deviceSecret: "device_secret_once",
    accessToken: ACCESS_JWT,
    refreshToken: "refresh_jwt",
    accessTokenExpiresAt: "2030-01-01T01:00:00.000Z",
  });

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return jsonResponse(authUser());
    }
    if (url.includes("/rest/v1/device_bindings")) {
      return jsonResponse([]);
    }
    if (url.includes("/functions/v1/pairing-create")) {
      expect(init?.method?.toUpperCase() || "POST").toBe("POST");
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      expect(body.desktopDeviceId).toBe(DEVICE_ID);
      expect(body.deviceSecret).toBe("device_secret_once");
      return jsonResponse({
        pairingId: "c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        code: "ABCD1234",
        bootstrapToken: "boot_token",
        expiresAt: "2030-01-01T00:05:00.000Z",
        qrPayload: "eco://pair?code=ABCD1234",
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const client = new SupabaseCenterDesktopClient({
    store,
    eventCenter: new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" }),
    fetch: fetchImpl as typeof fetch,
    now: fixedNow,
  });

  await client.start();
  expect(client.getSnapshot().status.state).toBe("connected");

  const pairing = await client.createPairing();
  expect(pairing.code).toBe("ABCD1234");
  expect(pairing.bootstrapToken).toBe("boot_token");
  expect(pairing.qrPayload).toContain("supabase=");
  expect(pairing.qrPayload).toContain("anon=");
  expect(pairing.qrPayload).toContain("code=ABCD1234");
  expect(pairing.qrPayload).toContain("token=boot_token");
  expect(pairing.qrPayload).not.toContain("server=");

  client.dispose();
});

function authUser() {
  return {
    id: USER_ID,
    email: "you@example.com",
    created_at: "2030-01-01T00:00:00.000Z",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: { display_name: "You" },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFakeStore(initial: Partial<CenterServerSettingsSecret> = {}): CenterServerStore {
  let settings: CenterServerSettingsSecret = {
    enabled: false,
    supabaseUrl: "",
    serverUrl: "",
    hasAnonKey: false,
    anonKey: "",
    deviceName: "Eco Desktop",
    hasDeviceSecret: false,
    hasRefreshToken: false,
    hasVaultKey: false,
    deviceSecret: "",
    accessToken: "",
    refreshToken: "",
    vaultKey: "",
    ...initial,
  };
  settings = normalize(settings);

  return {
    getSettings(status: CenterServerConnectionStatus = { state: "disconnected" }) {
      return { settings: toView(settings), status };
    },
    getSettingsWithSecrets() {
      return settings;
    },
    getVaultKey() {
      return settings.vaultKey;
    },
    saveVaultKey(vaultKey: string) {
      settings = normalize({ ...settings, vaultKey });
    },
    clearVaultKey() {
      settings = normalize({ ...settings, vaultKey: "" });
    },
    markSettingsSynced(syncedAt: string) {
      settings = { ...settings, lastSettingsSyncedAt: syncedAt };
    },
    saveSettings(input: Partial<CenterServerSettingsSecret> & { anonKey?: string }) {
      settings = normalize({
        ...settings,
        ...input,
        anonKey: input.anonKey && input.anonKey.length > 0 ? input.anonKey : settings.anonKey,
        deviceSecret: input.deviceSecret || settings.deviceSecret,
        refreshToken: input.refreshToken || settings.refreshToken,
      });
      return toView(settings);
    },
    saveTokens(input: { accessToken: string; refreshToken?: string; accessTokenExpiresAt: string }) {
      settings = normalize({
        ...settings,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken ?? settings.refreshToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
      });
      return toView(settings);
    },
    markConnected(connectedAt: string) {
      settings = { ...settings, lastConnectedAt: connectedAt, lastError: undefined };
    },
    markError(message: string) {
      settings = { ...settings, lastError: message };
    },
    clearRefreshToken() {
      settings = normalize({
        ...settings,
        refreshToken: "",
        accessToken: "",
        accessTokenExpiresAt: "",
      });
    },
    clearDeviceCredentials() {
      settings = normalize({
        ...settings,
        deviceId: "",
        deviceSecret: "",
        refreshToken: "",
        accessToken: "",
        accessTokenExpiresAt: "",
        vaultKey: "",
      });
    },
    clearConnection() {
      settings = normalize({
        enabled: false,
        supabaseUrl: "",
        serverUrl: "",
        hasAnonKey: false,
        anonKey: "",
        deviceName: "Eco Desktop",
        deviceId: "",
        deviceSecret: "",
        refreshToken: "",
        accessToken: "",
        accessTokenExpiresAt: "",
        vaultKey: "",
        hasDeviceSecret: false,
        hasRefreshToken: false,
        hasVaultKey: false,
      });
    },
  } as unknown as CenterServerStore;
}

function normalize(settings: CenterServerSettingsSecret): CenterServerSettingsSecret {
  const supabaseUrl = settings.supabaseUrl || settings.serverUrl || "";
  return {
    ...settings,
    supabaseUrl,
    serverUrl: supabaseUrl,
    hasAnonKey: Boolean(settings.anonKey),
    hasDeviceSecret: Boolean(settings.deviceSecret),
    hasRefreshToken: Boolean(settings.refreshToken),
    hasVaultKey: Boolean(settings.vaultKey),
  };
}

function toView(settings: CenterServerSettingsSecret): CenterServerSettingsView {
  return {
    enabled: settings.enabled,
    supabaseUrl: settings.supabaseUrl,
    serverUrl: settings.serverUrl,
    hasAnonKey: Boolean(settings.anonKey),
    deviceName: settings.deviceName,
    hasDeviceSecret: Boolean(settings.deviceSecret),
    hasRefreshToken: Boolean(settings.refreshToken),
    hasVaultKey: Boolean(settings.vaultKey),
    ...(settings.deviceId ? { deviceId: settings.deviceId } : {}),
    ...(settings.accessTokenExpiresAt ? { accessTokenExpiresAt: settings.accessTokenExpiresAt } : {}),
    ...(settings.lastConnectedAt ? { lastConnectedAt: settings.lastConnectedAt } : {}),
    ...(settings.lastSettingsSyncedAt ? { lastSettingsSyncedAt: settings.lastSettingsSyncedAt } : {}),
    ...(settings.lastError ? { lastError: settings.lastError } : {}),
  };
}
