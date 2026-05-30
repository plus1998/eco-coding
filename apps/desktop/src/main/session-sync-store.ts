import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  previewSecret,
  type SessionSyncSettingsInput,
  type SessionSyncSettingsSnapshot,
  type SessionSyncSettingsView,
  validateSessionSyncInput,
} from "../shared/session-sync";

interface SessionSyncRow {
  redis_enabled: number;
  redis_url: string;
  redis_password: string;
  key_prefix: string;
  updated_at: string;
}

export interface SessionSyncSettingsSecret extends SessionSyncSettingsView {
  redisPassword: string;
}

const DEFAULT_KEY_PREFIX = "eco-sessions";

export async function createSessionSyncStore(dbPath: string): Promise<SessionSyncStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new SessionSyncStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class SessionSyncStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_sync_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        redis_enabled INTEGER NOT NULL DEFAULT 0,
        redis_url TEXT NOT NULL DEFAULT '',
        redis_password TEXT NOT NULL DEFAULT '',
        key_prefix TEXT NOT NULL DEFAULT '${DEFAULT_KEY_PREFIX}',
        updated_at TEXT NOT NULL
      );
    `);

    const existing = this.getRow();
    if (!existing) {
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO session_sync_config (id, redis_enabled, redis_url, redis_password, key_prefix, updated_at)
           VALUES (1, 0, '', '', ?, ?)`,
        )
        .run(DEFAULT_KEY_PREFIX, now);
    }
  }

  getSettings(): SessionSyncSettingsSnapshot {
    return { settings: rowToView(this.getRow() ?? fail("Session sync config was not initialized.")) };
  }

  getSettingsWithSecrets(): SessionSyncSettingsSecret {
    const row = this.getRow() ?? fail("Session sync config was not initialized.");
    return {
      ...rowToView(row),
      redisPassword: row.redis_password,
    };
  }

  saveSettings(input: SessionSyncSettingsInput): SessionSyncSettingsView {
    validateSessionSyncInput(input);
    const existing = this.getRow();
    const redisPassword =
      input.redisPassword && input.redisPassword.length > 0
        ? input.redisPassword
        : (existing?.redis_password ?? "");

    this.db
      .prepare(
        `UPDATE session_sync_config
         SET redis_enabled = ?, redis_url = ?, redis_password = ?, key_prefix = ?, updated_at = ?
         WHERE id = 1`,
      )
      .run(
        input.redisEnabled ? 1 : 0,
        input.redisUrl.trim(),
        redisPassword,
        input.keyPrefix.trim(),
        new Date().toISOString(),
      );

    return rowToView(this.getRow() ?? fail("Session sync config was not saved."));
  }

  private getRow(): SessionSyncRow | undefined {
    return this.db
      .prepare(
        `SELECT redis_enabled, redis_url, redis_password, key_prefix, updated_at
         FROM session_sync_config
         WHERE id = 1`,
      )
      .get() as SessionSyncRow | undefined;
  }
}

function rowToView(row: SessionSyncRow): SessionSyncSettingsView {
  const view: SessionSyncSettingsView = {
    redisEnabled: row.redis_enabled === 1,
    redisUrl: row.redis_url,
    keyPrefix: row.key_prefix || DEFAULT_KEY_PREFIX,
    hasRedisPassword: row.redis_password.length > 0,
  };
  const preview = previewSecret(row.redis_password);
  if (preview) {
    view.redisPasswordPreview = preview;
  }
  return view;
}

function fail(message: string): never {
  throw new Error(message);
}
