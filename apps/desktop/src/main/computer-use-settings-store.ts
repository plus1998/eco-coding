import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  type ComputerUseSettingsSnapshot,
  defaultComputerUseSettings,
  normalizeComputerUseSettingsSnapshot,
} from "../shared/computer-use";

export type { ComputerUseSettingsSnapshot } from "../shared/computer-use";
export {
  defaultComputerUseSettings,
  isComputerUseSettingsSnapshot,
  normalizeComputerUseSettingsSnapshot,
} from "../shared/computer-use";

export async function createComputerUseSettingsStore(
  dbPath: string,
): Promise<ComputerUseSettingsStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new ComputerUseSettingsStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class ComputerUseSettingsStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS computer_use_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(): ComputerUseSettingsSnapshot {
    const row = this.db
      .prepare(`SELECT value_json FROM computer_use_settings WHERE key = ?`)
      .get("snapshot") as { value_json: string } | undefined;
    if (!row) {
      return defaultComputerUseSettings();
    }
    try {
      return normalizeComputerUseSettingsSnapshot(JSON.parse(row.value_json));
    } catch {
      return defaultComputerUseSettings();
    }
  }

  save(snapshot: ComputerUseSettingsSnapshot): ComputerUseSettingsSnapshot {
    const normalized = normalizeComputerUseSettingsSnapshot(snapshot);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO computer_use_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run("snapshot", JSON.stringify(normalized), now);
    return this.get();
  }
}
