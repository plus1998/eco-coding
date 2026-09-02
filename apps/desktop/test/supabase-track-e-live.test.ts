/**
 * Integration smoke against local self-hosted Supabase (Track E).
 *
 * Reads ANON_KEY from:
 *   C:\Users\admin\Documents\supabase-eco-selfhost\supabase-project\.env
 *
 * Skips automatically when the gateway is unreachable.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decryptSecretWithVaultKey, encryptSecretWithVaultKey, generateVaultKey } from "@eco/shared";
import { createClient } from "@supabase/supabase-js";
import {
  type EcoSyncedSettingsPayload,
  pullUserSecrets,
  pullUserSettings,
  pushUserSettings,
  upsertEncryptedSecret,
} from "../src/main/supabase-settings-sync";

const SUPABASE_URL = "http://127.0.0.1:8000";
const ENV_PATH = "C:\\Users\\admin\\Documents\\supabase-eco-selfhost\\supabase-project\\.env";

function readAnonKeyFromEnvFile(): string | null {
  try {
    const text = readFileSync(ENV_PATH, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const match = trimmed.match(/^ANON_KEY=(.*)$/);
      if (match) {
        const value = match[1]!.trim().replace(/^["']|["']$/g, "");
        return value || null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function supabaseReachable(anonKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

const anonKey = readAnonKeyFromEnvFile();
const live = anonKey ? await supabaseReachable(anonKey) : false;

test.skipIf(!live)("live: user_settings upsert + user_secrets encrypt roundtrip", async () => {
  if (!anonKey) {
    throw new Error("ANON_KEY missing");
  }

  const email = `track-e-${Date.now()}@example.com`;
  const password = "TrackE-test-password-1!";
  const client = createClient(SUPABASE_URL, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: signedUp, error: signUpError } = await client.auth.signUp({ email, password });
  expect(signUpError).toBeNull();
  expect(signedUp.session?.access_token).toBeTruthy();
  const userId = signedUp.user?.id;
  expect(userId).toBeTruthy();

  const payload: EcoSyncedSettingsPayload = {
    version: 1,
    providers: [
      {
        id: "prov_live_1",
        name: "Live Provider",
        baseUrl: "https://api.example.com",
        requestPath: "",
        version: "v1",
        apiCompat: "openai",
        defaultModel: "gpt-test",
        enabled: true,
      },
    ],
    asr: { activeProfileId: "", profiles: [] },
    imageGeneration: { enabled: false, activeProfileId: "", profiles: [] },
  };

  const pushed = await pushUserSettings(client, userId!, payload);
  expect(pushed.revision).toBeGreaterThanOrEqual(1);

  const pulled = await pullUserSettings(client, userId!);
  expect(pulled?.payload).toMatchObject(payload);

  const vaultKey = await generateVaultKey();
  const plaintext = "sk-integration-secret-xyz";
  await upsertEncryptedSecret(client, {
    userId: userId!,
    kind: "provider",
    key: "prov_live_1",
    vaultKey,
    plaintext,
  });

  const secrets = await pullUserSecrets(client, userId!);
  expect(secrets.length).toBe(1);
  const row = secrets[0]!;
  expect(row.ciphertext).not.toContain(plaintext);
  expect(await decryptSecretWithVaultKey(vaultKey, row.ciphertext, row.nonce)).toBe(plaintext);

  // Wrong key must fail
  const other = await generateVaultKey();
  await expect(decryptSecretWithVaultKey(other, row.ciphertext, row.nonce)).rejects.toThrow();

  // Also verify encrypt helper independently
  const sealed = await encryptSecretWithVaultKey(vaultKey, plaintext);
  expect(await decryptSecretWithVaultKey(vaultKey, sealed.ciphertext, sealed.nonce)).toBe(plaintext);

  await client.auth.signOut();
});

test.skipIf(!live)("live: second session same user can pull settings", async () => {
  if (!anonKey) {
    throw new Error("ANON_KEY missing");
  }

  const email = `track-e-multi-${Date.now()}@example.com`;
  const password = "TrackE-test-password-2!";

  const deviceA = createClient(SUPABASE_URL, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: signedUp, error: signUpError } = await deviceA.auth.signUp({ email, password });
  expect(signUpError).toBeNull();
  const userId = signedUp.user?.id;
  expect(userId).toBeTruthy();

  const payload: EcoSyncedSettingsPayload = {
    version: 1,
    providers: [
      {
        id: "prov_a",
        name: "From Device A",
        baseUrl: "https://a.example.com",
        requestPath: "/v1",
        version: "v1",
        apiCompat: "anthropic",
        defaultModel: "claude-test",
        enabled: true,
      },
    ],
    asr: { activeProfileId: "asr1", profiles: [] },
    imageGeneration: { enabled: false, activeProfileId: "", profiles: [] },
  };
  await pushUserSettings(deviceA, userId!, payload);

  const deviceB = createClient(SUPABASE_URL, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: signedIn, error: signInError } = await deviceB.auth.signInWithPassword({
    email,
    password,
  });
  expect(signInError).toBeNull();
  expect(signedIn.session).toBeTruthy();

  const pulled = await pullUserSettings(deviceB, userId!);
  expect(pulled?.payload).toMatchObject(payload);

  await deviceA.auth.signOut();
  await deviceB.auth.signOut();
});
