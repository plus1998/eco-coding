import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { AsrClientConfig, AsrSettingsInput, AsrSettingsSnapshot, AsrSettingsStatus } from "../shared/ipc";

export const ASR_MODEL = "qwen3-asr-flash";
export const MAX_ASR_MODEL_LENGTH = 256;
export const DEFAULT_ASR_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1";

export type { AsrClientConfig, AsrSettingsInput, AsrSettingsSnapshot, AsrSettingsStatus };

export interface AsrSecretCodec {
  isAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
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
  parsed.pathname = parsed.pathname.replace(/(?:\/chat\/completions)+\/?$/i, "") || "/";
  const host = parsed.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new Error("ASR Base URL 必须使用 HTTPS（本机地址可使用 HTTP）。");
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

export function defaultAsrSettings(encryptionAvailable = false): AsrSettingsSnapshot {
  return {
    endpoint: DEFAULT_ASR_ENDPOINT,
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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS asr_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(): AsrSettingsSnapshot {
    const value = this.readStored();
    return {
      endpoint: normalizeAsrEndpoint(value?.endpoint),
      model: normalizeAsrModel(value?.model),
      systemPrompt: normalizeSystemPrompt(value?.systemPrompt),
      hasApiKey: typeof value?.apiKey === "string" && value.apiKey.length > 0,
      apiKeyEncryptionAvailable: this.secretCodec?.isAvailable() ?? false,
    };
  }

  getStatus(): AsrSettingsStatus {
    const value = this.readRaw();
    return {
      hasApiKey: typeof value?.apiKey === "string" && value.apiKey.length > 0,
      apiKeyEncryptionAvailable: this.secretCodec?.isAvailable() ?? false,
      model: normalizeAsrModel(value?.model),
    };
  }

  getClientConfig(): AsrClientConfig | undefined {
    const value = this.readStored();
    const apiKey = typeof value?.apiKey === "string" ? value.apiKey : "";
    return apiKey
      ? {
          endpoint: normalizeAsrEndpoint(value?.endpoint),
          model: normalizeAsrModel(value?.model),
          systemPrompt: normalizeSystemPrompt(value?.systemPrompt),
          apiKey,
        }
      : undefined;
  }

  save(input: AsrSettingsInput): AsrSettingsSnapshot {
    const endpoint = normalizeAsrEndpoint(input.endpoint);
    const model = normalizeAsrModel(input.model);
    const systemPrompt = normalizeSystemPrompt(input.systemPrompt);
    const existing = this.readRaw();
    const requestedKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    let apiKey = typeof existing?.apiKey === "string" ? existing.apiKey : "";
    if (apiKey) this.decryptApiKey(apiKey);
    if (requestedKey) {
      if (!this.secretCodec?.isAvailable()) {
        throw new Error("系统加密不可用，无法保存新的 ASR API key。");
      }
      apiKey = this.secretCodec.encrypt(requestedKey);
    }
    const raw = { endpoint, model, systemPrompt, apiKey };
    this.db
      .prepare(
        `INSERT INTO asr_settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run("snapshot", JSON.stringify(raw), new Date().toISOString());
    return this.get();
  }

  private readStored(): Record<string, unknown> | undefined {
    const raw = this.readRaw();
    if (!raw) return undefined;
    if (typeof raw.apiKey === "string" && raw.apiKey) {
      raw.apiKey = this.decryptApiKey(raw.apiKey);
    }
    return raw;
  }

  private readRaw(): Record<string, unknown> | undefined {
    const row = this.db
      .prepare("SELECT value_json FROM asr_settings WHERE key = ?")
      .get("snapshot") as { value_json: string } | undefined;
    if (!row) return undefined;
    try {
      const value = JSON.parse(row.value_json);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ASR 设置数据无效。");
      return value as Record<string, unknown>;
    } catch (error) {
      throw new Error(`ASR 设置无法读取：${error instanceof Error ? error.message : "数据格式无效。"}`);
    }
  }

  private decryptApiKey(stored: string): string {
    if (!this.secretCodec) {
      throw new Error("ASR API key 已存储但当前系统无法解密，请检查系统密钥链。");
    }
    try {
      return this.secretCodec.decrypt(stored);
    } catch (error) {
      throw new Error(`ASR API key 解密失败：${error instanceof Error ? error.message : "系统密钥链不可用。"}`);
    }
  }
}
