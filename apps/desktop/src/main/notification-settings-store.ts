import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  defaultNotificationSettings,
  type NotificationSettingsSnapshot,
  normalizeNotificationSettingsSnapshot,
} from "../shared/notification-settings";

export type { NotificationSettingsSnapshot } from "../shared/notification-settings";
export {
  defaultNotificationSettings,
  isNotificationSettingsSnapshot,
  normalizeNotificationSettingsSnapshot,
} from "../shared/notification-settings";

export async function createNotificationSettingsStore(dbPath: string): Promise<NotificationSettingsStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new NotificationSettingsStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class NotificationSettingsStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notification_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(): NotificationSettingsSnapshot {
    const row = this.db
      .prepare(`SELECT value_json FROM notification_settings WHERE key = ?`)
      .get("snapshot") as { value_json: string } | undefined;
    if (!row) {
      return defaultNotificationSettings();
    }
    try {
      return normalizeNotificationSettingsSnapshot(JSON.parse(row.value_json));
    } catch {
      return defaultNotificationSettings();
    }
  }

  save(snapshot: NotificationSettingsSnapshot): NotificationSettingsSnapshot {
    const normalized = normalizeNotificationSettingsSnapshot(snapshot);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO notification_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run("snapshot", JSON.stringify(normalized), now);
    return this.get();
  }
}
