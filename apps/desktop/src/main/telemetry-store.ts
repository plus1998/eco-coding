import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  emptyTelemetrySettings,
  normalizeTelemetrySettings,
  validateTelemetrySettings,
  type TelemetrySettingsInput,
  type TelemetrySettingsSnapshot,
} from "../shared/telemetry";

interface TelemetryRow {
  config_json: string;
  updated_at: string;
}

export async function createTelemetryStore(dbPath: string): Promise<TelemetryStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new TelemetryStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class TelemetryStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS telemetry_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const row = this.db
      .prepare(`SELECT config_json FROM telemetry_settings WHERE id = 1`)
      .get() as TelemetryRow | undefined;
    if (!row) {
      const now = new Date().toISOString();
      this.db
        .prepare(`INSERT INTO telemetry_settings (id, config_json, updated_at) VALUES (1, ?, ?)`)
        .run(JSON.stringify(emptyTelemetrySettings()), now);
    }
  }

  getSettings(): TelemetrySettingsSnapshot {
    const row = this.db
      .prepare(`SELECT config_json FROM telemetry_settings WHERE id = 1`)
      .get() as TelemetryRow | undefined;
    if (!row) {
      return emptyTelemetrySettings();
    }
    try {
      const parsed = JSON.parse(row.config_json) as TelemetrySettingsInput;
      return normalizeTelemetrySettings(parsed);
    } catch {
      return emptyTelemetrySettings();
    }
  }

  saveSettings(input: TelemetrySettingsInput): TelemetrySettingsSnapshot {
    validateTelemetrySettings(input);
    const normalized = normalizeTelemetrySettings(input);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO telemetry_settings (id, config_json, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(normalized), now);
    return normalized;
  }
}
