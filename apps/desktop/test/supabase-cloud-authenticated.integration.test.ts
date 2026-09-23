/**
 * Supabase Cloud authenticated contract smoke.
 *
 * Safe by default: without ECO_SUPABASE_CLOUD_* variables every live case is
 * skipped. The read-only cases need only URL + anon key + a disposable test
 * account. Device/binding/Realtime writes require ECO_SUPABASE_CLOUD_WRITE_TESTS=1
 * and must use a disposable account; cleanup disables every device it creates.
 * Never put credentials in this file, a .env committed to the repository, or
 * test output.
 *
 * Example (values supplied by the operator at runtime, never committed):
 *   ECO_SUPABASE_CLOUD_TEST=1 \
 *   ECO_SUPABASE_CLOUD_URL=https://<project>.supabase.co \
 *   ECO_SUPABASE_CLOUD_ANON_KEY=... \
 *   ECO_SUPABASE_CLOUD_EMAIL=... \
 *   ECO_SUPABASE_CLOUD_PASSWORD=... \
 *   ECO_SUPABASE_CLOUD_WRITE_TESTS=1 \
 *   ECO_SUPABASE_CLOUD_DEVICE_SESSION_ENFORCED=1 \
 *   bun test test/supabase-cloud-authenticated.integration.test.ts
 */
import { expect, test } from "bun:test";
import {
  buildEcoBindTopic,
  buildEcoJsonRpcRequest,
  ECO_REALTIME_BROADCAST_EVENT,
  ECO_RPC_METHODS,
  unwrapEcoRpcFromBroadcast,
  wrapEcoRpcForBroadcast,
} from "@eco/shared";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = (process.env.ECO_SUPABASE_CLOUD_URL ?? "").trim().replace(/\/$/, "");
const anonKey = (process.env.ECO_SUPABASE_CLOUD_ANON_KEY ?? "").trim();
const email = (process.env.ECO_SUPABASE_CLOUD_EMAIL ?? "").trim();
const password = process.env.ECO_SUPABASE_CLOUD_PASSWORD ?? "";
const required = process.env.ECO_SUPABASE_CLOUD_TEST === "1";
const writeTests = process.env.ECO_SUPABASE_CLOUD_WRITE_TESTS === "1";
const deviceSessionEnforced = process.env.ECO_SUPABASE_CLOUD_DEVICE_SESSION_ENFORCED === "1";

const publicConfigured = Boolean(supabaseUrl && anonKey);
const authConfigured = publicConfigured && Boolean(email && password);
const writeConfigured = authConfigured && writeTests;

interface JsonResponse {
  response: Response;
  body: unknown;
}

interface AuthSession {
  accessToken: string;
  userId: string;
}

interface RegisteredDevice {
  id: string;
  userId: string;
  kind: "desktop" | "mobile";
  secret: string;
}

function requireConfigured(kind: "public" | "auth"): void {
  if (!required) return;
  const missing = [
    !supabaseUrl && "ECO_SUPABASE_CLOUD_URL",
    !anonKey && "ECO_SUPABASE_CLOUD_ANON_KEY",
    kind === "auth" && !email && "ECO_SUPABASE_CLOUD_EMAIL",
    kind === "auth" && !password && "ECO_SUPABASE_CLOUD_PASSWORD",
  ].filter((value): value is string => Boolean(value));
  if (missing.length > 0) {
    throw new Error(
      `Cloud smoke requested but required environment variables are missing: ${missing.join(", ")}`,
    );
  }
}

async function requestJson(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<JsonResponse> {
  const headers = new Headers(init.headers);
  headers.set("apikey", anonKey);
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Supabase request ${path} failed: ${message}`);
  }
  const raw = await response.text();
  let body: unknown;
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }
  return { response, body };
}

function expectStatus(response: Response, allowed: readonly number[], label: string): void {
  if (!allowed.includes(response.status)) {
    throw new Error(`${label} returned HTTP ${response.status}; expected ${allowed.join(" or ")}.`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function signIn(): Promise<AuthSession> {
  const { response, body } = await requestJson("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const errorBody = asRecord(body);
    const code =
      typeof errorBody.code === "string"
        ? errorBody.code
        : typeof errorBody.error_code === "string"
          ? errorBody.error_code
          : "unknown";
    const message =
      typeof errorBody.msg === "string"
        ? errorBody.msg
        : typeof errorBody.message === "string"
          ? errorBody.message
          : typeof errorBody.error_description === "string"
            ? errorBody.error_description
            : typeof errorBody.error === "string"
              ? errorBody.error
              : "unknown";
    throw new Error(`Supabase password sign-in failed with HTTP ${response.status} (${code}: ${message}).`);
  }
  const record = asRecord(body);
  const accessToken = typeof record.access_token === "string" ? record.access_token : "";
  const user = asRecord(record.user);
  const userId = typeof user.id === "string" ? user.id : "";
  if (!accessToken || !userId) {
    throw new Error("Supabase password sign-in returned no session user.");
  }
  return { accessToken, userId };
}

async function registerDevice(
  session: AuthSession,
  kind: RegisteredDevice["kind"],
  name: string,
): Promise<RegisteredDevice> {
  const { response, body } = await requestJson(
    "/functions/v1/device-register",
    {
      method: "POST",
      body: JSON.stringify({ kind, name, metadata: { source: "supabase-cloud-authenticated-smoke" } }),
    },
    session.accessToken,
  );
  expectStatus(response, [201], `${kind} device-register`);
  const record = asRecord(body);
  const device = asRecord(record.device);
  const id = typeof device.id === "string" ? device.id : "";
  const userId = typeof device.userId === "string" ? device.userId : "";
  const secret = typeof record.deviceSecret === "string" ? record.deviceSecret : "";
  if (!id || !userId || !secret) throw new Error(`${kind} device-register returned incomplete device data.`);
  return { id, userId, kind, secret };
}

async function registerDeviceSession(session: AuthSession, device: RegisteredDevice): Promise<void> {
  const { response } = await requestJson(
    "/functions/v1/device-session-register",
    {
      method: "POST",
      body: JSON.stringify({ deviceId: device.id, deviceSecret: device.secret, kind: device.kind }),
    },
    session.accessToken,
  );
  expectStatus(response, [200], `${device.kind} device-session-register`);
}

async function ensureBinding(
  session: AuthSession,
  mobile: RegisteredDevice,
  desktop: RegisteredDevice,
): Promise<{ id: string; capabilities: string[] }> {
  const { response, body } = await requestJson(
    "/functions/v1/binding-ensure",
    {
      method: "POST",
      body: JSON.stringify({
        mobileDeviceId: mobile.id,
        deviceSecret: mobile.secret,
        desktopDeviceId: desktop.id,
      }),
    },
    session.accessToken,
  );
  expectStatus(response, [200], "binding-ensure");
  const binding = asRecord(asRecord(body).binding);
  const id = typeof binding.id === "string" ? binding.id : "";
  const capabilities = Array.isArray(binding.capabilities)
    ? binding.capabilities.filter((value): value is string => typeof value === "string")
    : [];
  if (!id) throw new Error("binding-ensure returned no binding id.");
  return { id, capabilities };
}

async function disableDevice(session: AuthSession, device: RegisteredDevice): Promise<void> {
  const { response } = await requestJson(
    "/functions/v1/device-disable",
    {
      method: "POST",
      body: JSON.stringify({ deviceId: device.id, deviceSecret: device.secret, kind: device.kind }),
    },
    session.accessToken,
  );
  expectStatus(response, [200], `${device.kind} device-disable cleanup`);
}

async function createRealtimeClient(session: AuthSession): Promise<SupabaseClient> {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  await client.realtime.setAuth(session.accessToken);
  return client;
}

function subscribe(channel: RealtimeChannel, topic: string, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Realtime channel ${topic} did not subscribe within ${timeoutMs}ms.`)),
      timeoutMs,
    );
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(timeout);
        reject(new Error(`Realtime channel ${topic} failed with status ${status}${error ? "." : ""}`));
      }
    });
  });
}

const publicTest = publicConfigured || required ? test : test.skip;
const authTest = authConfigured || required ? test : test.skip;
const writeTest = writeConfigured ? test : test.skip;

publicTest("Supabase Cloud public/protected function boundary", async () => {
  requireConfigured("public");

  const probe = await requestJson("/functions/v1/html-host-probe");
  expectStatus(probe.response, [200], "html-host-probe");

  const unauthenticated = await requestJson("/functions/v1/device-register", {
    method: "POST",
    body: JSON.stringify({ kind: "desktop", name: "unauthenticated-smoke" }),
  });
  expectStatus(unauthenticated.response, [401], "unauthenticated device-register");
});

authTest("Supabase Cloud password auth and settings CAS conflict are live", async () => {
  requireConfigured("auth");
  const first = await signIn();
  const second = await signIn();
  expect(first.userId).toBe(second.userId);
  expect(first.accessToken).not.toBe(second.accessToken);

  const settings = await requestJson(
    `/rest/v1/user_settings?select=revision&user_id=eq.${encodeURIComponent(first.userId)}`,
    {},
    first.accessToken,
  );
  expectStatus(settings.response, [200], "settings read before CAS");

  // expected_revision=0 is stale for both an existing row and a first insert;
  // the RPC must reject it before changing account settings.
  const cas = await requestJson(
    "/rest/v1/rpc/eco_replace_account_config",
    {
      method: "POST",
      body: JSON.stringify({
        p_payload: { version: 1, source: "cloud-cas-conflict-smoke" },
        p_expected_revision: 0,
        p_secrets: [],
      }),
    },
    first.accessToken,
  );
  if (deviceSessionEnforced) {
    expectStatus(cas.response, [400, 401, 403], "unbound settings CAS");
    const casError = asRecord(cas.body);
    expect(casError.message).toContain("active Eco device");
  } else {
    expectStatus(cas.response, [400, 409], "stale settings CAS");
    const casError = asRecord(cas.body);
    expect(casError.code).toBe("PT409");
    expect(casError.message).toContain("settings_sync_conflict");
  }
});

writeTest(
  "Supabase Cloud device sessions, binding idempotency, and Realtime broadcast roundtrip",
  async () => {
    requireConfigured("auth");
    if (!writeTests) {
      throw new Error("Cloud write smoke requested but ECO_SUPABASE_CLOUD_WRITE_TESTS=1 is not set.");
    }
    const desktopSession = await signIn();
    const mobileSession = await signIn();
    expect(desktopSession.userId).toBe(mobileSession.userId);

    let desktop: RegisteredDevice | undefined;
    let mobile: RegisteredDevice | undefined;
    let desktopClient: SupabaseClient | undefined;
    let mobileClient: SupabaseClient | undefined;
    let unboundClient: SupabaseClient | undefined;
    let desktopChannel: RealtimeChannel | undefined;
    let mobileChannel: RealtimeChannel | undefined;

    try {
      const suffix = crypto.randomUUID().slice(0, 8);
      desktop = await registerDevice(desktopSession, "desktop", `v2-cloud-desktop-${suffix}`);
      mobile = await registerDevice(mobileSession, "mobile", `v2-cloud-mobile-${suffix}`);
      expect(desktop.userId).toBe(desktopSession.userId);
      expect(mobile.userId).toBe(mobileSession.userId);

      await registerDeviceSession(desktopSession, desktop);
      await registerDeviceSession(mobileSession, mobile);
      console.log("cloud-smoke: sessions registered");

      const binding = await ensureBinding(mobileSession, mobile, desktop);
      expect(binding.capabilities).toEqual(
        expect.arrayContaining(["events:read", "rpc:invoke", "approval:decide"]),
      );
      const repeated = await ensureBinding(mobileSession, mobile, desktop);
      expect(repeated.id).toBe(binding.id);
      console.log("cloud-smoke: binding ensured");

      const settings = await requestJson(
        `/rest/v1/user_settings?select=revision&user_id=eq.${encodeURIComponent(desktopSession.userId)}`,
        {},
        desktopSession.accessToken,
      );
      expectStatus(settings.response, [200], "bound settings read before CAS");
      const settingsRows = Array.isArray(settings.body) ? settings.body : [];
      if (settingsRows.length !== 1) {
        throw new Error(`Bound settings read returned ${settingsRows.length} rows; expected exactly one.`);
      }
      const revision = Number(asRecord(settingsRows[0]).revision);
      if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new Error("Bound settings read returned an invalid revision.");
      }

      const staleCas = await requestJson(
        "/rest/v1/rpc/eco_replace_account_config",
        {
          method: "POST",
          body: JSON.stringify({
            p_payload: { version: 1, source: "cloud-bound-cas-conflict-smoke" },
            p_expected_revision: revision - 1,
            p_secrets: [],
          }),
        },
        desktopSession.accessToken,
      );
      expectStatus(staleCas.response, [409], "bound stale settings CAS");
      const staleCasError = asRecord(staleCas.body);
      expect(staleCasError.code).toBe("PT409");
      expect(staleCasError.message).toContain("settings_sync_conflict");

      const settingsAfterCas = await requestJson(
        `/rest/v1/user_settings?select=revision&user_id=eq.${encodeURIComponent(desktopSession.userId)}`,
        {},
        desktopSession.accessToken,
      );
      expectStatus(settingsAfterCas.response, [200], "bound settings read after CAS conflict");
      expect(settingsAfterCas.body).toEqual([{ revision }]);
      console.log("cloud-smoke: bound CAS conflict confirmed without changing revision");

      const mobileBindings = await requestJson(
        `/rest/v1/device_bindings?select=id&user_id=eq.${encodeURIComponent(mobileSession.userId)}`,
        {},
        mobileSession.accessToken,
      );
      expectStatus(mobileBindings.response, [200], "bound device binding read");
      expect(mobileBindings.body).toEqual(expect.arrayContaining([{ id: binding.id }]));

      const unboundSession = await signIn();
      const unboundBindings = await requestJson(
        `/rest/v1/device_bindings?select=id&user_id=eq.${encodeURIComponent(unboundSession.userId)}`,
        {},
        unboundSession.accessToken,
      );
      expectStatus(unboundBindings.response, [200], "unbound device binding read");
      if (deviceSessionEnforced) {
        expect(unboundBindings.body).toEqual([]);
      } else {
        expect(unboundBindings.body).toEqual(expect.arrayContaining([{ id: binding.id }]));
      }
      console.log("cloud-smoke: binding RLS checked");

      desktopClient = await createRealtimeClient(desktopSession);
      mobileClient = await createRealtimeClient(mobileSession);
      const topic = buildEcoBindTopic(binding.id);
      let received: unknown;
      let receive: ((value: unknown) => void) | undefined;
      const receivedPromise = new Promise<unknown>((resolve) => {
        receive = resolve;
      });
      mobileChannel = mobileClient.channel(topic, { config: { private: true, broadcast: { self: false } } });
      mobileChannel.on("broadcast", { event: ECO_REALTIME_BROADCAST_EVENT }, (payload) => {
        const raw =
          payload && typeof payload === "object" && "payload" in payload ? payload.payload : payload;
        const message = unwrapEcoRpcFromBroadcast(raw);
        if (message) {
          received = message;
          receive?.(message);
        }
      });
      console.log("cloud-smoke: subscribing mobile");
      await subscribe(mobileChannel, topic);
      console.log("cloud-smoke: mobile subscribed");

      desktopChannel = desktopClient.channel(topic, {
        config: { private: true, broadcast: { self: false } },
      });
      console.log("cloud-smoke: subscribing desktop");
      await subscribe(desktopChannel, topic);
      console.log("cloud-smoke: desktop subscribed");
      const request = buildEcoJsonRpcRequest(`cloud-smoke-${suffix}`, ECO_RPC_METHODS.ping, {
        source: "supabase-cloud-authenticated-smoke",
      });
      const sendStatus = await desktopChannel.send({
        type: "broadcast",
        event: ECO_REALTIME_BROADCAST_EVENT,
        payload: wrapEcoRpcForBroadcast(request),
      });
      console.log("cloud-smoke: sent broadcast", sendStatus);
      expect(sendStatus).toBe("ok");
      await Promise.race([
        receivedPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Realtime broadcast was not received within 10s.")), 10_000),
        ),
      ]);
      expect(received).toEqual(request);
      console.log("cloud-smoke: received broadcast");

      if (deviceSessionEnforced) {
        unboundClient = await createRealtimeClient(unboundSession);
        const unboundChannel = unboundClient.channel(topic, {
          config: { private: true, broadcast: { self: false } },
        });
        console.log("cloud-smoke: subscribing unbound");
        await expect(subscribe(unboundChannel, topic, 1_500)).rejects.toThrow();
        console.log("cloud-smoke: unbound rejected");
        await unboundClient.removeChannel(unboundChannel).catch(() => undefined);
      }
    } finally {
      if (desktopChannel && desktopClient)
        await desktopClient.removeChannel(desktopChannel).catch(() => undefined);
      if (mobileChannel && mobileClient)
        await mobileClient.removeChannel(mobileChannel).catch(() => undefined);
      if (desktopClient) await desktopClient.removeAllChannels().catch(() => undefined);
      if (mobileClient) await mobileClient.removeAllChannels().catch(() => undefined);
      if (unboundClient) await unboundClient.removeAllChannels().catch(() => undefined);
      if (mobile) await disableDevice(mobileSession, mobile);
      if (desktop) await disableDevice(desktopSession, desktop);
    }
  },
);
