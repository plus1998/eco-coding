/**
 * Account-level settings + secrets sync against Supabase Center (Track E).
 *
 * - `user_settings.payload`: non-secret provider / ASR / image / workflow / orchestration JSON
 * - `user_secrets`: AES-GCM ciphertext of API keys under local vault_key
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecretWithVaultKey, encryptSecretWithVaultKey, generateVaultKey } from "@eco/shared";
import type {
  AgentTemplate,
  MainAgentConfigResource,
  MainAgentPromptResource,
  SubagentOrchestrationResource,
} from "../shared/agent-orchestration";
import type { CandidateModelInput, ProxyBridgeSettingsSnapshot, RouteProfileInput } from "../shared/ipc";
import type { WorkflowSettingsSnapshot } from "./workflow-settings-store";

export const ECO_SYNCED_SETTINGS_VERSION = 1 as const;

export type EcoSecretKind = "provider" | "asr" | "image" | "workflow" | "proxy";

export const ECO_WORKFLOW_CURSOR_API_KEY_SECRET = "acp_cursor_api_key";
export const ECO_PROXY_URL_SECRET = "upstream_proxy_url";

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

/** Workflow / default-agent settings without Cursor API key (secret synced separately). */
export type EcoSyncedWorkflowSettings = Omit<WorkflowSettingsSnapshot, "acpCursorApiKey">;

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
  /** Optional for payloads written before workflow sync existed. */
  workflow?: EcoSyncedWorkflowSettings;
  mainAgentConfigs?: MainAgentConfigResource[];
  mainAgentPrompts?: MainAgentPromptResource[];
  subagentOrchestrations?: SubagentOrchestrationResource[];
  agentTemplates?: AgentTemplate[];
  candidateModels?: CandidateModelInput[];
  routeProfiles?: RouteProfileInput[];
  /** Proxy credentials stay in user_secrets; only the non-secret UA is stored here. */
  proxyBridge?: Pick<ProxyBridgeSettingsSnapshot, "upstreamUserAgent">;
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
    typeof record.imageGeneration.enabled === "boolean" &&
    (record.candidateModels === undefined || Array.isArray(record.candidateModels)) &&
    (record.routeProfiles === undefined || Array.isArray(record.routeProfiles)) &&
    (record.proxyBridge === undefined ||
      (Boolean(record.proxyBridge) &&
        typeof record.proxyBridge === "object" &&
        !Array.isArray(record.proxyBridge)))
  );
}

export function emptyEcoSyncedSettingsPayload(): EcoSyncedSettingsPayload {
  return {
    version: ECO_SYNCED_SETTINGS_VERSION,
    providers: [],
    asr: { activeProfileId: "", profiles: [] },
    imageGeneration: { enabled: false, activeProfileId: "", profiles: [] },
    mainAgentConfigs: [],
    mainAgentPrompts: [],
    subagentOrchestrations: [],
    agentTemplates: [],
    candidateModels: [],
    routeProfiles: [],
    proxyBridge: {},
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
export const SETTINGS_SYNC_VAULT_DECRYPT_CODE = "settings_sync_vault_decrypt";
export const SETTINGS_SYNC_VAULT_REQUIRED_CODE = "settings_sync_vault_required";

export class SettingsSyncConflictError extends Error {
  readonly code = SETTINGS_SYNC_CONFLICT_CODE;

  constructor(message = "Settings were updated on another device. Pull again, then retry sync.") {
    super(message);
    this.name = "SettingsSyncConflictError";
  }
}

/** Local vault_key cannot decrypt cloud user_secrets (wrong key or corrupt ciphertext). */
export class SettingsSyncVaultDecryptError extends Error {
  readonly code = SETTINGS_SYNC_VAULT_DECRYPT_CODE;

  constructor(
    message = `${SETTINGS_SYNC_VAULT_DECRYPT_CODE}: This device's vault key cannot decrypt cloud secrets. Request authorization from a device that already synced.`,
  ) {
    super(message);
    this.name = "SettingsSyncVaultDecryptError";
  }
}

/** Settings and secrets are one snapshot; a device without the vault key may apply neither. */
export class SettingsSyncVaultRequiredError extends Error {
  readonly code = SETTINGS_SYNC_VAULT_REQUIRED_CODE;

  constructor(
    message = `${SETTINGS_SYNC_VAULT_REQUIRED_CODE}: Authorize this device to receive the vault key before syncing settings.`,
  ) {
    super(message);
    this.name = "SettingsSyncVaultRequiredError";
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

export function ecoSyncedSettingsPayloadEqual(left: EcoSyncedSettingsPayload, right: unknown): boolean {
  if (!isEcoSyncedSettingsPayload(right)) {
    return false;
  }
  return (
    JSON.stringify(normalizeEcoSyncedSettingsPayload(left)) ===
    JSON.stringify(normalizeEcoSyncedSettingsPayload(right))
  );
}

/** Fill optional orchestration fields so older cloud payloads compare stably. */
export function normalizeEcoSyncedSettingsPayload(
  payload: EcoSyncedSettingsPayload,
): EcoSyncedSettingsPayload {
  return {
    ...payload,
    mainAgentConfigs: payload.mainAgentConfigs ?? [],
    mainAgentPrompts: payload.mainAgentPrompts ?? [],
    subagentOrchestrations: payload.subagentOrchestrations ?? [],
    agentTemplates: payload.agentTemplates ?? [],
    candidateModels: payload.candidateModels ?? [],
    routeProfiles: payload.routeProfiles ?? [],
    proxyBridge: payload.proxyBridge ?? {},
  };
}

interface EcoEncryptedSecretSnapshot {
  secret_kind: EcoSecretKind;
  secret_key: string;
  ciphertext: string;
  nonce: string;
  key_version: number;
}

async function encryptSecretSnapshot(
  vaultKey: string,
  secrets: readonly EcoPlainSecret[],
): Promise<EcoEncryptedSecretSnapshot[]> {
  return Promise.all(
    secrets.map(async (secret) => {
      const sealed = await encryptSecretWithVaultKey(vaultKey, secret.value);
      return {
        secret_kind: secret.kind,
        secret_key: secret.key,
        ciphertext: sealed.ciphertext,
        nonce: sealed.nonce,
        key_version: 1,
      };
    }),
  );
}

/** Atomically replace the account settings and complete encrypted-secret snapshot. */
export async function pushAccountConfigSnapshot(
  client: SupabaseClient,
  input: {
    payload: EcoSyncedSettingsPayload;
    expectedRevision?: number;
    secrets: readonly EcoEncryptedSecretSnapshot[];
  },
): Promise<UserSettingsRow> {
  const { data, error } = await client.rpc("eco_replace_account_config", {
    p_payload: input.payload,
    p_expected_revision: input.expectedRevision ?? null,
    p_secrets: input.secrets,
  });
  if (error) {
    if (error.code === "40001" || error.message.includes(SETTINGS_SYNC_CONFLICT_CODE)) {
      throw new SettingsSyncConflictError();
    }
    throw new Error(error.message);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("eco_replace_account_config returned no settings row.");
  }
  return row as UserSettingsRow;
}

export async function pullUserSecrets(client: SupabaseClient, userId: string): Promise<UserSecretRow[]> {
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
): Promise<{ secrets: EcoPlainSecret[]; skipped: number }> {
  const secrets: EcoPlainSecret[] = [];
  let attempted = 0;
  for (const row of rows) {
    const kind = parseSecretKind(row.secret_kind);
    if (!kind) {
      throw new Error(`Unsupported cloud secret kind: ${row.secret_kind}`);
    }
    attempted += 1;
    try {
      const value = await decryptSecretWithVaultKey(vaultKey, row.ciphertext, row.nonce);
      secrets.push({ kind, key: row.secret_key, value });
    } catch {
      throw new SettingsSyncVaultDecryptError(
        `${SETTINGS_SYNC_VAULT_DECRYPT_CODE}: Failed to decrypt ${row.secret_kind}:${row.secret_key}. The settings snapshot was not applied.`,
      );
    }
  }
  if (attempted > 0 && secrets.length === 0) {
    throw new SettingsSyncVaultDecryptError();
  }
  return { secrets, skipped: 0 };
}

export async function markDeviceVaultSynced(
  client: SupabaseClient,
  deviceId: string,
  syncedAt = new Date().toISOString(),
): Promise<void> {
  const { error } = await client.rpc("eco_mark_device_vault_synced", {
    p_device_id: deviceId,
    p_synced_at: syncedAt,
  });
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
  return (data ?? []).map((row) => (typeof row.id === "string" ? row.id : "")).filter(Boolean);
}

export type EcoSettingsSyncMode = "pull" | "push" | "reconcile";

export interface SyncAccountConfigResult {
  mode: EcoSettingsSyncMode;
  settingsPushed: boolean;
  settingsPulled: boolean;
  secretsPushed: number;
  secretsPulled: number;
  syncedAt: string;
  vaultKeyCreated: boolean;
  /**
   * Local and cloud both have settings and they differ.
   * reconcile mode refuses to overwrite either side — user must choose pull or push.
   */
  needsUserChoice?: boolean;
  /** Settings/secrets may already be on the cloud; devices.vault_synced_at update failed (often missing RPC). */
  vaultMarkFailed?: string;
  /** Cloud secret rows that could not be decrypted with the local vault_key (stale / other key). */
  secretsSkipped?: number;
  /** Pull requested but cloud has no user_settings row yet (nothing to apply). */
  cloudEmpty?: boolean;
}

export function isSparseEcoSyncedSettings(payload: EcoSyncedSettingsPayload): boolean {
  return (
    payload.providers.length === 0 &&
    payload.asr.profiles.length === 0 &&
    payload.imageGeneration.profiles.length === 0 &&
    (payload.mainAgentConfigs?.length ?? 0) === 0 &&
    (payload.mainAgentPrompts?.length ?? 0) === 0 &&
    (payload.subagentOrchestrations?.length ?? 0) === 0 &&
    (payload.agentTemplates?.length ?? 0) === 0 &&
    (payload.candidateModels?.length ?? 0) === 0 &&
    (payload.routeProfiles?.length ?? 0) === 0 &&
    !payload.proxyBridge?.upstreamUserAgent
  );
}

/**
 * Account settings/secrets sync.
 *
 * - pull: cloud → local only (never push). Overwrites local settings/secrets from cloud.
 * - push: local → cloud only (never pull first). Uses revision CAS for settings.
 * - reconcile (background): never silently clobber. Pull only if local is sparse;
 *   push only if cloud is empty; if both differ → needsUserChoice.
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
  mode: EcoSettingsSyncMode;
}): Promise<SyncAccountConfigResult> {
  const syncedAt = new Date().toISOString();
  let settingsPulled = false;
  let settingsPushed = false;
  let secretsPulled = 0;
  let secretsPushed = 0;
  let secretsSkipped = 0;
  let vaultKeyCreated = false;

  const localBefore = input.hooks.collectSettingsPayload();
  const remote = await pullUserSettings(input.client, input.userId);
  const remotePayload = remote && isEcoSyncedSettingsPayload(remote.payload) ? remote.payload : null;

  if (remote && !remotePayload) {
    throw new Error("Cloud user_settings payload is invalid or uses an unsupported version.");
  }

  if (input.mode === "reconcile") {
    if (remotePayload && !isSparseEcoSyncedSettings(localBefore)) {
      if (!ecoSyncedSettingsPayloadEqual(localBefore, remotePayload)) {
        return {
          mode: input.mode,
          settingsPushed: false,
          settingsPulled: false,
          secretsPushed: 0,
          secretsPulled: 0,
          syncedAt,
          vaultKeyCreated: false,
          needsUserChoice: true,
        };
      }
      // Already aligned — still allow secret pull/push below only if equal settings.
    }
  }

  let vaultKey = input.getVaultKey().trim();
  const settingsShouldBePulled = Boolean(
    remotePayload &&
      (input.mode === "pull" || (input.mode === "reconcile" && isSparseEcoSyncedSettings(localBefore))),
  );
  const secretsShouldBePulled = Boolean(
    remotePayload &&
      (input.mode === "pull" ||
        (input.mode === "reconcile" &&
          (settingsShouldBePulled || ecoSyncedSettingsPayloadEqual(localBefore, remotePayload)))),
  );
  const snapshotShouldBePushed = input.mode === "push" || (input.mode === "reconcile" && !remotePayload);

  if (!vaultKey && input.allowCreateVaultKey && snapshotShouldBePushed) {
    const ensured = await ensureLocalVaultKey(input.getVaultKey, input.saveVaultKey);
    vaultKey = ensured.vaultKey;
    vaultKeyCreated = ensured.created;
  }
  if (!vaultKey && (settingsShouldBePulled || secretsShouldBePulled || snapshotShouldBePushed)) {
    throw new SettingsSyncVaultRequiredError();
  }

  if (vaultKey && secretsShouldBePulled) {
    const secretRows = await pullUserSecrets(input.client, input.userId);
    // Decrypt first so a bad vault key cannot partially apply settings without secrets.
    const plain = await decryptUserSecrets(vaultKey, secretRows);
    if (settingsShouldBePulled && remotePayload) {
      await input.hooks.applySettingsPayload(remotePayload);
      settingsPulled = true;
    }
    await input.hooks.applyPlainSecrets(plain.secrets);
    secretsPulled = plain.secrets.length;
    secretsSkipped += plain.skipped;
  } else if (vaultKey && settingsShouldBePulled && remotePayload) {
    // Settings-only pull path (no secret rows / secrets not requested).
    await input.hooks.applySettingsPayload(remotePayload);
    settingsPulled = true;
  }

  if (snapshotShouldBePushed && vaultKey) {
    const localPayload = input.hooks.collectSettingsPayload();
    const secrets = input.hooks.collectPlainSecrets().filter((secret) => secret.value.trim());
    const encryptedSecrets = await encryptSecretSnapshot(vaultKey, secrets);
    await pushAccountConfigSnapshot(input.client, {
      payload: localPayload,
      ...(remote ? { expectedRevision: remote.revision } : {}),
      secrets: encryptedSecrets,
    });
    settingsPushed = true;
    secretsPushed = secrets.length;
  }

  if (
    vaultKey &&
    (settingsPushed || secretsPushed > 0 || vaultKeyCreated || secretsPulled > 0 || settingsPulled)
  ) {
    await markDeviceVaultSynced(input.client, input.deviceId, syncedAt);
  }

  return {
    mode: input.mode,
    settingsPushed,
    settingsPulled,
    secretsPushed,
    secretsPulled,
    syncedAt,
    vaultKeyCreated,
    ...(secretsSkipped > 0 ? { secretsSkipped } : {}),
    ...(input.mode === "pull" && !remotePayload ? { cloudEmpty: true } : {}),
  };
}

/** Encrypt/decrypt roundtrip helper for unit tests. */
export async function encryptDecryptSecretRoundtrip(vaultKey: string, plaintext: string): Promise<string> {
  const sealed = await encryptSecretWithVaultKey(vaultKey, plaintext);
  return decryptSecretWithVaultKey(vaultKey, sealed.ciphertext, sealed.nonce);
}

function parseSecretKind(value: string): EcoSecretKind | null {
  if (
    value === "provider" ||
    value === "asr" ||
    value === "image" ||
    value === "workflow" ||
    value === "proxy"
  ) {
    return value;
  }
  return null;
}
