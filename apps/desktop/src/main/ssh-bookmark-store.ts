import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { LocalSecretCodec } from "./local-secret-codec";
import {
  defaultSshBookmarkListSnapshot,
  normalizeSshBookmarkListSnapshot,
  normalizeSshBookmarkPublic,
  sshBookmarkSecretKeyKey,
  sshBookmarkSecretPasswordKey,
  validateSshBookmarkSaveInput,
  type SshBookmarkListSnapshot,
  type SshBookmarkPublic,
  type SshBookmarkSaveInput,
  type SshBookmarkView,
} from "../shared/ssh-bookmarks";

export type {
  SshBookmarkConnectResult,
  SshBookmarkListSnapshot,
  SshBookmarkPublic,
  SshBookmarkSaveInput,
  SshBookmarkView,
} from "../shared/ssh-bookmarks";
export {
  defaultSshBookmarkListSnapshot,
  isSshBookmarkListSnapshot,
  normalizeSshBookmarkListSnapshot,
  sshBookmarkEndpointLabel,
  sshBookmarkSecretKeyKey,
  sshBookmarkSecretPasswordKey,
} from "../shared/ssh-bookmarks";

export async function createSshBookmarkStore(
  dbPath: string,
  secretCodec: LocalSecretCodec,
): Promise<SshBookmarkStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new SshBookmarkStore(new sqlite.DatabaseSync(dbPath), secretCodec);
  store.initialize();
  return store;
}

export class SshBookmarkStore {
  constructor(
    private readonly db: DatabaseSyncType,
    private readonly secretCodec: LocalSecretCodec,
  ) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ssh_bookmarks (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ssh_bookmark_secrets (
        bookmark_id TEXT NOT NULL,
        secret_kind TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (bookmark_id, secret_kind)
      );
    `);
  }

  getSnapshot(): SshBookmarkListSnapshot {
    const row = this.db
      .prepare(`SELECT value_json FROM ssh_bookmarks WHERE key = ?`)
      .get("snapshot") as { value_json: string } | undefined;
    if (!row) {
      return defaultSshBookmarkListSnapshot();
    }
    try {
      return normalizeSshBookmarkListSnapshot(JSON.parse(row.value_json));
    } catch {
      return defaultSshBookmarkListSnapshot();
    }
  }

  list(): SshBookmarkView[] {
    const snapshot = this.getSnapshot();
    return snapshot.bookmarks.map((bookmark) => this.toView(bookmark));
  }

  getPublic(id: string): SshBookmarkPublic | undefined {
    return this.getSnapshot().bookmarks.find((item) => item.id === id);
  }

  getPassword(id: string): string | undefined {
    return this.readSecret(id, "password");
  }

  getStoredKey(id: string): string | undefined {
    return this.readSecret(id, "key");
  }

  save(input: SshBookmarkSaveInput): SshBookmarkView {
    const snapshot = this.getSnapshot();
    const trimmedId = input.id?.trim();
    const existing = trimmedId ? snapshot.bookmarks.find((item) => item.id === trimmedId) : undefined;
    const isEdit = Boolean(existing);
    const validation = validateSshBookmarkSaveInput(
      input,
      snapshot,
      isEdit,
      Boolean(existing && this.hasSecret(existing.id, "password")),
      Boolean(existing && this.hasSecret(existing.id, "key")),
    );
    if (!validation.ok) {
      throw new Error(validation.reason);
    }

    const id = trimmedId || randomUUID();
    const order =
      existing?.order ??
      snapshot.bookmarks.reduce((max, item) => Math.max(max, item.order), -1) + 1;
    const bookmark = normalizeSshBookmarkPublic(
      {
        id,
        name: input.name,
        host: input.host,
        port: input.port,
        username: input.username,
        authType: input.authType,
        keySource: input.keySource,
        keyPath: input.keyPath,
        extraArgs: input.extraArgs,
        order,
      },
      order,
    );
    if (!bookmark) {
      throw new Error("invalid_bookmark");
    }

    const nextBookmarks = isEdit
      ? snapshot.bookmarks.map((item) => (item.id === id ? bookmark : item))
      : [...snapshot.bookmarks, bookmark];
    this.persistSnapshot({ bookmarks: nextBookmarks });

    if (bookmark.authType === "password") {
      this.clearSecret(id, "key");
      const password = input.password?.trim();
      if (password) {
        this.writeSecret(id, "password", password);
      }
    } else {
      this.clearSecret(id, "password");
      if (bookmark.keySource === "stored") {
        const storedKey = input.storedKey?.trim();
        if (storedKey) {
          this.writeSecret(id, "key", storedKey);
        }
      } else {
        this.clearSecret(id, "key");
      }
    }

    return this.toView(bookmark);
  }

  delete(id: string): SshBookmarkView[] {
    const snapshot = this.getSnapshot();
    const next = snapshot.bookmarks.filter((item) => item.id !== id);
    this.persistSnapshot({ bookmarks: next });
    this.clearSecret(id, "password");
    this.clearSecret(id, "key");
    return next.map((bookmark) => this.toView(bookmark));
  }

  replaceMetadata(snapshot: SshBookmarkListSnapshot): void {
    const normalized = normalizeSshBookmarkListSnapshot(snapshot);
    const ids = new Set(normalized.bookmarks.map((item) => item.id));
    for (const row of this.db.prepare(`SELECT bookmark_id FROM ssh_bookmark_secrets`).all() as {
      bookmark_id: string;
    }[]) {
      if (!ids.has(row.bookmark_id)) {
        this.clearSecret(row.bookmark_id, "password");
        this.clearSecret(row.bookmark_id, "key");
      }
    }
    this.persistSnapshot(normalized);
  }

  setPassword(id: string, password: string): void {
    this.writeSecret(id, "password", password);
  }

  setStoredKey(id: string, key: string): void {
    this.writeSecret(id, "key", key);
  }

  clearPassword(id: string): void {
    this.clearSecret(id, "password");
  }

  clearStoredKey(id: string): void {
    this.clearSecret(id, "key");
  }

  close(): void {
    this.db.close();
  }

  replaceFromSync(snapshot: SshBookmarkListSnapshot, secrets: { id: string; password?: string; key?: string }[]): void {
    const normalized = normalizeSshBookmarkListSnapshot(snapshot);
    this.persistSnapshot(normalized);
    const ids = new Set(normalized.bookmarks.map((item) => item.id));
    for (const row of this.db.prepare(`SELECT bookmark_id, secret_kind FROM ssh_bookmark_secrets`).all() as {
      bookmark_id: string;
      secret_kind: string;
    }[]) {
      if (!ids.has(row.bookmark_id)) {
        this.clearSecret(row.bookmark_id, row.secret_kind === "password" ? "password" : "key");
      }
    }
    for (const secret of secrets) {
      if (!ids.has(secret.id)) {
        continue;
      }
      if (secret.password?.trim()) {
        this.writeSecret(secret.id, "password", secret.password.trim());
      }
      if (secret.key?.trim()) {
        this.writeSecret(secret.id, "key", secret.key.trim());
      }
    }
  }

  collectPlainSecrets(): { id: string; password?: string; key?: string }[] {
    const snapshot = this.getSnapshot();
    return snapshot.bookmarks.map((bookmark) => {
      const password = this.getPassword(bookmark.id);
      const key = this.getStoredKey(bookmark.id);
      return {
        id: bookmark.id,
        ...(password ? { password } : {}),
        ...(key ? { key } : {}),
      };
    });
  }

  private toView(bookmark: SshBookmarkPublic): SshBookmarkView {
    return {
      ...bookmark,
      hasPassword: this.hasSecret(bookmark.id, "password"),
      hasStoredKey: this.hasSecret(bookmark.id, "key"),
    };
  }

  private persistSnapshot(snapshot: SshBookmarkListSnapshot): void {
    const normalized = normalizeSshBookmarkListSnapshot(snapshot);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO ssh_bookmarks (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run("snapshot", JSON.stringify(normalized), now);
  }

  private hasSecret(bookmarkId: string, kind: "password" | "key"): boolean {
    const row = this.db
      .prepare(`SELECT encrypted_value FROM ssh_bookmark_secrets WHERE bookmark_id = ? AND secret_kind = ?`)
      .get(bookmarkId, kind) as { encrypted_value: string } | undefined;
    return Boolean(row?.encrypted_value?.trim());
  }

  private readSecret(bookmarkId: string, kind: "password" | "key"): string | undefined {
    const row = this.db
      .prepare(`SELECT encrypted_value FROM ssh_bookmark_secrets WHERE bookmark_id = ? AND secret_kind = ?`)
      .get(bookmarkId, kind) as { encrypted_value: string } | undefined;
    if (!row?.encrypted_value) {
      return undefined;
    }
    try {
      const value = this.secretCodec.decrypt(row.encrypted_value);
      return value.trim() ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private writeSecret(bookmarkId: string, kind: "password" | "key", value: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO ssh_bookmark_secrets (bookmark_id, secret_kind, encrypted_value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(bookmark_id, secret_kind) DO UPDATE SET
           encrypted_value = excluded.encrypted_value,
           updated_at = excluded.updated_at`,
      )
      .run(bookmarkId, kind, this.secretCodec.encrypt(value), now);
  }

  private clearSecret(bookmarkId: string, kind: "password" | "key"): void {
    this.db
      .prepare(`DELETE FROM ssh_bookmark_secrets WHERE bookmark_id = ? AND secret_kind = ?`)
      .run(bookmarkId, kind);
  }
}
