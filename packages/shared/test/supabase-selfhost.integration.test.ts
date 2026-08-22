/**
 * Integration smoke against a running self-hosted Supabase (raw fetch, no SDK).
 *
 * Env:
 *   ECO_SUPABASE_URL (default http://127.0.0.1:8000)
 *   ECO_SUPABASE_ANON_KEY or ECO_SELFHOST_ENV (.env with ANON_KEY=)
 */
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

function readAnonFromEnvFile(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  const text = readFileSync(filePath, "utf8");
  const match = text.match(/^ANON_KEY=(.+)$/m);
  return match?.[1]?.trim();
}

const defaultEnvPath =
  process.env.ECO_SELFHOST_ENV ?? "C:/Users/admin/Documents/supabase-eco-selfhost/supabase-project/.env";

const supabaseUrl = (process.env.ECO_SUPABASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const anonKey = process.env.ECO_SUPABASE_ANON_KEY?.trim() || readAnonFromEnvFile(defaultEnvPath) || "";

async function authHealthy(): Promise<boolean> {
  if (!anonKey) return false;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function signUp(email: string, password: string): Promise<{ accessToken: string; userId: string }> {
  const res = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json()) as {
    access_token?: string;
    user?: { id?: string };
    msg?: string;
  };
  if (!res.ok || !body.access_token || !body.user?.id) {
    throw new Error(`signup failed ${res.status}: ${JSON.stringify(body)}`);
  }
  return { accessToken: body.access_token, userId: body.user.id };
}

const healthy = await authHealthy();
const it = healthy ? test : test.skip;

it("local supabase: signup, device-register, settings, secrets, device-disable", async () => {
  expect(anonKey.length).toBeGreaterThan(20);
  const email = `eco-it-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const { accessToken, userId } = await signUp(email, "EcoIntegrationTest123!");

  const registerRes = await fetch(`${supabaseUrl}/functions/v1/device-register`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ kind: "desktop", name: "IT Desktop", metadata: { platform: "test" } }),
  });
  expect(registerRes.status).toBe(201);
  const registered = (await registerRes.json()) as {
    device: { id: string; userId: string };
    deviceSecret: string;
  };
  expect(registered.device.id).toBeTruthy();
  expect(registered.deviceSecret).toBeTruthy();
  expect(registered.device.userId).toBe(userId);

  const settingsRes = await fetch(`${supabaseUrl}/rest/v1/user_settings`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      user_id: userId,
      payload: { asrLanguage: "zh", modelPrefs: { temperature: 0.2 } },
      updated_at: new Date().toISOString(),
    }),
  });
  expect(settingsRes.ok).toBe(true);

  const settingsGet = await fetch(
    `${supabaseUrl}/rest/v1/user_settings?user_id=eq.${userId}&select=payload`,
    {
      headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` },
    },
  );
  const settingsRows = (await settingsGet.json()) as Array<{ payload: { asrLanguage?: string } }>;
  expect(settingsRows[0]?.payload?.asrLanguage).toBe("zh");

  const secretsRes = await fetch(`${supabaseUrl}/rest/v1/user_secrets`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      user_id: userId,
      secret_kind: "provider_api_key",
      secret_key: "test",
      ciphertext: "cipher-not-real",
      nonce: "nonce-not-real",
      updated_at: new Date().toISOString(),
    }),
  });
  expect(secretsRes.ok).toBe(true);

  const disableRes = await fetch(`${supabaseUrl}/functions/v1/device-disable`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deviceId: registered.device.id,
      deviceSecret: registered.deviceSecret,
      kind: "desktop",
    }),
  });
  expect([200, 201]).toContain(disableRes.status);
});

it("local supabase: pairing-create returns code + bootstrapToken", async () => {
  const email = `eco-pair-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const { accessToken } = await signUp(email, "EcoIntegrationTest123!");

  const registerRes = await fetch(`${supabaseUrl}/functions/v1/device-register`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ kind: "desktop", name: "Pair Desktop" }),
  });
  const registered = (await registerRes.json()) as {
    device: { id: string };
    deviceSecret: string;
  };

  const pairRes = await fetch(`${supabaseUrl}/functions/v1/pairing-create`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      desktopDeviceId: registered.device.id,
      deviceSecret: registered.deviceSecret,
    }),
  });
  expect(pairRes.status).toBe(200);
  const pairing = (await pairRes.json()) as {
    pairingId: string;
    code: string;
    bootstrapToken: string;
  };
  expect(pairing.pairingId).toBeTruthy();
  expect(pairing.code).toBeTruthy();
  expect(pairing.bootstrapToken).toBeTruthy();
});
