/**
 * Account-level settings + secrets sync against Supabase Center (Track E).
 *
 * - `user_settings.payload`: non-secret provider / ASR / image metadata JSON
 * - `user_secrets`: AES-GCM ciphertext of API keys under local vault_key
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decryptSecretWithVaultKey,
  encryptSecretWithVaultKey,
  generateVaultKey,
} from "@eco/shared";

export const ECO_SYNCED_SETTINGS_VERSION = 1 as const;

export type EcoSecretKind = "provider" | "asr" | "image";

export interface EcoSyncedProvider {
  id: string;
  name: string;
  baseUrl: string;
  requestPath: string;
  version: string;
  apiCompat: string;
  tokenCountMode?: string;
  defaultModel: string;
  enabled: boolean;
}

export interface EcoSyncedAsrProfile {
  id: string;
  name: string;
  endpoint: string;
  apiMode: string;
  model: string;
  systemPrompt: string;
}

export interface EcoSyncedImageProfile {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  model: string;
}

export interface EcoSyncedSettingsPayload {
  version: typeof ECO_SYNCED_SETTINGS_VERSION;
  providers: EcoSyncedProvider[];
  asr: {
    activeProfileId: string;
    profiles: EcoSyncedAsrProfile[];
  };
  imageGeneration: {
    enabled: boolean;
    activeProfileId: string;
    profiles: EcoSyncedImageProfile[];
  };
}

export interface EcoPlainSecret {
  kind: EcoSecretKind;
  key: string;
  value: string;
}

export interface UserSettingsRow {
  user_id: string;
  payload: unknown;
  updated_at: string;
  revision: number;
}

export interface UserSecretRow {
  id: string;
  user_id: string;
  secret_kind: string;
  secret_key: string;
  ciphertext: string;
  nonce: string;
  key_version: number;
  updated_at: string;
}

export interface SettingsSyncHooks {
  collectSettingsPayload: () => EcoSyncedSettingsPayload;
  applySettingsPayload: (payload: EcoSyncedSettingsPayload) => void | Promise<void>;
  collectPlainSecrets: () => EcoPlainSecret[];
  applyPlainSecrets: (secrets: EcoPlainSecret[]) => void | Promise<void>;
}

export function isEcoSyncedSettingsPayload(value: unknown): value is EcoSyncedSettingsPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as EcoSyncedSettingsPayload;
  return (
    record.version === ECO_SYNCED_SETTINGS_VERSION &&
    Array.isArray(record.providers) &&
    Boolean(record.asr) &&
    Array.isArray(record.asr.profiles) &&
    typeof record.asr.activeProfileId === "string" &&
    Boolean(record.imageGeneration) &&
    Array.isArray(record.imageGeneration.profiles) &&
    typeof record.imageGeneration.activeProfileId === "string" &&
    typeof record.imageGeneration.enabled === "boolean"
  );
}

export function emptyEcoSyncedSettingsPayload(): EcoSyncedSettingsPayload {
  return {
    version: ECO_SYNCED_SETTINGS_VERSION,
    providers: [],
    asr: { activeProfileId: "", profiles: [] },
    imageGeneration: { enabled: false, activeProfileId: "", profiles: [] },
  };
}

/** Ensure a vault_key exists locally; generate once when first syncing secrets. */
export async function ensureLocalVaultKey(
  getVaultKey: () => string,
  saveVaultKey: (vaultKey: string) => void,
): Promise<{ vaultKey: string; created: boolean }> {
  const existing = getVaultKey().trim();
  if (existing) {
    return { vaultKey: existing, created: false };
  }
  const vaultKey = await generateVaultKey();
  saveVaultKey(vaultKey);
  return { vaultKey, created: true };
}

export async function pullUserSettings(
  client: SupabaseClient,
  userId: string,
): Promise<UserSettingsRow | null> {
  const { data, error } = await client
    .from("user_settings")
    .select("user_id, payload, updated_at, revision")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data as UserSettingsRow | null;
}

export const SETTINGS_SYNC_CONFLICT_CODE = "settings_sync_conflict";

export class SettingsSyncConflictError extends Error {
  readonly code = SETTINGS_SYNC_CONFLICT_CODE;

  constructor(
    message = "Settings were updated on another device. Pull again, then retry sync.",
  ) {
    super(message);
    this.name = "SettingsSyncConflictError";
  }
}

/**
 * Write user_settings with optimistic concurrency on `revision`.
 * - No prior row (`expectedRevision` undefined): insert only (unique violation → conflict).
 * - Prior row: update only when `revision` still equals `expectedRevision`.
 */
export async function pushUserSettings(
  client: SupabaseClient,
  userId: string,
  payload: EcoSyncedSettingsPayload,
  expectedRevision?: number,
): Promise<UserSettingsRow> {
  const now = new Date().toISOString();

  if (expectedRevision === undefined) {
    const { data, error } = await client
      .from("user_settings")
      .insert({
        user_id: userId,
        payload,
        updated_at: now,
        revision: 1,
      })
      .select("user_id, payload, updated_at, revision")
      .single();
    if (error || !data) {
      if (isUniqueViolation(error)) {
        throw new SettingsSyncConflictError();
      }
      throw new Error(error?.message ?? "Failed to insert user_settings.");
    }
    return data as UserSettingsRow;
  }

  const nextRevision = expectedRevision + 1;
  const { data, error } = await client
    .from("user_settings")
    .update({
      payload,
      updated_at: now,
      revision: nextRevision,
    })
    .eq("user_id", userId)
    .eq("revision", expectedRevision)
    .select("user_id, payload, updated_at, revision")
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new SettingsSyncConflictError();
  }
  return data as UserSettingsRow;
}

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) {
    return false;
  }
  if (error.code === "23505") {
    return true;
  }
  const message = error.message ?? "";
  return /duplicate key|unique constraint/i.test(message);
}

export function ecoSyncedSettingsPayloadEqual(
  left: EcoSyncedSettingsPayload,
  right: unknown,
): boolean {
  if (!isEcoSyncedSettingsPayload(right)) {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function pullUserSecrets(
  client: SupabaseClient,
  userId: string,
): Promise<UserSecretRow[]> {
  const { data, error } = await client
    .from("user_secrets")
    .select("id, user_id, secret_kind, secret_key, ciphertext, nonce, key_version, updated_at")
    .eq("user_id", userId);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as UserSecretRow[];
}

export async function upsertEncryptedSecret(
  client: SupabaseClient,
  input: {
    userId: string;
    kind: EcoSecretKind;
    key: string;
    vaultKey: string;
    plaintext: string;
  },
): Promise<UserSecretRow> {
  const sealed = await encryptSecretWithVaultKey(input.vaultKey, input.plaintext);
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("user_secrets")
    .upsert(
      {
        user_id: input.userId,
        secret_kind: input.kind,
        secret_key: input.key,
        ciphertext: sealed.ciphertext,
        nonce: sealed.nonce,
        key_version: 1,
        updated_at: now,
      },
      { onConflict: "user_id,secret_kind,secret_key" },
    )
    .select("id, user_id, secret_kind, secret_key, ciphertext, nonce, key_version, updated_at")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to upsert user_secrets.");
  }
  return data as UserSecretRow;
}

export async function decryptUserSecrets(
  vaultKey: string,
  rows: readonly UserSecretRow[],
): Promise<EcoPlainSecret[]> {
  const out: EcoPlainSecret[] = [];
  for (const row of rows) {
    const kind = parseSecretKind(row.secret_kind);
    if (!kind) {
      continue;
    }
    const value = await decryptSecretWithVaultKey(vaultKey, row.ciphertext, row.nonce);
    out.push({ kind, key: row.secret_key, value });
  }
  return out;
}

export async function markDeviceVaultSynced(
  client: SupabaseClient,
  deviceId: string,
  syncedAt = new Date().toISOString(),
): Promise<void> {
  const { error } = await client
    .from("devices")
    .update({ vault_synced_at: syncedAt })
    .eq("id", deviceId);
  if (error) {
    throw new Error(error.message);
  }
}

export async function listVaultSyncedDeviceIds(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client
    .from("devices_public")
    .select("id, vault_synced_at, disabled_at")
    .not("vault_synced_at", "is", null)
    .is("disabled_at", null);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? [])
    .map((row) => (typeof row.id === "string" ? row.id : ""))
    .filter(Boolean);
}

export interface SyncAccountConfigResult {
  settingsPushed: boolean;
  settingsPulled: boolean;
  secretsPushed: number;
  secretsPulled: number;
  syncedAt: string;
  vaultKeyCreated: boolean;
}

/**
 * Pull remote settings (always) and secrets (when vault_key present);
 * then push local settings only when they differ, using revision CAS.
 * Concurrent writers that race on the same revision get SettingsSyncConflictError.
 */
export async function syncAccountConfig(input: {
  client: SupabaseClient;
  userId: string;
  deviceId: string;
  getVaultKey: () => string;
  saveVaultKey: (vaultKey: string) => void;
  hooks: SettingsSyncHooks;
  /** When true, create vault_key if missing so secrets can be pushed (first device). */
  allowCreateVaultKey: boolean;
}): Promise<SyncAccountConfigResult> {
  const syncedAt = new Date().toISOString();
  let settingsPulled = false;
  let settingsPushed = false;
  let secretsPulled = 0;
  let secretsPushed = 0;
  let vaultKeyCreated = false;

  const remote = await pullUserSettings(input.client, input.userId);
  if (remote && isEcoSyncedSettingsPayload(remote.payload)) {
    await input.hooks.applySettingsPayload(remote.payload);
    settingsPulled = true;
  }

  let vaultKey = input.getVaultKey().trim();
  if (!vaultKey && input.allowCreateVaultKey) {
    const ensured = await ensureLocalVaultKey(input.getVaultKey, input.saveVaultKey);
    vaultKey = ensured.vaultKey;
    vaultKeyCreated = ensured.created;
  }

  if (vaultKey) {
    const secretRows = await pullUserSecrets(input.client, input.userId);
    if (secretRows.length > 0) {
      const plain = await decryptUserSecrets(vaultKey, secretRows);
      await input.hooks.applyPlainSecrets(plain);
      secretsPulled = plain.length;
    }
  }

  const localPayload = input.hooks.collectSettingsPayload();
  const remoteUnchanged =
    remote !== null && ecoSyncedSettingsPayloadEqual(localPayload, remote.payload);
  if (!remoteUnchanged) {
    await pushUserSettings(
      input.client,
      input.userId,
      localPayload,
      remote ? remote.revision : undefined,
    );
    settingsPushed = true;
  }

  if (vaultKey) {
    const secrets = input.hooks.collectPlainSecrets().filter((secret) => secret.value.trim());
    for (const secret of secrets) {
      await upsertEncryptedSecret(input.client, {
        userId: input.userId,
        kind: secret.kind,
        key: secret.key,
        vaultKey,
        plaintext: secret.value,
      });
      secretsPushed += 1;
    }
    if (secretsPushed > 0 || vaultKeyCreated || secretsPulled > 0) {
      await markDeviceVaultSynced(input.client, input.deviceId, syncedAt);
    }
  }

  return {
    settingsPushed,
    settingsPulled,
    secretsPushed,
    secretsPulled,
    syncedAt,
    vaultKeyCreated,
  };
}

/** Encrypt/decrypt roundtrip helper for unit tests. */
export async function encryptDecryptSecretRoundtrip(
  vaultKey: string,
  plaintext: string,
): Promise<string> {
  const sealed = await encryptSecretWithVaultKey(vaultKey, plaintext);
  return decryptSecretWithVaultKey(vaultKey, sealed.ciphertext, sealed.nonce);
}

function parseSecretKind(value: string): EcoSecretKind | null {
  if (value === "provider" || value === "asr" || value === "image") {
    return value;
  }
  return null;
}
