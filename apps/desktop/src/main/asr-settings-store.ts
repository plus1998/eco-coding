import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type {
  AsrApiMode,
  AsrClientConfig,
  AsrInputDeviceSaveInput,
  AsrProfileSaveInput,
  AsrProfileSnapshot,
  AsrProfilesSnapshot,
  AsrSettingsInput,
  AsrSettingsSnapshot,
  AsrSettingsStatus,
} from "../shared/ipc";

export const ASR_MODEL = "qwen3-asr-flash";
export const MAX_ASR_MODEL_LENGTH = 256;
export const MAX_ASR_PROFILE_NAME_LENGTH = 80;
export const MAX_ASR_INPUT_DEVICE_ID_LENGTH = 512;
export const DEFAULT_ASR_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const DEFAULT_ASR_API_MODE: AsrApiMode = "chat_completions";
export const DEFAULT_ASR_PROFILE_ID = "00000000-0000-4000-8000-000000000001";
export const DEFAULT_ASR_PROFILE_NAME = "Default";

export type {
  AsrApiMode,
  AsrClientConfig,
  AsrInputDeviceSaveInput,
  AsrProfileSaveInput,
  AsrProfileSnapshot,
  AsrProfilesSnapshot,
  AsrSettingsInput,
  AsrSettingsSnapshot,
  AsrSettingsStatus,
};

export interface AsrSecretCodec {
  isAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

interface AsrProfileRow {
  id: string;
  name: string;
  endpoint: string;
  api_mode: string;
  model: string;
  system_prompt: string;
  encrypted_api_key: string;
  created_at: string;
  updated_at: string;
}

interface AsrGlobalSettingsRow {
  active_profile_id: string;
  input_device_id: string | null;
}

export function normalizeAsrApiMode(value: unknown): AsrApiMode {
  return value === "audio_transcriptions" ? "audio_transcriptions" : DEFAULT_ASR_API_MODE;
}

function validateAsrApiMode(value: unknown): AsrApiMode {
  if (value === undefined || value === "chat_completions") return DEFAULT_ASR_API_MODE;
  if (value === "audio_transcriptions") return value;
  throw new Error("ASR API 模式无效。");
}

export function normalizeAsrEndpoint(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return DEFAULT_ASR_ENDPOINT;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("ASR Base URL 无效。");
  }
  parsed.search = "";
  parsed.hash = "";
  let pathname = parsed.pathname.replace(/(?:\/chat\/completions)+\/?$/i, "");
  pathname = pathname.replace(/(?:\/audio\/transcriptions)+\/?$/i, "");
  parsed.pathname = pathname || "/";
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("ASR Base URL 必须使用 HTTP 或 HTTPS。");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeSystemPrompt(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 8_000) : "";
}

export function normalizeAsrModel(value: unknown): string {
  if (value === undefined) return ASR_MODEL;
  if (typeof value !== "string") throw new Error("ASR 模型必须是字符串。");
  const model = value.trim();
  if (!model) throw new Error("ASR 模型不能为空。");
  if (model.length > MAX_ASR_MODEL_LENGTH) {
    throw new Error(`ASR 模型不能超过 ${MAX_ASR_MODEL_LENGTH} 个字符。`);
  }
  return model;
}

export function normalizeAsrProfileName(value: unknown): string {
  if (typeof value !== "string") throw new Error("ASR profile 名称必须是字符串。");
  const name = value.trim();
  if (!name) throw new Error("ASR profile 名称不能为空。");
  if (name.length > MAX_ASR_PROFILE_NAME_LENGTH) {
    throw new Error(`ASR profile 名称不能超过 ${MAX_ASR_PROFILE_NAME_LENGTH} 个字符。`);
  }
  return name;
}

function normalizeProfileId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Error("ASR profile ID 必须是有效 UUID。");
  }
  return value.toLowerCase();
}

function normalizeInputDeviceId(input: AsrInputDeviceSaveInput): string | null {
  if (input.inputDeviceId === undefined || input.inputDeviceId === null) return null;
  if (typeof input.inputDeviceId !== "string") throw new Error("ASR 输入设备 ID 必须是字符串。");
  const inputDeviceId = input.inputDeviceId.trim();
  if (!inputDeviceId) return null;
  if (inputDeviceId.length > MAX_ASR_INPUT_DEVICE_ID_LENGTH) {
    throw new Error(`ASR 输入设备 ID 不能超过 ${MAX_ASR_INPUT_DEVICE_ID_LENGTH} 个字符。`);
  }
  return inputDeviceId;
}

export function defaultAsrSettings(encryptionAvailable = false): AsrSettingsSnapshot {
  return {
    endpoint: DEFAULT_ASR_ENDPOINT,
    apiMode: DEFAULT_ASR_API_MODE,
    model: ASR_MODEL,
    systemPrompt: "",
    hasApiKey: false,
    apiKeyEncryptionAvailable: encryptionAvailable,
  };
}

export async function createAsrSettingsStore(
  dbPath: string,
  secretCodec?: AsrSecretCodec,
): Promise<AsrSettingsStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new AsrSettingsStore(new sqlite.DatabaseSync(dbPath), secretCodec);
  store.initialize();
  return store;
}

export class AsrSettingsStore {
  constructor(
    private readonly db: DatabaseSyncType,
    private readonly secretCodec?: AsrSecretCodec,
  ) {}

  initialize(): void {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS asr_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS asr_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(name) BETWEEN 1 AND 80),
          name_key TEXT NOT NULL UNIQUE,
          endpoint TEXT NOT NULL,
          api_mode TEXT NOT NULL CHECK(api_mode IN ('chat_completions', 'audio_transcriptions')),
          model TEXT NOT NULL,
          system_prompt TEXT NOT NULL,
          encrypted_api_key TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS asr_global_settings (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          active_profile_id TEXT NOT NULL,
          input_device_id TEXT,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(active_profile_id) REFERENCES asr_profiles(id)
        );
      `);

      const profileCount = Number(
        (
          this.db.prepare("SELECT COUNT(*) AS count FROM asr_profiles").get() as
            | { count: number | bigint }
            | undefined
        )?.count ?? 0,
      );
      const globalSettings = this.readGlobalSettingsOptional();
      if (profileCount === 0) {
        if (globalSettings) {
          throw new Error("ASR 全局设置引用了不存在的 profile。");
        }
        this.createInitialProfile();
      } else {
        if (!globalSettings) {
          throw new Error("ASR profile 已存在，但全局 active profile 设置缺失。");
        }
        if (!this.readProfileOptional(globalSettings.active_profile_id)) {
          throw new Error(`ASR active profile 不存在：${globalSettings.active_profile_id}`);
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the original initialization error.
      }
      throw error;
    }
  }

  listProfiles(): AsrProfilesSnapshot {
    const globalSettings = this.readGlobalSettings();
    const profiles = this.db
      .prepare(
        `SELECT id, name, endpoint, api_mode, model, system_prompt, encrypted_api_key, created_at, updated_at
         FROM asr_profiles
         ORDER BY name COLLATE NOCASE, created_at, id`,
      )
      .all() as unknown as AsrProfileRow[];
    return {
      profiles: profiles.map((profile) => this.toProfileSnapshot(profile)),
      activeProfileId: globalSettings.active_profile_id,
      ...(globalSettings.input_device_id ? { inputDeviceId: globalSettings.input_device_id } : {}),
      apiKeyEncryptionAvailable: this.secretCodec?.isAvailable() ?? false,
    };
  }

  get(): AsrSettingsSnapshot {
    const globalSettings = this.readGlobalSettings();
    const profile = this.readProfile(globalSettings.active_profile_id);
    return {
      ...this.toProfileSettingsSnapshot(profile),
      ...(globalSettings.input_device_id ? { inputDeviceId: globalSettings.input_device_id } : {}),
    };
  }

  getStatus(): AsrSettingsStatus {
    const profile = this.readProfile(this.readGlobalSettings().active_profile_id);
    return {
      activeProfileId: profile.id,
      activeProfileName: profile.name,
      hasApiKey: profile.encrypted_api_key.length > 0,
      apiKeyEncryptionAvailable: this.secretCodec?.isAvailable() ?? false,
      model: normalizeAsrModel(profile.model),
    };
  }

  getClientConfig(profileId?: string): AsrClientConfig | undefined {
    const id =
      profileId === undefined ? this.readGlobalSettings().active_profile_id : normalizeProfileId(profileId);
    const profile = this.readProfile(id);
    if (!profile.encrypted_api_key) return undefined;
    return {
      endpoint: normalizeAsrEndpoint(profile.endpoint),
      apiMode: validateAsrApiMode(profile.api_mode),
      model: normalizeAsrModel(profile.model),
      systemPrompt: normalizeSystemPrompt(profile.system_prompt),
      apiKey: this.decryptApiKey(profile.encrypted_api_key),
    };
  }

  save(input: AsrSettingsInput): AsrSettingsSnapshot {
    const activeProfile = this.readProfile(this.readGlobalSettings().active_profile_id);
    this.saveProfile({
      id: activeProfile.id,
      name: activeProfile.name,
      endpoint: input.endpoint,
      ...(input.apiMode ? { apiMode: input.apiMode } : {}),
      model: input.model,
      systemPrompt: input.systemPrompt,
      ...(typeof input.apiKey === "string" ? { apiKey: input.apiKey } : {}),
    });
    return this.get();
  }

  saveProfile(input: AsrProfileSaveInput): AsrProfileSnapshot {
    const id = input.id === undefined ? randomUUID() : normalizeProfileId(input.id);
    // Upsert: cloud sync may introduce a profile id that does not exist locally yet.
    const existing = this.readProfileOptional(id);
    const name = normalizeAsrProfileName(input.name);
    const nameKey = name.toLocaleLowerCase();
    const endpoint = normalizeAsrEndpoint(input.endpoint);
    const apiMode = validateAsrApiMode(input.apiMode);
    const model = normalizeAsrModel(input.model);
    const systemPrompt = normalizeSystemPrompt(input.systemPrompt);
    const duplicate = this.db
      .prepare("SELECT id FROM asr_profiles WHERE name_key = ? AND id <> ?")
      .get(nameKey, id) as { id: string } | undefined;
    if (duplicate) {
      throw new Error(`ASR profile 名称已存在：${name}`);
    }

    const requestedKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    let encryptedApiKey = existing?.encrypted_api_key ?? "";
    if (encryptedApiKey && !requestedKey) {
      this.decryptApiKey(encryptedApiKey);
    }
    if (requestedKey) {
      if (!this.secretCodec?.isAvailable()) {
        throw new Error("系统加密不可用，无法保存新的 ASR API key。");
      }
      encryptedApiKey = this.secretCodec.encrypt(requestedKey);
    }

    const now = new Date().toISOString();
    if (existing) {
      this.db
        .prepare(
          `UPDATE asr_profiles
           SET name = ?, name_key = ?, endpoint = ?, api_mode = ?, model = ?, system_prompt = ?,
               encrypted_api_key = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(name, nameKey, endpoint, apiMode, model, systemPrompt, encryptedApiKey, now, id);
    } else {
      this.db
        .prepare(
          `INSERT INTO asr_profiles
             (id, name, name_key, endpoint, api_mode, model, system_prompt, encrypted_api_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, name, nameKey, endpoint, apiMode, model, systemPrompt, encryptedApiKey, now, now);
    }
    return this.toProfileSnapshot(this.readProfile(id));
  }

  deleteProfile(profileId: string): AsrProfilesSnapshot {
    const id = normalizeProfileId(profileId);
    const profile = this.readProfile(id);
    const globalSettings = this.readGlobalSettings();
    if (globalSettings.active_profile_id === id) {
      throw new Error(`不能删除当前 active ASR profile：${profile.name}`);
    }
    const count = Number(
      (
        this.db.prepare("SELECT COUNT(*) AS count FROM asr_profiles").get() as
          | { count: number | bigint }
          | undefined
      )?.count ?? 0,
    );
    if (count <= 1) {
      throw new Error("至少必须保留一个 ASR profile。");
    }
    this.db.prepare("DELETE FROM asr_profiles WHERE id = ?").run(id);
    return this.listProfiles();
  }

  activateProfile(profileId: string): AsrSettingsSnapshot {
    const id = normalizeProfileId(profileId);
    this.readProfile(id);
    this.db
      .prepare("UPDATE asr_global_settings SET active_profile_id = ?, updated_at = ? WHERE singleton = 1")
      .run(id, new Date().toISOString());
    return this.get();
  }

  saveInputDevice(input: AsrInputDeviceSaveInput): AsrProfilesSnapshot {
    const inputDeviceId = normalizeInputDeviceId(input);
    this.db
      .prepare("UPDATE asr_global_settings SET input_device_id = ?, updated_at = ? WHERE singleton = 1")
      .run(inputDeviceId, new Date().toISOString());
    return this.listProfiles();
  }

  private createInitialProfile(): void {
    const legacy = this.readLegacySnapshot();
    const endpoint = normalizeAsrEndpoint(legacy?.endpoint);
    const apiMode = validateAsrApiMode(legacy?.apiMode);
    const model = normalizeAsrModel(legacy?.model);
    const systemPrompt = normalizeSystemPrompt(legacy?.systemPrompt);
    const encryptedApiKey = typeof legacy?.apiKey === "string" ? legacy.apiKey : "";
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO asr_profiles
           (id, name, name_key, endpoint, api_mode, model, system_prompt, encrypted_api_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        DEFAULT_ASR_PROFILE_ID,
        DEFAULT_ASR_PROFILE_NAME,
        DEFAULT_ASR_PROFILE_NAME.toLocaleLowerCase(),
        endpoint,
        apiMode,
        model,
        systemPrompt,
        encryptedApiKey,
        now,
        now,
      );
    this.db
      .prepare(
        `INSERT INTO asr_global_settings
           (singleton, active_profile_id, input_device_id, updated_at)
         VALUES (1, ?, NULL, ?)`,
      )
      .run(DEFAULT_ASR_PROFILE_ID, now);
  }

  private readLegacySnapshot(): Record<string, unknown> | undefined {
    const row = this.db.prepare("SELECT value_json FROM asr_settings WHERE key = ?").get("snapshot") as
      | { value_json: string }
      | undefined;
    if (!row) return undefined;
    try {
      const value = JSON.parse(row.value_json);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("ASR 设置数据无效。");
      }
      return value as Record<string, unknown>;
    } catch (error) {
      throw new Error(`ASR 设置无法迁移：${error instanceof Error ? error.message : "数据格式无效。"}`);
    }
  }

  private readGlobalSettingsOptional(): AsrGlobalSettingsRow | undefined {
    return this.db
      .prepare("SELECT active_profile_id, input_device_id FROM asr_global_settings WHERE singleton = 1")
      .get() as AsrGlobalSettingsRow | undefined;
  }

  private readGlobalSettings(): AsrGlobalSettingsRow {
    const settings = this.readGlobalSettingsOptional();
    if (!settings) throw new Error("ASR 全局设置缺失。");
    return settings;
  }

  private readProfileOptional(profileId: string): AsrProfileRow | undefined {
    return this.db
      .prepare(
        `SELECT id, name, endpoint, api_mode, model, system_prompt, encrypted_api_key, created_at, updated_at
         FROM asr_profiles WHERE id = ?`,
      )
      .get(profileId) as AsrProfileRow | undefined;
  }

  private readProfile(profileId: string): AsrProfileRow {
    const profile = this.readProfileOptional(profileId);
    if (!profile) throw new Error(`ASR profile 不存在：${profileId}`);
    return profile;
  }

  private toProfileSnapshot(profile: AsrProfileRow): AsrProfileSnapshot {
    return {
      id: profile.id,
      name: profile.name,
      endpoint: normalizeAsrEndpoint(profile.endpoint),
      apiMode: validateAsrApiMode(profile.api_mode),
      model: normalizeAsrModel(profile.model),
      systemPrompt: normalizeSystemPrompt(profile.system_prompt),
      hasApiKey: profile.encrypted_api_key.length > 0,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    };
  }

  private toProfileSettingsSnapshot(profile: AsrProfileRow): AsrSettingsSnapshot {
    return {
      endpoint: normalizeAsrEndpoint(profile.endpoint),
      apiMode: validateAsrApiMode(profile.api_mode),
      model: normalizeAsrModel(profile.model),
      systemPrompt: normalizeSystemPrompt(profile.system_prompt),
      hasApiKey: profile.encrypted_api_key.length > 0,
      apiKeyEncryptionAvailable: this.secretCodec?.isAvailable() ?? false,
      profileId: profile.id,
      profileName: profile.name,
    };
  }

  private decryptApiKey(stored: string): string {
    if (!this.secretCodec) {
      throw new Error("ASR API key 已存储但当前系统无法解密，请检查系统密钥链。");
    }
    try {
      return this.secretCodec.decrypt(stored);
    } catch (error) {
      throw new Error(
        `ASR API key 解密失败：${error instanceof Error ? error.message : "系统密钥链不可用。"}`,
      );
    }
  }
}
