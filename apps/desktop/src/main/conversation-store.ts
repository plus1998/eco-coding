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
  AgentRole,
  CoderTodoItem,
  CoderTodoStatus,
  ThreadActivityLine,
  ThreadContextSnapshot,
  ThreadPendingPlan,
  ThreadRuntimeConfig,
  ThreadStatus,
  ThreadSummary,
  TokenCostBreakdown,
} from "../shared/ipc";
import {
  parseThreadRuntimeConfigJson,
  serializeThreadRuntimeConfig,
} from "../shared/thread-runtime-config";
import type { SerializedThreadUsageState } from "./thread-usage-accumulator";
import {
  normalizeSubagentMissionKey,
  resolveResumeAgentIdFromRecords,
} from "./subagent-session-resolve.js";
import type {
  SubagentRunPhase,
  SubagentSessionStatus,
  ThreadSubagentSessionRecord,
} from "./subagent-session-types.js";
import { isFreshSubagentRequest } from "@eco/runtime";
import type { SubagentRole } from "@eco/runtime";

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
  agent_id: string | null;
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

export type SubagentMetricsStatus = "active" | "stopped";

export interface ThreadSubagentMetricsRecord {
  threadId: string;
  agentId: string;
  role: AgentRole;
  status: SubagentMetricsStatus;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  contextOccupied: number;
  contextLimit?: number;
  ecoCostUsd: number;
  ecoCostBreakdown: TokenCostBreakdown;
  modelId?: string;
  lastRequestKey?: string;
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

      CREATE TABLE IF NOT EXISTS thread_subagent_sessions (
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        status TEXT NOT NULL,
        todo_id TEXT,
        mission_key TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, agent_id),
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_subagent_sessions_thread_role_phase
        ON thread_subagent_sessions(thread_id, role, phase, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS thread_subagent_metrics (
        thread_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        context_occupied INTEGER NOT NULL DEFAULT 0,
        context_limit INTEGER,
        eco_cost_usd REAL NOT NULL DEFAULT 0,
        eco_cost_breakdown_json TEXT,
        model_id TEXT,
        last_request_key TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, agent_id),
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );
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

    const activityColumns = this.db.prepare(`PRAGMA table_info(thread_activity)`).all() as Array<{ name: string }>;
    const activityNames = new Set(activityColumns.map((column) => column.name));
    if (!activityNames.has("agent_id")) {
      this.db.exec(`ALTER TABLE thread_activity ADD COLUMN agent_id TEXT`);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thread_subagent_metrics (
        thread_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        context_occupied INTEGER NOT NULL DEFAULT 0,
        context_limit INTEGER,
        eco_cost_usd REAL NOT NULL DEFAULT 0,
        eco_cost_breakdown_json TEXT,
        model_id TEXT,
        last_request_key TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, agent_id),
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );
    `);
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
    this.clearSubagentSessions(threadId);
  }

  upsertSubagentSessionActive(input: {
    threadId: string;
    role: SubagentRole;
    agentId: string;
    phase: SubagentRunPhase;
    todoId?: string;
    missionKey?: string;
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO thread_subagent_sessions (
           thread_id, role, agent_id, phase, status, todo_id, mission_key, updated_at
         ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
         ON CONFLICT(thread_id, agent_id) DO UPDATE SET
           role = excluded.role,
           phase = excluded.phase,
           status = 'active',
           todo_id = COALESCE(excluded.todo_id, todo_id),
           mission_key = COALESCE(excluded.mission_key, mission_key),
           updated_at = excluded.updated_at`,
      )
      .run(
        input.threadId,
        input.role,
        input.agentId,
        input.phase,
        input.todoId ?? null,
        input.missionKey ?? null,
        now,
      );
  }

  markSubagentSessionStopped(threadId: string, agentId: string): void {
    this.db
      .prepare(
        `UPDATE thread_subagent_sessions
         SET status = 'stopped', updated_at = ?
         WHERE thread_id = ? AND agent_id = ?`,
      )
      .run(new Date().toISOString(), threadId, agentId);
  }

  upsertSubagentMetrics(
    threadId: string,
    input: {
      agentId: string;
      role: AgentRole;
      status: SubagentMetricsStatus;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      contextOccupied: number;
      contextLimit?: number;
      ecoCostUsd: number;
      ecoCostBreakdown: TokenCostBreakdown;
      modelId?: string;
      lastRequestKey?: string;
    },
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO thread_subagent_metrics (
           thread_id, agent_id, role, status,
           input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
           context_occupied, context_limit, eco_cost_usd, eco_cost_breakdown_json,
           model_id, last_request_key, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, agent_id) DO UPDATE SET
           role = excluded.role,
           status = excluded.status,
           input_tokens = excluded.input_tokens,
           output_tokens = excluded.output_tokens,
           cache_read_tokens = excluded.cache_read_tokens,
           cache_creation_tokens = excluded.cache_creation_tokens,
           context_occupied = excluded.context_occupied,
           context_limit = excluded.context_limit,
           eco_cost_usd = excluded.eco_cost_usd,
           eco_cost_breakdown_json = excluded.eco_cost_breakdown_json,
           model_id = excluded.model_id,
           last_request_key = excluded.last_request_key,
           updated_at = excluded.updated_at`,
      )
      .run(
        threadId,
        input.agentId,
        input.role,
        input.status,
        input.inputTokens,
        input.outputTokens,
        input.cacheReadTokens,
        input.cacheCreationTokens,
        input.contextOccupied,
        input.contextLimit ?? null,
        input.ecoCostUsd,
        JSON.stringify(input.ecoCostBreakdown),
        input.modelId ?? null,
        input.lastRequestKey ?? null,
        now,
      );
  }

  listSubagentMetrics(threadId: string): ThreadSubagentMetricsRecord[] {
    const rows = this.db
      .prepare(
        `SELECT thread_id, agent_id, role, status,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                context_occupied, context_limit, eco_cost_usd, eco_cost_breakdown_json,
                model_id, last_request_key, updated_at
         FROM thread_subagent_metrics
         WHERE thread_id = ?
         ORDER BY updated_at DESC`,
      )
      .all(threadId) as Array<{
      thread_id: string;
      agent_id: string;
      role: string;
      status: string;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_creation_tokens: number;
      context_occupied: number;
      context_limit: number | null;
      eco_cost_usd: number;
      eco_cost_breakdown_json: string | null;
      model_id: string | null;
      last_request_key: string | null;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      threadId: row.thread_id,
      agentId: row.agent_id,
      role: row.role as AgentRole,
      status: row.status as SubagentMetricsStatus,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      contextOccupied: row.context_occupied,
      ...(row.context_limit !== null && { contextLimit: row.context_limit }),
      ecoCostUsd: row.eco_cost_usd,
      ecoCostBreakdown: parseEcoCostBreakdownJson(row.eco_cost_breakdown_json),
      ...(row.model_id && { modelId: row.model_id }),
      ...(row.last_request_key && { lastRequestKey: row.last_request_key }),
      updatedAt: row.updated_at,
    }));
  }

  clearSubagentMetrics(threadId: string): void {
    this.db.prepare(`DELETE FROM thread_subagent_metrics WHERE thread_id = ?`).run(threadId);
  }

  listSubagentSessions(threadId: string): ThreadSubagentSessionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT thread_id, role, agent_id, phase, status, todo_id, mission_key, updated_at
         FROM thread_subagent_sessions
         WHERE thread_id = ?
         ORDER BY updated_at DESC`,
      )
      .all(threadId) as Array<{
      thread_id: string;
      role: string;
      agent_id: string;
      phase: string;
      status: string;
      todo_id: string | null;
      mission_key: string | null;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      threadId: row.thread_id,
      role: row.role as SubagentRole,
      agentId: row.agent_id,
      phase: row.phase as SubagentRunPhase,
      status: row.status as SubagentSessionStatus,
      ...(row.todo_id ? { todoId: row.todo_id } : {}),
      ...(row.mission_key ? { missionKey: row.mission_key } : {}),
      updatedAt: row.updated_at,
    }));
  }

  listResumableSubagentSessions(
    threadId: string,
    phase?: SubagentRunPhase,
  ): ThreadSubagentSessionRecord[] {
    return this.listSubagentSessions(threadId).filter(
      (row) => row.status === "stopped" && (!phase || row.phase === phase),
    );
  }

  resolveResumeAgentId(input: {
    threadId: string;
    role: SubagentRole;
    phase: SubagentRunPhase;
    prompt: string;
    todoIdHint?: string;
  }): string | undefined {
    const records = this.listSubagentSessions(input.threadId);
    return resolveResumeAgentIdFromRecords(records, {
      role: input.role,
      phase: input.phase,
      prompt: input.prompt,
      ...(input.todoIdHint && { todoIdHint: input.todoIdHint }),
      freshRequest: isFreshSubagentRequest(input.prompt),
    });
  }

  clearSubagentSessions(threadId: string): void {
    this.db.prepare(`DELETE FROM thread_subagent_sessions WHERE thread_id = ?`).run(threadId);
  }

  clearSubagentSessionsForPhase(threadId: string, phase: SubagentRunPhase): void {
    this.db
      .prepare(`DELETE FROM thread_subagent_sessions WHERE thread_id = ? AND phase = ?`)
      .run(threadId, phase);
  }

  saveRouteFingerprint(threadId: string, fingerprint: string): void {
    const previous = this.getRouteFingerprint(threadId);
    if (previous && previous !== fingerprint) {
      this.clearSubagentSessions(threadId);
    }
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

  private activityLineMatchesForMerge(
    last: ThreadActivityLine & { id: string },
    line: Omit<ThreadActivityLine, "id"> & { id?: string },
  ): boolean {
    if (last.role !== line.role) {
      return false;
    }
    const lastAgentId = last.agentId?.trim() ?? "";
    const nextAgentId = line.agentId?.trim() ?? "";
    return lastAgentId === nextAgentId;
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
    if (!line.stream && last?.stream && this.activityLineMatchesForMerge(last, line)) {
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
    if (line.stream && last?.stream && this.activityLineMatchesForMerge(last, line)) {
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
      ...(line.agentId?.trim() && { agentId: line.agentId.trim() }),
    };
    this.db
      .prepare(
        `INSERT INTO thread_activity (id, thread_id, role, message, stream, agent_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        threadId,
        record.role,
        record.message,
        line.stream ? 1 : 0,
        record.agentId ?? null,
        new Date().toISOString(),
      );

    this.db
      .prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), threadId);

    logSuspiciousActivityLine(threadId, record);
    return record;
  }

  listActivityLines(threadId: string): ThreadActivityLine[] {
    const rows = this.db
      .prepare(
        `SELECT id, role, message, stream, agent_id
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
        ...(row.agent_id?.trim() && { agentId: row.agent_id.trim() }),
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
        `SELECT id, role, message, stream, agent_id
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
      ...(row.agent_id?.trim() && { agentId: row.agent_id.trim() }),
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

function parseEcoCostBreakdownJson(raw: string | null): TokenCostBreakdown {
  const empty = { inputUsd: 0, outputUsd: 0, cacheReadUsd: 0, cacheCreationUsd: 0, totalUsd: 0 };
  if (!raw) {
    return empty;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<TokenCostBreakdown>;
    return {
      inputUsd: parsed.inputUsd ?? 0,
      outputUsd: parsed.outputUsd ?? 0,
      cacheReadUsd: parsed.cacheReadUsd ?? 0,
      cacheCreationUsd: parsed.cacheCreationUsd ?? 0,
      totalUsd: parsed.totalUsd ?? 0,
    };
  } catch {
    return empty;
  }
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
