import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  type BrowserSettingsSnapshot,
  defaultBrowserSettings,
  normalizeBrowserSettingsSnapshot,
} from "../shared/browser";

export type { BrowserSettingsSnapshot } from "../shared/browser";
export {
  defaultBrowserSettings,
  isBrowserSettingsSnapshot,
  normalizeBrowserSettingsSnapshot,
} from "../shared/browser";

export async function createBrowserSettingsStore(dbPath: string): Promise<BrowserSettingsStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new BrowserSettingsStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class BrowserSettingsStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS browser_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(): BrowserSettingsSnapshot {
    const row = this.db.prepare(`SELECT value_json FROM browser_settings WHERE key = ?`).get("snapshot") as
      | { value_json: string }
      | undefined;
    if (!row) {
      return defaultBrowserSettings();
    }
    try {
      return normalizeBrowserSettingsSnapshot(JSON.parse(row.value_json));
    } catch {
      return defaultBrowserSettings();
    }
  }

  save(snapshot: BrowserSettingsSnapshot): BrowserSettingsSnapshot {
    const normalized = normalizeBrowserSettingsSnapshot(snapshot);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO browser_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run("snapshot", JSON.stringify(normalized), now);
    return this.get();
  }
}
