import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

export type SessionStoreEntry = Record<string, unknown>;

export interface SessionKey {
  projectKey: string;
  sessionId: string;
  subpath?: string;
}

export interface SessionStoreListEntry {
  sessionId: string;
  mtime: number;
}

export interface SessionStore {
  append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void>;
  load(key: SessionKey): Promise<SessionStoreEntry[] | null>;
  listSessions?(projectKey: string): Promise<SessionStoreListEntry[]>;
  delete?(key: SessionKey): Promise<void>;
  listSubkeys?(key: { projectKey: string; sessionId: string }): Promise<string[]>;
}

function sessionRowKey(key: SessionKey): string {
  return `${key.projectKey}\0${key.sessionId}\0${key.subpath ?? ""}`;
}

export class InMemorySessionStore implements SessionStore {
  private readonly entries = new Map<string, SessionStoreEntry[]>();
  private readonly mtimes = new Map<string, number>();

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    const rowKey = sessionRowKey(key);
    const existing = this.entries.get(rowKey) ?? [];
    this.entries.set(rowKey, [...existing, ...entries]);
    this.mtimes.set(`${key.projectKey}\0${key.sessionId}`, Date.now());
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const rowKey = sessionRowKey(key);
    const existing = this.entries.get(rowKey);
    return existing ? [...existing] : null;
  }

  async listSessions(projectKey: string): Promise<SessionStoreListEntry[]> {
    const sessions = new Map<string, number>();
    for (const [rowKey, mtime] of this.mtimes.entries()) {
      const [storedProjectKey, sessionId] = rowKey.split("\0");
      if (storedProjectKey === projectKey && sessionId) {
        sessions.set(sessionId, mtime);
      }
    }
    return [...sessions.entries()].map(([sessionId, mtime]) => ({ sessionId, mtime }));
  }

  async delete(key: SessionKey): Promise<void> {
    if (key.subpath) {
      this.entries.delete(sessionRowKey(key));
      return;
    }
    const prefix = `${key.projectKey}\0${key.sessionId}\0`;
    for (const rowKey of [...this.entries.keys()]) {
      if (rowKey.startsWith(prefix) || rowKey === sessionRowKey(key)) {
        this.entries.delete(rowKey);
      }
    }
    this.mtimes.delete(`${key.projectKey}\0${key.sessionId}`);
  }

  async listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]> {
    const prefix = `${key.projectKey}\0${key.sessionId}\0`;
    const subpaths = new Set<string>();
    for (const rowKey of this.entries.keys()) {
      if (!rowKey.startsWith(prefix)) {
        continue;
      }
      const subpath = rowKey.slice(prefix.length);
      if (subpath) {
        subpaths.add(subpath);
      }
    }
    return [...subpaths];
  }
}

interface SessionEntryRow {
  seq: number;
  entry_json: string;
}

interface SessionIndexRow {
  session_id: string;
  mtime: number;
}

export async function createSqliteSessionStore(dbPath: string): Promise<SqliteSessionStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new SqliteSessionStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class SqliteSessionStore implements SessionStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sdk_session_entries (
        project_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        subpath TEXT NOT NULL DEFAULT '',
        seq INTEGER NOT NULL,
        entry_json TEXT NOT NULL,
        PRIMARY KEY (project_key, session_id, subpath, seq)
      );

      CREATE INDEX IF NOT EXISTS idx_sdk_session_entries_lookup
        ON sdk_session_entries(project_key, session_id, subpath, seq);

      CREATE TABLE IF NOT EXISTS sdk_session_index (
        project_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        PRIMARY KEY (project_key, session_id)
      );
    `);
  }

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    const subpath = key.subpath ?? "";
    const maxSeqRow = this.db
      .prepare(
        `SELECT COALESCE(MAX(seq), 0) AS max_seq
         FROM sdk_session_entries
         WHERE project_key = ? AND session_id = ? AND subpath = ?`,
      )
      .get(key.projectKey, key.sessionId, subpath) as { max_seq: number };
    let seq = maxSeqRow.max_seq;
    const insert = this.db.prepare(
      `INSERT INTO sdk_session_entries (project_key, session_id, subpath, seq, entry_json)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.db.exec("BEGIN");
    try {
      for (const entry of entries) {
        seq += 1;
        insert.run(key.projectKey, key.sessionId, subpath, seq, JSON.stringify(entry));
      }
      this.db
        .prepare(
          `INSERT INTO sdk_session_index (project_key, session_id, mtime)
           VALUES (?, ?, ?)
           ON CONFLICT(project_key, session_id) DO UPDATE SET mtime = excluded.mtime`,
        )
        .run(key.projectKey, key.sessionId, Date.now());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const subpath = key.subpath ?? "";
    const rows = this.db
      .prepare(
        `SELECT entry_json
         FROM sdk_session_entries
         WHERE project_key = ? AND session_id = ? AND subpath = ?
         ORDER BY seq ASC`,
      )
      .all(key.projectKey, key.sessionId, subpath) as unknown as SessionEntryRow[];

    if (rows.length === 0) {
      return null;
    }

    return rows.map((row) => JSON.parse(row.entry_json) as SessionStoreEntry);
  }

  async listSessions(projectKey: string): Promise<SessionStoreListEntry[]> {
    const rows = this.db
      .prepare(
        `SELECT session_id, mtime
         FROM sdk_session_index
         WHERE project_key = ?
         ORDER BY mtime DESC`,
      )
      .all(projectKey) as unknown as SessionIndexRow[];

    return rows.map((row) => ({ sessionId: row.session_id, mtime: row.mtime }));
  }

  async delete(key: SessionKey): Promise<void> {
    if (key.subpath) {
      this.db
        .prepare(
          `DELETE FROM sdk_session_entries
           WHERE project_key = ? AND session_id = ? AND subpath = ?`,
        )
        .run(key.projectKey, key.sessionId, key.subpath);
      return;
    }

    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(`DELETE FROM sdk_session_entries WHERE project_key = ? AND session_id = ?`)
        .run(key.projectKey, key.sessionId);
      this.db
        .prepare(`DELETE FROM sdk_session_index WHERE project_key = ? AND session_id = ?`)
        .run(key.projectKey, key.sessionId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]> {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT subpath
         FROM sdk_session_entries
         WHERE project_key = ? AND session_id = ? AND subpath != ''`,
      )
      .all(key.projectKey, key.sessionId) as unknown as Array<{ subpath: string }>;

    return rows.map((row) => row.subpath);
  }
}

export type SessionStoreFactory = () => SessionStore | Promise<SessionStore>;

export async function runSessionStoreConformance(createStore: SessionStoreFactory): Promise<void> {
  const store = await createStore();
  const projectKey = "-Users-test-proj";
  const sessionId = "session-1";
  const key: SessionKey = { projectKey, sessionId };
  const entries = [
    { type: "user", message: "hello" },
    { type: "assistant", message: "hi" },
  ];

  expectNull(await store.load(key));
  await store.append(key, entries);
  const loaded = await store.load(key);
  expectDeepEqual(loaded, entries);

  await store.append(key, [{ type: "assistant", message: "again" }]);
  const reloaded = await store.load(key);
  expectDeepEqual(reloaded, [...entries, { type: "assistant", message: "again" }]);

  if (store.listSessions) {
    const sessions = await store.listSessions(projectKey);
    if (sessions.length !== 1 || sessions[0]?.sessionId !== sessionId) {
      throw new Error("listSessions did not return the expected session");
    }
  }

  if (store.listSubkeys) {
    const subKey: SessionKey = { projectKey, sessionId, subpath: "subagents/agent-1" };
    await store.append(subKey, [{ type: "system", subtype: "init" }]);
    const subpaths = await store.listSubkeys({ projectKey, sessionId });
    if (!subpaths.includes("subagents/agent-1")) {
      throw new Error("listSubkeys did not include subagent transcript");
    }
  }

  if (store.delete) {
    await store.delete(key);
    expectNull(await store.load(key));
    if (store.listSubkeys) {
      const subpaths = await store.listSubkeys({ projectKey, sessionId });
      if (subpaths.length !== 0) {
        throw new Error("delete did not cascade subkeys");
      }
    }
  }
}

function expectNull(value: unknown): void {
  if (value !== null) {
    throw new Error(`Expected null, received ${JSON.stringify(value)}`);
  }
}

function expectDeepEqual(left: unknown, right: unknown): void {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`Expected ${JSON.stringify(right)}, received ${JSON.stringify(left)}`);
  }
}
