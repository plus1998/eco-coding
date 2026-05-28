import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { ThreadActivityLine, ThreadStatus, ThreadSummary } from "../shared/ipc";

interface ThreadRow {
  id: string;
  title: string;
  prompt: string;
  workspace_path: string;
  status: string;
  message: string;
  created_at: string;
  updated_at: string;
}

interface ActivityRow {
  id: string;
  thread_id: string;
  role: string;
  message: string;
  stream: number;
  created_at: string;
}

export async function createConversationStore(dbPath: string): Promise<ConversationStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new ConversationStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class ConversationStore {
  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_threads_workspace_updated
        ON threads(workspace_path, updated_at DESC);

      CREATE TABLE IF NOT EXISTS thread_activity (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        message TEXT NOT NULL,
        stream INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_activity_thread_created
        ON thread_activity(thread_id, created_at);
    `);
  }

  saveThread(thread: ThreadSummary): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO threads (id, title, prompt, workspace_path, status, message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           prompt = excluded.prompt,
           workspace_path = excluded.workspace_path,
           status = excluded.status,
           message = excluded.message,
           updated_at = excluded.updated_at`,
      )
      .run(
        thread.id,
        thread.title,
        thread.prompt,
        thread.workspacePath,
        thread.status,
        thread.message,
        thread.createdAt,
        now,
      );
  }

  updateThread(threadId: string, patch: Pick<ThreadSummary, "status" | "message">): void {
    this.db
      .prepare(
        `UPDATE threads
         SET status = ?, message = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(patch.status, patch.message, new Date().toISOString(), threadId);
  }

  listThreads(): ThreadSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, prompt, workspace_path, status, message, created_at
         FROM threads
         ORDER BY updated_at DESC`,
      )
      .all() as ThreadRow[];

    return rows.map(rowToThread);
  }

  getThread(threadId: string): ThreadSummary | undefined {
    const row = this.db
      .prepare(
        `SELECT id, title, prompt, workspace_path, status, message, created_at
         FROM threads
         WHERE id = ?`,
      )
      .get(threadId) as ThreadRow | undefined;

    return row ? rowToThread(row) : undefined;
  }

  appendActivityLine(
    threadId: string,
    line: Omit<ThreadActivityLine, "id"> & { id?: string },
  ): ThreadActivityLine {
    const last = this.getLastActivityLine(threadId);
    if (line.stream && last?.stream && last.role === line.role) {
      const merged = `${last.message}${line.message}`;
      this.db
        .prepare(`UPDATE thread_activity SET message = ? WHERE id = ?`)
        .run(merged, last.id);
      return { ...last, message: merged };
    }

    const record: ThreadActivityLine = {
      id: line.id ?? `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: line.role,
      message: line.message,
      stream: line.stream,
    };
    this.db
      .prepare(
        `INSERT INTO thread_activity (id, thread_id, role, message, stream, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(record.id, threadId, record.role, record.message, line.stream ? 1 : 0, new Date().toISOString());

    this.db
      .prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), threadId);

    return record;
  }

  listActivityLines(threadId: string): ThreadActivityLine[] {
    const rows = this.db
      .prepare(
        `SELECT id, role, message, stream
         FROM thread_activity
         WHERE thread_id = ?
         ORDER BY created_at ASC`,
      )
      .all(threadId) as ActivityRow[];

    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      message: row.message,
      stream: row.stream === 1,
    }));
  }

  private getLastActivityLine(threadId: string): (ThreadActivityLine & { id: string }) | undefined {
    const row = this.db
      .prepare(
        `SELECT id, role, message, stream
         FROM thread_activity
         WHERE thread_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(threadId) as ActivityRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      role: row.role,
      message: row.message,
      stream: row.stream === 1,
    };
  }
}

function rowToThread(row: ThreadRow): ThreadSummary {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    workspacePath: row.workspace_path,
    status: row.status as ThreadStatus,
    message: row.message,
    createdAt: row.created_at,
  };
}
