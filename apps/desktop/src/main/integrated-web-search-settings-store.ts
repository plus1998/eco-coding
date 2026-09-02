import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type {
  IntegratedWebSearchProvider,
  IntegratedWebSearchSettingsSaveInput,
  IntegratedWebSearchSettingsSnapshot,
} from "../shared/ipc";

const INTEGRATED_WEB_SEARCH_SETTINGS_KEY = "integrated_web_search";

export interface IntegratedWebSearchSecretCodec {
  isAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export function defaultIntegratedWebSearchSettings(): IntegratedWebSearchSettingsSnapshot {
  return {
    enabled: false,
    provider: "tavily",
    hasApiKey: false,
  };
}

export async function createIntegratedWebSearchSettingsStore(
  dbPath: string,
  secretCodec: IntegratedWebSearchSecretCodec,
): Promise<IntegratedWebSearchSettingsStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new IntegratedWebSearchSettingsStore(new sqlite.DatabaseSync(dbPath), secretCodec);
  store.initialize();
  return store;
}

interface StoredIntegratedWebSearchSettings {
  enabled: boolean;
  provider: IntegratedWebSearchProvider;
  encryptedApiKey: string;
}

export class IntegratedWebSearchSettingsStore {
  constructor(
    private readonly db: DatabaseSyncType,
    private readonly secretCodec: IntegratedWebSearchSecretCodec,
  ) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(): IntegratedWebSearchSettingsSnapshot {
    const stored = this.readStored();
    return {
      enabled: stored.enabled,
      provider: stored.provider,
      hasApiKey: stored.encryptedApiKey.length > 0,
    };
  }

  getApiKey(): string | undefined {
    const stored = this.readStored();
    if (!stored.encryptedApiKey) {
      return undefined;
    }
    if (!this.secretCodec.isAvailable()) {
      throw new Error("Integrated Web Search API key is stored but local secret storage is unavailable.");
    }
    const decrypted = this.secretCodec.decrypt(stored.encryptedApiKey).trim();
    return decrypted || undefined;
  }

  save(input: IntegratedWebSearchSettingsSaveInput): IntegratedWebSearchSettingsSnapshot {
    const current = this.readStored();
    const enabled = input.enabled ?? current.enabled;
    const provider = input.provider ?? current.provider;
    let encryptedApiKey = current.encryptedApiKey;
    if (input.apiKey !== undefined) {
      const trimmed = input.apiKey.trim();
      if (!trimmed) {
        encryptedApiKey = "";
      } else {
        if (!this.secretCodec.isAvailable()) {
          throw new Error("本地密钥存储不可用，无法保存 Integrated Web Search API Key。");
        }
        encryptedApiKey = this.secretCodec.encrypt(trimmed);
      }
    }
    const next: StoredIntegratedWebSearchSettings = {
      enabled,
      provider: normalizeIntegratedWebSearchProvider(provider),
      encryptedApiKey,
    };
    this.writeStored(next);
    return this.get();
  }

  private readStored(): StoredIntegratedWebSearchSettings {
    const row = this.db
      .prepare(`SELECT value_json FROM workflow_settings WHERE key = ?`)
      .get(INTEGRATED_WEB_SEARCH_SETTINGS_KEY) as { value_json: string } | undefined;
    if (!row) {
      return { enabled: false, provider: "tavily", encryptedApiKey: "" };
    }
    try {
      return normalizeStoredIntegratedWebSearchSettings(JSON.parse(row.value_json));
    } catch {
      return { enabled: false, provider: "tavily", encryptedApiKey: "" };
    }
  }

  private writeStored(snapshot: StoredIntegratedWebSearchSettings): void {
    const normalized = normalizeStoredIntegratedWebSearchSettings(snapshot);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO workflow_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(INTEGRATED_WEB_SEARCH_SETTINGS_KEY, JSON.stringify(normalized), now);
  }
}

export function normalizeIntegratedWebSearchProvider(value: unknown): IntegratedWebSearchProvider {
  if (value === "brave" || value === "tavily" || value === "doubao") {
    return value;
  }
  return "tavily";
}

function normalizeStoredIntegratedWebSearchSettings(value: unknown): StoredIntegratedWebSearchSettings {
  if (!value || typeof value !== "object") {
    return { enabled: false, provider: "tavily", encryptedApiKey: "" };
  }
  const record = value as Record<string, unknown>;
  const enabled = record.enabled === true;
  const provider = normalizeIntegratedWebSearchProvider(record.provider);
  const encryptedApiKey = typeof record.encryptedApiKey === "string" ? record.encryptedApiKey : "";
  return { enabled, provider, encryptedApiKey };
}

export function isIntegratedWebSearchSettingsSaveInput(
  value: unknown,
): value is IntegratedWebSearchSettingsSaveInput {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.enabled !== undefined && typeof record.enabled !== "boolean") {
    return false;
  }
  if (
    record.provider !== undefined &&
    record.provider !== "brave" &&
    record.provider !== "tavily" &&
    record.provider !== "doubao"
  ) {
    return false;
  }
  if (record.apiKey !== undefined && typeof record.apiKey !== "string") {
    return false;
  }
  return true;
}

export function isIntegratedWebSearchSettingsSnapshot(
  value: unknown,
): value is IntegratedWebSearchSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.enabled !== "boolean") {
    return false;
  }
  if (record.provider !== "brave" && record.provider !== "tavily" && record.provider !== "doubao") {
    return false;
  }
  if (typeof record.hasApiKey !== "boolean") {
    return false;
  }
  return true;
}
