import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

export const GLOBAL_USER_RULES_MAX_CHARS = 10_000;

export interface PersonalizationSettingsSnapshot {
  /** Cross-core personal rules injected into Claude append / Codex developerInstructions. */
  globalRules?: string;
}

export function defaultPersonalizationSettings(): PersonalizationSettingsSnapshot {
  return {};
}

export async function createPersonalizationSettingsStore(
  dbPath: string,
): Promise<PersonalizationSettingsStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new PersonalizationSettingsStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class PersonalizationSettingsStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS personalization_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(): PersonalizationSettingsSnapshot {
    const row = this.db
      .prepare(`SELECT value_json FROM personalization_settings WHERE key = ?`)
      .get("snapshot") as { value_json: string } | undefined;
    if (!row) {
      return defaultPersonalizationSettings();
    }
    try {
      return normalizePersonalizationSettingsSnapshot(JSON.parse(row.value_json));
    } catch {
      return defaultPersonalizationSettings();
    }
  }

  save(snapshot: PersonalizationSettingsSnapshot): PersonalizationSettingsSnapshot {
    const normalized = normalizePersonalizationSettingsSnapshot(snapshot);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO personalization_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run("snapshot", JSON.stringify(normalized), now);
    return this.get();
  }
}

export function normalizePersonalizationSettingsSnapshot(value: unknown): PersonalizationSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return defaultPersonalizationSettings();
  }
  const record = value as Record<string, unknown>;
  const globalRules = normalizeGlobalRules(record.globalRules);
  return {
    ...(globalRules ? { globalRules } : {}),
  };
}

function normalizeGlobalRules(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > GLOBAL_USER_RULES_MAX_CHARS) {
    return trimmed.slice(0, GLOBAL_USER_RULES_MAX_CHARS);
  }
  return trimmed;
}

export function isPersonalizationSettingsSnapshot(value: unknown): value is PersonalizationSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.globalRules !== undefined && typeof record.globalRules !== "string") {
    return false;
  }
  return true;
}
