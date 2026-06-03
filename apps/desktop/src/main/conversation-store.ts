import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { mergeStreamText } from "@eco/runtime";
import {
  isReconnectActivityMessage,
  shouldClearReconnectActivity,
} from "../shared/activity-display";
import { logSuspiciousActivityLine, repairActivityText } from "../shared/activity-text";
import type {
  CoderTodoItem,
  CoderTodoStatus,
  ThreadActivityLine,
  ThreadContextSnapshot,
  ThreadPendingPlan,
  ThreadRuntimeConfig,
  ThreadStatus,
  ThreadSummary,
} from "../shared/ipc";
import {
  parseThreadRuntimeConfigJson,
  serializeThreadRuntimeConfig,
} from "../shared/thread-runtime-config";
import type { SerializedThreadUsageState } from "./thread-usage-accumulator";

interface ThreadRow {
  id: string;
  title: string;
  prompt: string;
  workspace_path: string;
  status: string;
  message: string;
  created_at: string;
  updated_at: string;
  sdk_session_id: string | null;
  sdk_cwd: string | null;
  routes_fingerprint: string | null;
  runtime_config_json: string | null;
}

export interface ThreadSdkSession {
  sessionId: string;
  cwd: string;
}

interface ActivityRow {
  id: string;
  thread_id: string;
  role: string;
  message: string;
  stream: number;
  created_at: string;
}

interface CoderTodoRow {
  id: string;
  thread_id: string;
  title: string;
  detail: string;
  status: string;
  position: number;
  updated_at: string;
}

export interface AppliedDiffRecord {
  threadId: string;
  workspacePath: string;
  diff: string;
  files: string[];
  appliedAt: string;
  rolledBackAt?: string;
}

export interface ThreadMetricsRecord {
  threadId: string;
  accumulator?: SerializedThreadUsageState;
  context?: ThreadContextSnapshot;
  updatedAt: string;
}

export interface ThreadCompactionArchiveRecord {
  id: string;
  threadId: string;
  trigger: "auto" | "manual";
  sessionId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface AppliedDiffRow {
  thread_id: string;
  workspace_path: string;
  diff: string;
  files_json: string;
  applied_at: string;
  rolled_back_at: string | null;
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

      CREATE TABLE IF NOT EXISTS thread_pending_plans (
        thread_id TEXT PRIMARY KEY,
        user_prompt TEXT NOT NULL,
        analysis TEXT NOT NULL,
        plan TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        routes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS thread_coder_todos (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        status TEXT NOT NULL,
        position INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_coder_todos_thread_position
        ON thread_coder_todos(thread_id, position);

      CREATE TABLE IF NOT EXISTS thread_applied_diffs (
        thread_id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        diff TEXT NOT NULL,
        files_json TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        rolled_back_at TEXT,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_applied_diffs_workspace_applied
        ON thread_applied_diffs(workspace_path, applied_at);

      CREATE TABLE IF NOT EXISTS thread_metrics_snapshots (
        thread_id TEXT PRIMARY KEY,
        accumulator_json TEXT,
        context_json TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS thread_compaction_archives (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        trigger TEXT NOT NULL,
        session_id TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_compaction_archives_thread_created
        ON thread_compaction_archives(thread_id, created_at DESC);
    `);
    this.migrateSchema();
  }

  private migrateSchema(): void {
    const columns = this.db.prepare(`PRAGMA table_info(threads)`).all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("sdk_session_id")) {
      this.db.exec(`ALTER TABLE threads ADD COLUMN sdk_session_id TEXT`);
    }
    if (!names.has("sdk_cwd")) {
      this.db.exec(`ALTER TABLE threads ADD COLUMN sdk_cwd TEXT`);
    }
    if (!names.has("routes_fingerprint")) {
      this.db.exec(`ALTER TABLE threads ADD COLUMN routes_fingerprint TEXT`);
    }
    if (!names.has("runtime_config_json")) {
      this.db.exec(`ALTER TABLE threads ADD COLUMN runtime_config_json TEXT`);
    }
  }

  saveThreadRuntimeConfig(threadId: string, config: ThreadRuntimeConfig): void {
    this.db
      .prepare(
        `UPDATE threads
         SET runtime_config_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(serializeThreadRuntimeConfig(config), new Date().toISOString(), threadId);
  }

  getThreadRuntimeConfig(threadId: string): ThreadRuntimeConfig | undefined {
    const row = this.db
      .prepare(`SELECT runtime_config_json FROM threads WHERE id = ?`)
      .get(threadId) as { runtime_config_json: string | null } | undefined;
    return parseThreadRuntimeConfigJson(row?.runtime_config_json);
  }

  saveThreadMetrics(
    threadId: string,
    input: {
      accumulator?: SerializedThreadUsageState;
      context?: ThreadContextSnapshot;
    },
  ): void {
    const hasAccumulator = input.accumulator !== undefined;
    const hasContext = input.context !== undefined;
    if (!hasAccumulator && !hasContext) {
      return;
    }

    const existing = this.getThreadMetrics(threadId);
    const accumulatorJson = hasAccumulator
      ? JSON.stringify(input.accumulator)
      : (existing?.accumulator ? JSON.stringify(existing.accumulator) : null);
    const contextJson = hasContext
      ? JSON.stringify(input.context)
      : (existing?.context ? JSON.stringify(existing.context) : null);

    if (!accumulatorJson && !contextJson) {
      return;
    }

    this.db
      .prepare(
        `INSERT INTO thread_metrics_snapshots (thread_id, accumulator_json, context_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           accumulator_json = COALESCE(excluded.accumulator_json, thread_metrics_snapshots.accumulator_json),
           context_json = COALESCE(excluded.context_json, thread_metrics_snapshots.context_json),
           updated_at = excluded.updated_at`,
      )
      .run(threadId, accumulatorJson, contextJson, new Date().toISOString());
  }

  getThreadMetrics(threadId: string): ThreadMetricsRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT thread_id, accumulator_json, context_json, updated_at
         FROM thread_metrics_snapshots
         WHERE thread_id = ?`,
      )
      .get(threadId) as
      | {
          thread_id: string;
          accumulator_json: string | null;
          context_json: string | null;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return rowToThreadMetrics(row);
  }

  saveCompactionArchive(
    threadId: string,
    input: {
      trigger: "auto" | "manual";
      sessionId?: string;
      payload: Record<string, unknown>;
    },
  ): ThreadCompactionArchiveRecord {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO thread_compaction_archives (id, thread_id, trigger, session_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        threadId,
        input.trigger,
        input.sessionId ?? null,
        JSON.stringify(input.payload),
        createdAt,
      );
    return {
      id,
      threadId,
      trigger: input.trigger,
      ...(input.sessionId && { sessionId: input.sessionId }),
      payload: input.payload,
      createdAt,
    };
  }

  listCompactionArchives(threadId: string, limit = 20): ThreadCompactionArchiveRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, thread_id, trigger, session_id, payload_json, created_at
         FROM thread_compaction_archives
         WHERE thread_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(threadId, limit) as Array<{
      id: string;
      thread_id: string;
      trigger: string;
      session_id: string | null;
      payload_json: string;
      created_at: string;
    }>;

    return rows.map((row) => {
      let payload: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(row.payload_json) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>;
        }
      } catch {
        payload = { raw: row.payload_json };
      }
      return {
        id: row.id,
        threadId: row.thread_id,
        trigger: row.trigger === "manual" ? "manual" : "auto",
        ...(row.session_id && { sessionId: row.session_id }),
        payload,
        createdAt: row.created_at,
      };
    });
  }

  listThreadMetrics(): ThreadMetricsRecord[] {
    const rows = this.db
      .prepare(
        `SELECT thread_id, accumulator_json, context_json, updated_at
         FROM thread_metrics_snapshots`,
      )
      .all() as Array<{
      thread_id: string;
      accumulator_json: string | null;
      context_json: string | null;
      updated_at: string;
    }>;

    return rows.map((row) => rowToThreadMetrics(row)).filter((entry): entry is ThreadMetricsRecord => entry !== undefined);
  }

  saveThread(thread: ThreadSummary): void {
    const now = new Date().toISOString();
    const runtimeConfigJson = thread.runtimeConfig
      ? serializeThreadRuntimeConfig(thread.runtimeConfig)
      : null;
    this.db
      .prepare(
        `INSERT INTO threads (id, title, prompt, workspace_path, status, message, created_at, updated_at, runtime_config_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           prompt = excluded.prompt,
           workspace_path = excluded.workspace_path,
           status = excluded.status,
           message = excluded.message,
           updated_at = excluded.updated_at,
           runtime_config_json = COALESCE(excluded.runtime_config_json, threads.runtime_config_json)`,
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
        runtimeConfigJson,
      );
  }

  updateThreadPrompt(threadId: string, prompt: string): void {
    this.db
      .prepare(`UPDATE threads SET prompt = ?, updated_at = ? WHERE id = ?`)
      .run(prompt, new Date().toISOString(), threadId);
  }

  updateThreadTitle(threadId: string, title: string): void {
    this.db
      .prepare(`UPDATE threads SET title = ?, updated_at = ? WHERE id = ?`)
      .run(title, new Date().toISOString(), threadId);
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

  saveSdkSession(threadId: string, sessionId: string, cwd: string): void {
    this.db
      .prepare(
        `UPDATE threads
         SET sdk_session_id = ?, sdk_cwd = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(sessionId, cwd, new Date().toISOString(), threadId);
  }

  getSdkSession(threadId: string): ThreadSdkSession | undefined {
    const row = this.db
      .prepare(`SELECT sdk_session_id, sdk_cwd FROM threads WHERE id = ?`)
      .get(threadId) as { sdk_session_id: string | null; sdk_cwd: string | null } | undefined;
    if (!row?.sdk_session_id || !row.sdk_cwd) {
      return undefined;
    }
    return { sessionId: row.sdk_session_id, cwd: row.sdk_cwd };
  }

  clearSdkSession(threadId: string): void {
    this.db
      .prepare(
        `UPDATE threads
         SET sdk_session_id = NULL, sdk_cwd = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(new Date().toISOString(), threadId);
  }

  saveRouteFingerprint(threadId: string, fingerprint: string): void {
    this.db
      .prepare(
        `UPDATE threads
         SET routes_fingerprint = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(fingerprint, new Date().toISOString(), threadId);
  }

  getRouteFingerprint(threadId: string): string | undefined {
    const row = this.db
      .prepare(`SELECT routes_fingerprint FROM threads WHERE id = ?`)
      .get(threadId) as { routes_fingerprint: string | null } | undefined;
    const value = row?.routes_fingerprint?.trim();
    return value || undefined;
  }

  listThreads(): ThreadSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, prompt, workspace_path, status, message, created_at, sdk_session_id, sdk_cwd, runtime_config_json
         FROM threads
         ORDER BY created_at DESC`,
      )
      .all() as unknown as ThreadRow[];

    return rows.map(rowToThread);
  }

  getThread(threadId: string): ThreadSummary | undefined {
    const row = this.db
      .prepare(
        `SELECT id, title, prompt, workspace_path, status, message, created_at, sdk_session_id, sdk_cwd, runtime_config_json
         FROM threads
         WHERE id = ?`,
      )
      .get(threadId) as ThreadRow | undefined;

    return row ? rowToThread(row) : undefined;
  }

  private clearReconnectActivityLines(threadId: string): void {
    const rows = this.db
      .prepare(`SELECT id, message FROM thread_activity WHERE thread_id = ?`)
      .all(threadId) as Array<{ id: string; message: string }>;
    const deleteStmt = this.db.prepare(`DELETE FROM thread_activity WHERE id = ?`);
    for (const row of rows) {
      if (isReconnectActivityMessage(row.message)) {
        deleteStmt.run(row.id);
      }
    }
  }

  appendActivityLine(
    threadId: string,
    line: Omit<ThreadActivityLine, "id"> & { id?: string },
  ): ThreadActivityLine {
    let last = this.getLastActivityLine(threadId);
    if (isReconnectActivityMessage(line.message)) {
      if (last && isReconnectActivityMessage(last.message)) {
        this.db
          .prepare(`UPDATE thread_activity SET message = ?, role = ? WHERE id = ?`)
          .run(line.message, line.role, last.id);
        return { ...last, message: line.message, role: line.role };
      }
    } else if (shouldClearReconnectActivity({ message: line.message, role: line.role })) {
      this.clearReconnectActivityLines(threadId);
      last = this.getLastActivityLine(threadId);
    }
    if (!line.stream && last?.stream && last.role === line.role) {
      const merged = line.message.trim()
        ? mergeStreamText(last.message, line.message)
        : last.message;
      this.db
        .prepare(`UPDATE thread_activity SET message = ?, stream = 0 WHERE id = ?`)
        .run(merged, last.id);
      const finalized = { ...last, message: merged, stream: false };
      logSuspiciousActivityLine(threadId, finalized);
      return finalized;
    }
    if (line.stream && last?.stream) {
      const merged = mergeStreamText(last.message, line.message);
      this.db
        .prepare(`UPDATE thread_activity SET message = ? WHERE id = ?`)
        .run(merged, last.id);
      return { ...last, message: merged };
    }

    const record: ThreadActivityLine = {
      id: line.id ?? `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: line.role,
      message: line.message,
      ...(line.stream !== undefined && { stream: line.stream }),
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

    logSuspiciousActivityLine(threadId, record);
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
      .all(threadId) as unknown as ActivityRow[];

    const lines = rows.map((row) => {
      const { text, repaired } = repairActivityText(row.message);
      return {
        id: row.id,
        role: row.role,
        message: repaired ? text : row.message,
        stream: row.stream === 1,
      };
    });

    return lines;
  }

  savePendingPlan(plan: ThreadPendingPlan & { routesJson: string }): void {
    this.db
      .prepare(
        `INSERT INTO thread_pending_plans (
           thread_id, user_prompt, analysis, plan, workspace_path, worktree_path, routes_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           user_prompt = excluded.user_prompt,
           analysis = excluded.analysis,
           plan = excluded.plan,
           workspace_path = excluded.workspace_path,
           worktree_path = excluded.worktree_path,
           routes_json = excluded.routes_json,
           created_at = excluded.created_at`,
      )
      .run(
        plan.threadId,
        plan.userPrompt,
        plan.analysis,
        plan.plan,
        plan.workspacePath,
        plan.worktreePath,
        plan.routesJson,
        new Date().toISOString(),
      );
  }

  getPendingPlan(threadId: string): (ThreadPendingPlan & { routesJson: string }) | undefined {
    const row = this.db
      .prepare(
        `SELECT thread_id, user_prompt, analysis, plan, workspace_path, worktree_path, routes_json
         FROM thread_pending_plans
         WHERE thread_id = ?`,
      )
      .get(threadId) as
      | {
          thread_id: string;
          user_prompt: string;
          analysis: string;
          plan: string;
          workspace_path: string;
          worktree_path: string;
          routes_json: string;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      threadId: row.thread_id,
      userPrompt: row.user_prompt,
      analysis: row.analysis,
      plan: row.plan,
      workspacePath: row.workspace_path,
      worktreePath: row.worktree_path,
      routesJson: row.routes_json,
    };
  }

  clearPendingPlan(threadId: string): void {
    this.db.prepare(`DELETE FROM thread_pending_plans WHERE thread_id = ?`).run(threadId);
  }

  replaceCoderTodos(threadId: string, todos: CoderTodoItem[]): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`DELETE FROM thread_coder_todos WHERE thread_id = ?`).run(threadId);
      const insert = this.db.prepare(
        `INSERT INTO thread_coder_todos (id, thread_id, title, detail, status, position, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const todo of todos) {
        insert.run(
          todo.id,
          threadId,
          todo.title,
          todo.detail,
          todo.status,
          todo.position,
          todo.updatedAt,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listCoderTodos(threadId: string): CoderTodoItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, thread_id, title, detail, status, position, updated_at
         FROM thread_coder_todos
         WHERE thread_id = ?
         ORDER BY position ASC`,
      )
      .all(threadId) as unknown as CoderTodoRow[];

    return rows.map(rowToCoderTodo);
  }

  clearCoderTodos(threadId: string): void {
    this.db.prepare(`DELETE FROM thread_coder_todos WHERE thread_id = ?`).run(threadId);
  }

  saveAppliedDiff(threadId: string, workspacePath: string, diff: string, files: string[]): AppliedDiffRecord {
    const appliedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO thread_applied_diffs (thread_id, workspace_path, diff, files_json, applied_at, rolled_back_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(thread_id) DO UPDATE SET
           workspace_path = excluded.workspace_path,
           diff = excluded.diff,
           files_json = excluded.files_json,
           applied_at = excluded.applied_at,
           rolled_back_at = NULL`,
      )
      .run(threadId, workspacePath, diff, JSON.stringify(files), appliedAt);
    return { threadId, workspacePath, diff, files, appliedAt };
  }

  getAppliedDiff(threadId: string): AppliedDiffRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT thread_id, workspace_path, diff, files_json, applied_at, rolled_back_at
         FROM thread_applied_diffs
         WHERE thread_id = ?`,
      )
      .get(threadId) as AppliedDiffRow | undefined;
    return row ? rowToAppliedDiff(row) : undefined;
  }

  listAppliedDiffsAfter(workspacePath: string, appliedAt: string): AppliedDiffRecord[] {
    const rows = this.db
      .prepare(
        `SELECT thread_id, workspace_path, diff, files_json, applied_at, rolled_back_at
         FROM thread_applied_diffs
         WHERE workspace_path = ?
           AND applied_at > ?
           AND rolled_back_at IS NULL
         ORDER BY applied_at DESC`,
      )
      .all(workspacePath, appliedAt) as unknown as AppliedDiffRow[];
    return rows.map(rowToAppliedDiff);
  }

  markAppliedDiffRolledBack(threadId: string): void {
    this.db
      .prepare(`UPDATE thread_applied_diffs SET rolled_back_at = ? WHERE thread_id = ?`)
      .run(new Date().toISOString(), threadId);
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

function rowToCoderTodo(row: CoderTodoRow): CoderTodoItem {
  return {
    id: row.id,
    threadId: row.thread_id,
    title: row.title,
    detail: row.detail,
    status: row.status as CoderTodoStatus,
    position: row.position,
    updatedAt: row.updated_at,
  };
}

function rowToAppliedDiff(row: AppliedDiffRow): AppliedDiffRecord {
  return {
    threadId: row.thread_id,
    workspacePath: row.workspace_path,
    diff: row.diff,
    files: parseFilesJson(row.files_json),
    appliedAt: row.applied_at,
    ...(row.rolled_back_at && { rolledBackAt: row.rolled_back_at }),
  };
}

function parseFilesJson(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string");
    }
  } catch {
    return [];
  }
  return [];
}

function rowToThreadMetrics(row: {
  thread_id: string;
  accumulator_json: string | null;
  context_json: string | null;
  updated_at: string;
}): ThreadMetricsRecord | undefined {
  let accumulator: SerializedThreadUsageState | undefined;
  let context: ThreadContextSnapshot | undefined;

  if (row.accumulator_json) {
    try {
      accumulator = JSON.parse(row.accumulator_json) as SerializedThreadUsageState;
    } catch {
      accumulator = undefined;
    }
  }

  if (row.context_json) {
    try {
      context = JSON.parse(row.context_json) as ThreadContextSnapshot;
    } catch {
      context = undefined;
    }
  }

  if (!accumulator && !context) {
    return undefined;
  }

  return {
    threadId: row.thread_id,
    updatedAt: row.updated_at,
    ...(accumulator && { accumulator }),
    ...(context && { context }),
  };
}

function rowToThread(row: ThreadRow): ThreadSummary {
  const runtimeConfig = parseThreadRuntimeConfigJson(row.runtime_config_json);
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    workspacePath: row.workspace_path,
    status: row.status as ThreadStatus,
    message: row.message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.sdk_session_id && row.sdk_cwd
      ? { sdkSessionId: row.sdk_session_id, sdkCwd: row.sdk_cwd }
      : {}),
    ...(runtimeConfig ? { runtimeConfig } : {}),
  };
}
