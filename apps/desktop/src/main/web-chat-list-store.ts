import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  type WebChatListSnapshot,
  type WebChatListView,
  defaultWebChatListSnapshot,
  mergeWebChatList,
  normalizeWebChatListSnapshot,
} from "../shared/web-chat-list";

export type { WebChatListSnapshot, WebChatListView } from "../shared/web-chat-list";
export {
  defaultWebChatListSnapshot,
  isWebChatListSnapshot,
  mergeWebChatList,
  normalizeWebChatListSnapshot,
} from "../shared/web-chat-list";

export async function createWebChatListStore(dbPath: string): Promise<WebChatListStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new WebChatListStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class WebChatListStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS web_chat_list (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  getSnapshot(): WebChatListSnapshot {
    const row = this.db
      .prepare(`SELECT value_json FROM web_chat_list WHERE key = ?`)
      .get("snapshot") as { value_json: string } | undefined;
    if (!row) {
      return defaultWebChatListSnapshot();
    }
    try {
      return normalizeWebChatListSnapshot(JSON.parse(row.value_json));
    } catch {
      return defaultWebChatListSnapshot();
    }
  }

  /** Builtins + customs for the UI. */
  get(): WebChatListView {
    return mergeWebChatList(this.getSnapshot());
  }

  save(snapshot: WebChatListSnapshot): WebChatListView {
    const normalized = normalizeWebChatListSnapshot(snapshot);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO web_chat_list (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run("snapshot", JSON.stringify(normalized), now);
    return this.get();
  }
}
