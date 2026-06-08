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
  RuntimeAgentRole,
  ThreadActivityLine,
  ThreadApiErrorInfo,
  ThreadContextSnapshot,
  ThreadPendingPlan,
  ThreadRunEvent,
  ThreadRunEventInput,
  ThreadRunToolMetadata,
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
import type {
  AgentInstanceRecord,
  AgentInstanceStatus,
  AgentInstanceKind,
  RunAttemptPhase,
  RunAttemptRecord,
  RunAttemptStatus,
  UsageAttribution,
  UsageLedgerEvent,
  UsageLedgerKind,
  UsageLedgerSource,
} from "./usage-ledger";

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

export interface FileCheckpointRecord {
  userMessageId: string;
  activityLineId?: string;
  createdAt: string;
}

export interface ThreadActivityRewindSummary {
  activityLineId: string;
  userMessageId: string;
  cutoffCreatedAt: string;
  cutoffRunSequence: number;
  removedActivityCount: number;
  removedRunEventCount: number;
}

interface ActivityRow {
  id: string;
  thread_id: string;
  role: string;
  message: string;
  stream: number;
  agent_id: string | null;
  api_error_json: string | null;
  sdk_user_message_id: string | null;
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
  role: RuntimeAgentRole;
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

interface UsageLedgerEventRow {
  id: string;
  idempotency_key: string;
  thread_id: string;
  run_attempt_id: string | null;
  agent_id: string | null;
  parent_tool_use_id: string | null;
  source: string;
  source_event_id: string;
  request_key: string | null;
  provider_request_id: string | null;
  sdk_message_id: string | null;
  usage_kind: string;
  role: string;
  model_id: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  reported_cost_usd: number | null;
  attribution_json: string;
  metadata_json: string | null;
  observed_at: string;
}

interface ThreadRunEventRow {
  id: string;
  thread_id: string;
  sequence: number;
  event_type: string;
  scope: string;
  role: string | null;
  agent_id: string | null;
  parent_agent_id: string | null;
  parent_tool_use_id: string | null;
  run_attempt_id: string | null;
  request_id: string | null;
  stream_key: string | null;
  stream_state: string;
  message: string;
  metadata_json: string | null;
  observed_at: string;
}

const threadOwnedTables = [
  "thread_activity",
  "thread_pending_plans",
  "thread_coder_todos",
  "thread_applied_diffs",
  "thread_metrics_snapshots",
  "thread_compaction_archives",
  "thread_subagent_sessions",
  "thread_subagent_metrics",
  "thread_run_attempts",
  "thread_agent_instances",
  "thread_usage_ledger_events",
  "thread_run_events",
  "thread_file_checkpoints",
] as const;

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
        sdk_user_message_id TEXT,
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
        started_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        ended_at TEXT,
        accumulated_ms INTEGER NOT NULL DEFAULT 0,
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

      CREATE TABLE IF NOT EXISTS thread_run_attempts (
        thread_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        retry_index INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        metadata_json TEXT,
        PRIMARY KEY (thread_id, attempt_id),
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS thread_agent_instances (
        thread_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        run_attempt_id TEXT,
        parent_agent_id TEXT,
        parent_tool_use_id TEXT,
        mission_key TEXT,
        todo_id TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        updated_at TEXT NOT NULL,
        metadata_json TEXT,
        PRIMARY KEY (thread_id, agent_id),
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_agent_instances_thread_parent
        ON thread_agent_instances(thread_id, parent_agent_id, parent_tool_use_id);

      CREATE TABLE IF NOT EXISTS thread_usage_ledger_events (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        thread_id TEXT NOT NULL,
        run_attempt_id TEXT,
        agent_id TEXT,
        parent_tool_use_id TEXT,
        source TEXT NOT NULL,
        source_event_id TEXT NOT NULL,
        request_key TEXT,
        provider_request_id TEXT,
        sdk_message_id TEXT,
        usage_kind TEXT NOT NULL,
        role TEXT NOT NULL,
        model_id TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        reported_cost_usd REAL,
        attribution_json TEXT NOT NULL,
        metadata_json TEXT,
        observed_at TEXT NOT NULL,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_usage_ledger_thread_observed
        ON thread_usage_ledger_events(thread_id, observed_at, id);

      CREATE TABLE IF NOT EXISTS thread_run_events (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        scope TEXT NOT NULL,
        role TEXT,
        agent_id TEXT,
        parent_agent_id TEXT,
        parent_tool_use_id TEXT,
        run_attempt_id TEXT,
        request_id TEXT,
        stream_key TEXT,
        stream_state TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata_json TEXT,
        observed_at TEXT NOT NULL,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_run_events_thread_sequence
        ON thread_run_events(thread_id, sequence, id);

      CREATE INDEX IF NOT EXISTS idx_thread_run_events_thread_agent
        ON thread_run_events(thread_id, agent_id, sequence);
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
    if (!activityNames.has("api_error_json")) {
      this.db.exec(`ALTER TABLE thread_activity ADD COLUMN api_error_json TEXT`);
    }
    if (!activityNames.has("sdk_user_message_id")) {
      this.db.exec(`ALTER TABLE thread_activity ADD COLUMN sdk_user_message_id TEXT`);
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_thread_activity_thread_sdk_user_message
        ON thread_activity(thread_id, sdk_user_message_id);
    `);

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

    const sessionColumns = this.db
      .prepare(`PRAGMA table_info(thread_subagent_sessions)`)
      .all() as Array<{ name: string }>;
    const sessionNames = new Set(sessionColumns.map((column) => column.name));
    if (!sessionNames.has("started_at")) {
      this.db.exec(`ALTER TABLE thread_subagent_sessions ADD COLUMN started_at TEXT`);
    }
    if (!sessionNames.has("last_active_at")) {
      this.db.exec(`ALTER TABLE thread_subagent_sessions ADD COLUMN last_active_at TEXT`);
    }
    if (!sessionNames.has("ended_at")) {
      this.db.exec(`ALTER TABLE thread_subagent_sessions ADD COLUMN ended_at TEXT`);
    }
    if (!sessionNames.has("accumulated_ms")) {
      this.db.exec(
        `ALTER TABLE thread_subagent_sessions ADD COLUMN accumulated_ms INTEGER NOT NULL DEFAULT 0`,
      );
    }
    this.db.exec(`
      UPDATE thread_subagent_sessions
      SET started_at = COALESCE(started_at, updated_at),
          last_active_at = COALESCE(last_active_at, updated_at),
          accumulated_ms = COALESCE(accumulated_ms, 0)
      WHERE started_at IS NULL OR last_active_at IS NULL
    `);
    this.db.exec(`
      UPDATE thread_subagent_sessions
      SET ended_at = updated_at
      WHERE status = 'stopped' AND ended_at IS NULL
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thread_file_checkpoints (
        thread_id TEXT NOT NULL,
        user_message_id TEXT NOT NULL,
        activity_line_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, user_message_id),
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );
    `);
    const checkpointColumns = this.db
      .prepare(`PRAGMA table_info(thread_file_checkpoints)`)
      .all() as Array<{ name: string }>;
    const checkpointNames = new Set(checkpointColumns.map((column) => column.name));
    if (!checkpointNames.has("activity_line_id")) {
      this.db.exec(`ALTER TABLE thread_file_checkpoints ADD COLUMN activity_line_id TEXT`);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thread_run_attempts (
        thread_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        retry_index INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        metadata_json TEXT,
        PRIMARY KEY (thread_id, attempt_id),
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS thread_agent_instances (
        thread_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        run_attempt_id TEXT,
        parent_agent_id TEXT,
        parent_tool_use_id TEXT,
        mission_key TEXT,
        todo_id TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        updated_at TEXT NOT NULL,
        metadata_json TEXT,
        PRIMARY KEY (thread_id, agent_id),
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_agent_instances_thread_parent
        ON thread_agent_instances(thread_id, parent_agent_id, parent_tool_use_id);

      CREATE TABLE IF NOT EXISTS thread_usage_ledger_events (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        thread_id TEXT NOT NULL,
        run_attempt_id TEXT,
        agent_id TEXT,
        parent_tool_use_id TEXT,
        source TEXT NOT NULL,
        source_event_id TEXT NOT NULL,
        request_key TEXT,
        provider_request_id TEXT,
        sdk_message_id TEXT,
        usage_kind TEXT NOT NULL,
        role TEXT NOT NULL,
        model_id TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        reported_cost_usd REAL,
        attribution_json TEXT NOT NULL,
        metadata_json TEXT,
        observed_at TEXT NOT NULL,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_usage_ledger_thread_observed
        ON thread_usage_ledger_events(thread_id, observed_at, id);

      CREATE TABLE IF NOT EXISTS thread_run_events (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        scope TEXT NOT NULL,
        role TEXT,
        agent_id TEXT,
        parent_agent_id TEXT,
        parent_tool_use_id TEXT,
        run_attempt_id TEXT,
        request_id TEXT,
        stream_key TEXT,
        stream_state TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata_json TEXT,
        observed_at TEXT NOT NULL,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_run_events_thread_sequence
        ON thread_run_events(thread_id, sequence, id);

      CREATE INDEX IF NOT EXISTS idx_thread_run_events_thread_agent
        ON thread_run_events(thread_id, agent_id, sequence);

      CREATE TABLE IF NOT EXISTS thread_file_checkpoints (
        thread_id TEXT NOT NULL,
        user_message_id TEXT NOT NULL,
        activity_line_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, user_message_id),
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

  deleteThread(threadId: string): boolean {
    const id = threadId.trim();
    if (!id || !this.getThread(id)) {
      return false;
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of threadOwnedTables) {
        this.db.prepare(`DELETE FROM ${table} WHERE thread_id = ?`).run(id);
      }
      this.db.prepare(`DELETE FROM threads WHERE id = ?`).run(id);
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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

  saveFileCheckpoint(threadId: string, userMessageId: string, activityLineId?: string): void {
    const id = userMessageId.trim();
    if (!id) {
      return;
    }
    const lineId = activityLineId?.trim() || null;
    this.db
      .prepare(
        `INSERT INTO thread_file_checkpoints (thread_id, user_message_id, activity_line_id, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(thread_id, user_message_id) DO UPDATE SET
           activity_line_id = COALESCE(excluded.activity_line_id, thread_file_checkpoints.activity_line_id)`,
      )
      .run(threadId, id, lineId, new Date().toISOString());
  }

  listFileCheckpoints(threadId: string): FileCheckpointRecord[] {
    const rows = this.db
      .prepare(
        `SELECT user_message_id, activity_line_id, created_at
         FROM thread_file_checkpoints
         WHERE thread_id = ?
         ORDER BY created_at ASC`,
      )
      .all(threadId) as Array<{ user_message_id: string; activity_line_id: string | null; created_at: string }>;
    return rows.map((row) => ({
      userMessageId: row.user_message_id,
      ...(row.activity_line_id && { activityLineId: row.activity_line_id }),
      createdAt: row.created_at,
    }));
  }

  bindLatestUserActivityToSdkMessage(threadId: string, userMessageId: string): ThreadActivityLine | undefined {
    const id = userMessageId.trim();
    if (!threadId.trim() || !id) {
      return undefined;
    }

    const existing = this.db
      .prepare(
        `SELECT id, thread_id, role, message, stream, agent_id, api_error_json, sdk_user_message_id, created_at
         FROM thread_activity
         WHERE thread_id = ? AND sdk_user_message_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(threadId, id) as ActivityRow | undefined;
    if (existing) {
      this.saveFileCheckpoint(threadId, id, existing.id);
      this.bindRunEventRewindTarget(threadId, existing.id, id);
      return activityRowToThreadActivityLine(existing);
    }

    const row = this.db
      .prepare(
        `SELECT id, thread_id, role, message, stream, agent_id, api_error_json, sdk_user_message_id, created_at
         FROM thread_activity
         WHERE thread_id = ? AND role = 'user' AND sdk_user_message_id IS NULL
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(threadId) as ActivityRow | undefined;
    if (!row) {
      this.saveFileCheckpoint(threadId, id);
      return undefined;
    }

    this.db
      .prepare(`UPDATE thread_activity SET sdk_user_message_id = ? WHERE thread_id = ? AND id = ?`)
      .run(id, threadId, row.id);
    this.saveFileCheckpoint(threadId, id, row.id);
    this.bindRunEventRewindTarget(threadId, row.id, id);
    return activityRowToThreadActivityLine({ ...row, sdk_user_message_id: id });
  }

  getActivityRewindTarget(
    threadId: string,
    activityLineId: string,
  ): ThreadActivityLine["rewindTarget"] | undefined {
    const row = this.db
      .prepare(
        `SELECT id, role, sdk_user_message_id
         FROM thread_activity
         WHERE thread_id = ? AND id = ?
         LIMIT 1`,
      )
      .get(threadId, activityLineId) as
      | { id: string; role: string; sdk_user_message_id: string | null }
      | undefined;
    const userMessageId = row?.sdk_user_message_id?.trim();
    if (!row || row.role !== "user" || !userMessageId) {
      return undefined;
    }
    return { activityLineId: row.id, userMessageId };
  }

  rewindThreadToActivityLine(threadId: string, activityLineId: string): ThreadActivityRewindSummary {
    const target = this.db
      .prepare(
        `SELECT rowid AS row_id, id, thread_id, role, message, stream, agent_id, api_error_json,
                sdk_user_message_id, created_at
         FROM thread_activity
         WHERE thread_id = ? AND id = ?
         LIMIT 1`,
      )
      .get(threadId, activityLineId) as (ActivityRow & { row_id: number }) | undefined;
    const userMessageId = target?.sdk_user_message_id?.trim();
    if (!target || target.role !== "user" || !userMessageId) {
      throw new Error("该节点缺少 SDK 检查点，无法安全回滚。");
    }

    const runBoundary = this.db
      .prepare(
        `SELECT sequence
         FROM thread_run_events
         WHERE thread_id = ? AND stream_key = ?
         ORDER BY sequence ASC
         LIMIT 1`,
      )
      .get(threadId, activityLineId) as { sequence: number } | undefined;
    if (!runBoundary) {
      throw new Error("该节点缺少运行事件索引，无法安全回滚。");
    }

    const cutoffCreatedAt = target.created_at;
    const cutoffRunSequence = runBoundary.sequence;
    const deleteChanges = (sql: string, ...args: (string | number | null)[]): number =>
      ((this.db.prepare(sql).run(...args) as { changes?: number }).changes ?? 0);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      deleteChanges(
        `DELETE FROM thread_file_checkpoints
         WHERE thread_id = ?
           AND (
             user_message_id = ?
             OR activity_line_id IN (
               SELECT id FROM thread_activity WHERE thread_id = ? AND rowid >= ?
             )
             OR (activity_line_id IS NULL AND created_at >= ?)
           )`,
        threadId,
        userMessageId,
        threadId,
        target.row_id,
        cutoffCreatedAt,
      );
      const removedRunEventCount = deleteChanges(
        `DELETE FROM thread_run_events WHERE thread_id = ? AND sequence >= ?`,
        threadId,
        cutoffRunSequence,
      );
      const removedActivityCount = deleteChanges(
        `DELETE FROM thread_activity WHERE thread_id = ? AND rowid >= ?`,
        threadId,
        target.row_id,
      );
      deleteChanges(
        `DELETE FROM thread_usage_ledger_events WHERE thread_id = ? AND observed_at >= ?`,
        threadId,
        cutoffCreatedAt,
      );
      deleteChanges(
        `DELETE FROM thread_run_attempts
         WHERE thread_id = ? AND (started_at >= ? OR COALESCE(ended_at, started_at) >= ?)`,
        threadId,
        cutoffCreatedAt,
        cutoffCreatedAt,
      );
      deleteChanges(
        `DELETE FROM thread_agent_instances
         WHERE thread_id = ?
           AND (started_at >= ? OR updated_at >= ? OR COALESCE(ended_at, updated_at) >= ?)`,
        threadId,
        cutoffCreatedAt,
        cutoffCreatedAt,
        cutoffCreatedAt,
      );
      deleteChanges(
        `DELETE FROM thread_subagent_sessions
         WHERE thread_id = ?
           AND (started_at >= ? OR last_active_at >= ? OR updated_at >= ? OR COALESCE(ended_at, updated_at) >= ?)`,
        threadId,
        cutoffCreatedAt,
        cutoffCreatedAt,
        cutoffCreatedAt,
        cutoffCreatedAt,
      );
      deleteChanges(
        `DELETE FROM thread_subagent_metrics WHERE thread_id = ? AND updated_at >= ?`,
        threadId,
        cutoffCreatedAt,
      );
      deleteChanges(`DELETE FROM thread_pending_plans WHERE thread_id = ?`, threadId);
      deleteChanges(`DELETE FROM thread_coder_todos WHERE thread_id = ?`, threadId);
      deleteChanges(`DELETE FROM thread_metrics_snapshots WHERE thread_id = ?`, threadId);
      deleteChanges(
        `DELETE FROM thread_compaction_archives WHERE thread_id = ? AND created_at >= ?`,
        threadId,
        cutoffCreatedAt,
      );
      deleteChanges(
        `DELETE FROM thread_applied_diffs WHERE thread_id = ? AND applied_at >= ?`,
        threadId,
        cutoffCreatedAt,
      );
      this.db
        .prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), threadId);
      this.db.exec("COMMIT");
      return {
        activityLineId,
        userMessageId,
        cutoffCreatedAt,
        cutoffRunSequence,
        removedActivityCount,
        removedRunEventCount,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  upsertRunAttempt(record: RunAttemptRecord): void {
    this.db
      .prepare(
        `INSERT INTO thread_run_attempts (
           thread_id, attempt_id, phase, retry_index, status, started_at, ended_at, metadata_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, attempt_id) DO UPDATE SET
           phase = excluded.phase,
           retry_index = excluded.retry_index,
           status = excluded.status,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           metadata_json = excluded.metadata_json`,
      )
      .run(
        record.threadId,
        record.attemptId,
        record.phase,
        record.retryIndex,
        record.status,
        record.startedAt,
        record.endedAt ?? null,
        record.metadata ? JSON.stringify(record.metadata) : null,
      );
  }

  listRunAttempts(threadId: string): RunAttemptRecord[] {
    const rows = this.db
      .prepare(
        `SELECT thread_id, attempt_id, phase, retry_index, status, started_at, ended_at, metadata_json
         FROM thread_run_attempts
         WHERE thread_id = ?
         ORDER BY started_at ASC, attempt_id ASC`,
      )
      .all(threadId) as Array<{
      thread_id: string;
      attempt_id: string;
      phase: string;
      retry_index: number;
      status: string;
      started_at: string;
      ended_at: string | null;
      metadata_json: string | null;
    }>;

    return rows.map(rowToRunAttempt);
  }

  upsertAgentInstance(record: AgentInstanceRecord): void {
    this.db
      .prepare(
        `INSERT INTO thread_agent_instances (
           thread_id, agent_id, role, kind, status, run_attempt_id,
           parent_agent_id, parent_tool_use_id, mission_key, todo_id,
           started_at, ended_at, updated_at, metadata_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, agent_id) DO UPDATE SET
           role = excluded.role,
           kind = excluded.kind,
           status = excluded.status,
           run_attempt_id = excluded.run_attempt_id,
           parent_agent_id = excluded.parent_agent_id,
           parent_tool_use_id = excluded.parent_tool_use_id,
           mission_key = COALESCE(excluded.mission_key, mission_key),
           todo_id = COALESCE(excluded.todo_id, todo_id),
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           updated_at = excluded.updated_at,
           metadata_json = excluded.metadata_json`,
      )
      .run(
        record.threadId,
        record.agentId,
        record.role,
        record.kind,
        record.status,
        record.runAttemptId ?? null,
        record.parentAgentId ?? null,
        record.parentToolUseId ?? null,
        record.missionKey ?? null,
        record.todoId ?? null,
        record.startedAt,
        record.endedAt ?? null,
        record.updatedAt,
        record.metadata ? JSON.stringify(record.metadata) : null,
      );
  }

  listAgentInstances(threadId: string): AgentInstanceRecord[] {
    const rows = this.db
      .prepare(
        `SELECT thread_id, agent_id, role, kind, status, run_attempt_id,
                parent_agent_id, parent_tool_use_id, mission_key, todo_id,
                started_at, ended_at, updated_at, metadata_json
         FROM thread_agent_instances
         WHERE thread_id = ?
         ORDER BY started_at ASC, agent_id ASC`,
      )
      .all(threadId) as Array<{
      thread_id: string;
      agent_id: string;
      role: string;
      kind: string;
      status: string;
      run_attempt_id: string | null;
      parent_agent_id: string | null;
      parent_tool_use_id: string | null;
      mission_key: string | null;
      todo_id: string | null;
      started_at: string;
      ended_at: string | null;
      updated_at: string;
      metadata_json: string | null;
    }>;

    return rows.map(rowToAgentInstance);
  }

  appendUsageLedgerEvent(event: UsageLedgerEvent): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO thread_usage_ledger_events (
           id, idempotency_key, thread_id, run_attempt_id, agent_id, parent_tool_use_id,
           source, source_event_id, request_key, provider_request_id, sdk_message_id,
           usage_kind, role, model_id,
           input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
           reported_cost_usd, attribution_json, metadata_json, observed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.idempotencyKey,
        event.threadId,
        event.runAttemptId ?? null,
        event.agentId ?? null,
        event.parentToolUseId ?? null,
        event.source,
        event.sourceEventId,
        event.requestKey ?? null,
        event.providerRequestId ?? null,
        event.sdkMessageId ?? null,
        event.usageKind,
        event.role,
        event.modelId ?? null,
        event.inputTokens,
        event.outputTokens,
        event.cacheReadTokens,
        event.cacheCreationTokens,
        event.reportedCostUsd ?? null,
        JSON.stringify(event.attribution),
        event.metadata ? JSON.stringify(event.metadata) : null,
        event.observedAt,
      ) as { changes?: number };
    return (result.changes ?? 0) > 0;
  }

  listUsageLedgerEvents(threadId: string): UsageLedgerEvent[] {
    const rows = this.db
      .prepare(
        `SELECT id, idempotency_key, thread_id, run_attempt_id, agent_id, parent_tool_use_id,
                source, source_event_id, request_key, provider_request_id, sdk_message_id,
                usage_kind, role, model_id,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                reported_cost_usd, attribution_json, metadata_json, observed_at
         FROM thread_usage_ledger_events
         WHERE thread_id = ?
         ORDER BY observed_at ASC, id ASC`,
      )
      .all(threadId) as unknown as Array<UsageLedgerEventRow>;

    return rows.map(rowToUsageLedgerEvent);
  }

  clearUsageLedger(threadId: string): void {
    this.db.prepare(`DELETE FROM thread_usage_ledger_events WHERE thread_id = ?`).run(threadId);
    this.db.prepare(`DELETE FROM thread_agent_instances WHERE thread_id = ?`).run(threadId);
    this.db.prepare(`DELETE FROM thread_run_attempts WHERE thread_id = ?`).run(threadId);
  }

  appendThreadRunEvent(event: ThreadRunEventInput): ThreadRunEvent {
    const existing = this.getThreadRunEvent(event.threadId, event.id);
    if (existing) {
      const upgraded = mergeRicherThreadRunEvent(existing, event);
      if (!upgraded) {
        return existing;
      }
      this.db
        .prepare(
          `UPDATE thread_run_events
              SET stream_state = ?, message = ?, metadata_json = ?, observed_at = ?
            WHERE thread_id = ? AND id = ?`,
        )
        .run(
          upgraded.streamState,
          upgraded.message,
          upgraded.metadata ? JSON.stringify(upgraded.metadata) : null,
          upgraded.observedAt,
          upgraded.threadId,
          upgraded.id,
        );
      return upgraded;
    }

    const record: ThreadRunEvent = {
      id: event.id,
      threadId: event.threadId,
      sequence: event.sequence ?? this.nextThreadRunEventSequence(event.threadId),
      eventType: event.eventType,
      scope: event.scope,
      streamState: event.streamState,
      message: event.message,
      observedAt: event.observedAt,
      ...(event.role?.trim() && { role: event.role.trim() }),
      ...(event.agentId?.trim() && { agentId: event.agentId.trim() }),
      ...(event.parentAgentId?.trim() && { parentAgentId: event.parentAgentId.trim() }),
      ...(event.parentToolUseId?.trim() && { parentToolUseId: event.parentToolUseId.trim() }),
      ...(event.runAttemptId?.trim() && { runAttemptId: event.runAttemptId.trim() }),
      ...(event.requestId?.trim() && { requestId: event.requestId.trim() }),
      ...(event.streamKey?.trim() && { streamKey: event.streamKey.trim() }),
      ...(event.metadata && { metadata: event.metadata }),
    };

    this.db
      .prepare(
        `INSERT INTO thread_run_events (
           id, thread_id, sequence, event_type, scope, role, agent_id,
           parent_agent_id, parent_tool_use_id, run_attempt_id, request_id, stream_key,
           stream_state, message, metadata_json, observed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.threadId,
        record.sequence,
        record.eventType,
        record.scope,
        record.role ?? null,
        record.agentId ?? null,
        record.parentAgentId ?? null,
        record.parentToolUseId ?? null,
        record.runAttemptId ?? null,
        record.requestId ?? null,
        record.streamKey ?? null,
        record.streamState,
        record.message,
        record.metadata ? JSON.stringify(record.metadata) : null,
        record.observedAt,
      );
    return record;
  }

  listThreadRunEvents(threadId: string): ThreadRunEvent[] {
    const rows = this.db
      .prepare(
        `SELECT id, thread_id, sequence, event_type, scope, role, agent_id,
                parent_agent_id, parent_tool_use_id, run_attempt_id, request_id, stream_key,
                stream_state, message, metadata_json, observed_at
         FROM thread_run_events
         WHERE thread_id = ?
         ORDER BY sequence ASC, observed_at ASC, id ASC`,
      )
      .all(threadId) as unknown as ThreadRunEventRow[];
    return rows.map(rowToThreadRunEvent);
  }

  clearThreadRunEvents(threadId: string): void {
    this.db.prepare(`DELETE FROM thread_run_events WHERE thread_id = ?`).run(threadId);
  }

  upsertSubagentSessionActive(input: {
    threadId: string;
    role: RuntimeAgentRole;
    agentId: string;
    phase: SubagentRunPhase;
    todoId?: string;
    missionKey?: string;
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO thread_subagent_sessions (
           thread_id, role, agent_id, phase, status, todo_id, mission_key,
           started_at, last_active_at, ended_at, accumulated_ms, updated_at
         ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL, 0, ?)
         ON CONFLICT(thread_id, agent_id) DO UPDATE SET
           role = excluded.role,
           phase = excluded.phase,
           status = 'active',
           todo_id = COALESCE(excluded.todo_id, todo_id),
           mission_key = COALESCE(excluded.mission_key, mission_key),
           last_active_at = excluded.last_active_at,
           ended_at = NULL,
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
        now,
        now,
      );
  }

  markSubagentSessionStopped(threadId: string, agentId: string): void {
    const now = new Date().toISOString();
    const nowMs = Date.now();
    const row = this.db
      .prepare(
        `SELECT last_active_at, accumulated_ms
         FROM thread_subagent_sessions
         WHERE thread_id = ? AND agent_id = ?`,
      )
      .get(threadId, agentId) as
      | { last_active_at: string | null; accumulated_ms: number | null }
      | undefined;
    const lastActiveMs = row?.last_active_at ? Date.parse(row.last_active_at) : nowMs;
    const segmentMs =
      Number.isFinite(lastActiveMs) && lastActiveMs > 0
        ? Math.max(0, nowMs - lastActiveMs)
        : 0;
    const accumulatedMs = (row?.accumulated_ms ?? 0) + segmentMs;
    this.db
      .prepare(
        `UPDATE thread_subagent_sessions
         SET status = 'stopped',
             ended_at = ?,
             accumulated_ms = ?,
             updated_at = ?
         WHERE thread_id = ? AND agent_id = ?`,
      )
      .run(now, accumulatedMs, now, threadId, agentId);
  }

  upsertSubagentMetrics(
    threadId: string,
    input: {
      agentId: string;
      role: RuntimeAgentRole;
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
      role: row.role as RuntimeAgentRole,
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
        `SELECT thread_id, role, agent_id, phase, status, todo_id, mission_key,
                started_at, last_active_at, ended_at, accumulated_ms, updated_at
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
      started_at: string | null;
      last_active_at: string | null;
      ended_at: string | null;
      accumulated_ms: number | null;
      updated_at: string;
    }>;

    return rows.map((row) => {
      const fallbackAt = row.updated_at;
      const startedAt = row.started_at ?? fallbackAt;
      const lastActiveAt = row.last_active_at ?? fallbackAt;
      return {
        threadId: row.thread_id,
        role: row.role as RuntimeAgentRole,
        agentId: row.agent_id,
        phase: row.phase as SubagentRunPhase,
        status: row.status as SubagentSessionStatus,
        ...(row.todo_id ? { todoId: row.todo_id } : {}),
        ...(row.mission_key ? { missionKey: row.mission_key } : {}),
        startedAt,
        lastActiveAt,
        ...(row.ended_at ? { endedAt: row.ended_at } : {}),
        accumulatedMs: row.accumulated_ms ?? 0,
        updatedAt: row.updated_at,
      };
    });
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
    role: RuntimeAgentRole;
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
      ...(line.apiError && { apiError: line.apiError }),
    };
    const sdkUserMessageId = line.rewindTarget?.userMessageId?.trim();
    if (sdkUserMessageId) {
      record.rewindTarget = { activityLineId: record.id, userMessageId: sdkUserMessageId };
    }
    this.db
      .prepare(
        `INSERT INTO thread_activity (
           id, thread_id, role, message, stream, agent_id, api_error_json, sdk_user_message_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        threadId,
        record.role,
        record.message,
        line.stream ? 1 : 0,
        record.agentId ?? null,
        record.apiError ? JSON.stringify(record.apiError) : null,
        sdkUserMessageId || null,
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
        `SELECT id, thread_id, role, message, stream, agent_id, api_error_json, sdk_user_message_id, created_at
         FROM thread_activity
         WHERE thread_id = ?
         ORDER BY created_at ASC, rowid ASC`,
      )
      .all(threadId) as unknown as ActivityRow[];

    const lines = rows.map((row) => {
      const { text, repaired } = repairActivityText(row.message);
      const apiError = parseStoredApiError(row.api_error_json);
      const userMessageId = row.sdk_user_message_id?.trim();
      return {
        id: row.id,
        role: row.role,
        message: repaired ? text : row.message,
        stream: row.stream === 1,
        ...(userMessageId && {
          rewindTarget: { activityLineId: row.id, userMessageId },
        }),
        ...(row.agent_id?.trim() && { agentId: row.agent_id.trim() }),
        ...(apiError && { apiError }),
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

  private bindRunEventRewindTarget(threadId: string, activityLineId: string, userMessageId: string): void {
    const rows = this.db
      .prepare(
        `SELECT id, metadata_json
         FROM thread_run_events
         WHERE thread_id = ? AND stream_key = ?`,
      )
      .all(threadId, activityLineId) as Array<{ id: string; metadata_json: string | null }>;
    if (rows.length === 0) {
      return;
    }

    const update = this.db.prepare(
      `UPDATE thread_run_events SET metadata_json = ? WHERE thread_id = ? AND id = ?`,
    );
    for (const row of rows) {
      update.run(
        JSON.stringify({
          ...(parseJsonRecord(row.metadata_json) ?? {}),
          rewindTarget: { activityLineId, userMessageId },
        }),
        threadId,
        row.id,
      );
    }
  }

  private getLastActivityLine(threadId: string): (ThreadActivityLine & { id: string }) | undefined {
    const row = this.db
      .prepare(
        `SELECT id, thread_id, role, message, stream, agent_id, api_error_json, sdk_user_message_id, created_at
         FROM thread_activity
         WHERE thread_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(threadId) as ActivityRow | undefined;

    if (!row) {
      return undefined;
    }

    return activityRowToThreadActivityLine(row);
  }

  private getThreadRunEvent(threadId: string, eventId: string): ThreadRunEvent | undefined {
    const row = this.db
      .prepare(
        `SELECT id, thread_id, sequence, event_type, scope, role, agent_id,
                parent_agent_id, parent_tool_use_id, run_attempt_id, request_id, stream_key,
                stream_state, message, metadata_json, observed_at
         FROM thread_run_events
         WHERE thread_id = ? AND id = ?`,
      )
      .get(threadId, eventId) as ThreadRunEventRow | undefined;
    return row ? rowToThreadRunEvent(row) : undefined;
  }

  private nextThreadRunEventSequence(threadId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
         FROM thread_run_events
         WHERE thread_id = ?`,
      )
      .get(threadId) as { next_sequence: number } | undefined;
    return row?.next_sequence ?? 1;
  }
}

function activityRowToThreadActivityLine(row: ActivityRow): ThreadActivityLine {
  const apiError = parseStoredApiError(row.api_error_json);
  const userMessageId = row.sdk_user_message_id?.trim();
  return {
    id: row.id,
    role: row.role,
    message: row.message,
    stream: row.stream === 1,
    ...(userMessageId && {
      rewindTarget: { activityLineId: row.id, userMessageId },
    }),
    ...(row.agent_id?.trim() && { agentId: row.agent_id.trim() }),
    ...(apiError && { apiError }),
  };
}

function parseStoredApiError(raw: string | null | undefined): ThreadApiErrorInfo | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as ThreadApiErrorInfo;
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return {
        message: parsed.message.trim(),
        ...(typeof parsed.statusCode === "number" && { statusCode: parsed.statusCode }),
        ...(typeof parsed.code === "string" && parsed.code.trim() && { code: parsed.code.trim() }),
        ...(typeof parsed.model === "string" && parsed.model.trim() && { model: parsed.model.trim() }),
      };
    }
  } catch {
    // ignore malformed persisted JSON
  }
  return undefined;
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

function rowToRunAttempt(row: {
  thread_id: string;
  attempt_id: string;
  phase: string;
  retry_index: number;
  status: string;
  started_at: string;
  ended_at: string | null;
  metadata_json: string | null;
}): RunAttemptRecord {
  const metadata = parseJsonRecord(row.metadata_json);
  return {
    threadId: row.thread_id,
    attemptId: row.attempt_id,
    phase: row.phase as RunAttemptPhase,
    retryIndex: row.retry_index,
    status: row.status as RunAttemptStatus,
    startedAt: row.started_at,
    ...(row.ended_at && { endedAt: row.ended_at }),
    ...(metadata && { metadata }),
  };
}

function rowToAgentInstance(row: {
  thread_id: string;
  agent_id: string;
  role: string;
  kind: string;
  status: string;
  run_attempt_id: string | null;
  parent_agent_id: string | null;
  parent_tool_use_id: string | null;
  mission_key: string | null;
  todo_id: string | null;
  started_at: string;
  ended_at: string | null;
  updated_at: string;
  metadata_json: string | null;
}): AgentInstanceRecord {
  const metadata = parseJsonRecord(row.metadata_json);
  return {
    threadId: row.thread_id,
    agentId: row.agent_id,
    role: row.role as RuntimeAgentRole,
    kind: row.kind as AgentInstanceKind,
    status: row.status as AgentInstanceStatus,
    ...(row.run_attempt_id && { runAttemptId: row.run_attempt_id }),
    ...(row.parent_agent_id && { parentAgentId: row.parent_agent_id }),
    ...(row.parent_tool_use_id && { parentToolUseId: row.parent_tool_use_id }),
    ...(row.mission_key && { missionKey: row.mission_key }),
    ...(row.todo_id && { todoId: row.todo_id }),
    startedAt: row.started_at,
    ...(row.ended_at && { endedAt: row.ended_at }),
    updatedAt: row.updated_at,
    ...(metadata && { metadata }),
  };
}

function rowToUsageLedgerEvent(row: UsageLedgerEventRow): UsageLedgerEvent {
  const metadata = parseJsonRecord(row.metadata_json);
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    threadId: row.thread_id,
    source: row.source as UsageLedgerSource,
    sourceEventId: row.source_event_id,
    usageKind: row.usage_kind as UsageLedgerKind,
    role: row.role as RuntimeAgentRole,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    observedAt: row.observed_at,
    attribution: parseUsageAttributionJson(row.attribution_json),
    ...(row.run_attempt_id && { runAttemptId: row.run_attempt_id }),
    ...(row.agent_id && { agentId: row.agent_id }),
    ...(row.parent_tool_use_id && { parentToolUseId: row.parent_tool_use_id }),
    ...(row.request_key && { requestKey: row.request_key }),
    ...(row.provider_request_id && { providerRequestId: row.provider_request_id }),
    ...(row.sdk_message_id && { sdkMessageId: row.sdk_message_id }),
    ...(row.model_id && { modelId: row.model_id }),
    ...(row.reported_cost_usd !== null && { reportedCostUsd: row.reported_cost_usd }),
    ...(metadata && { metadata }),
  };
}

function rowToThreadRunEvent(row: ThreadRunEventRow): ThreadRunEvent {
  const metadata = parseJsonRecord(row.metadata_json);
  return {
    id: row.id,
    threadId: row.thread_id,
    sequence: row.sequence,
    eventType: row.event_type as ThreadRunEvent["eventType"],
    scope: row.scope as ThreadRunEvent["scope"],
    streamState: row.stream_state as ThreadRunEvent["streamState"],
    message: row.message,
    observedAt: row.observed_at,
    ...(row.role && { role: row.role }),
    ...(row.agent_id && { agentId: row.agent_id }),
    ...(row.parent_agent_id && { parentAgentId: row.parent_agent_id }),
    ...(row.parent_tool_use_id && { parentToolUseId: row.parent_tool_use_id }),
    ...(row.run_attempt_id && { runAttemptId: row.run_attempt_id }),
    ...(row.request_id && { requestId: row.request_id }),
    ...(row.stream_key && { streamKey: row.stream_key }),
    ...(metadata && { metadata }),
  };
}

function mergeRicherThreadRunEvent(
  existing: ThreadRunEvent,
  incoming: ThreadRunEventInput,
): ThreadRunEvent | null {
  if (!shouldUpgradeThreadRunEvent(existing, incoming)) {
    return null;
  }
  const updated: ThreadRunEvent = {
    ...existing,
    streamState: incoming.streamState,
    message: incoming.message,
    observedAt: incoming.observedAt,
  };
  const metadata = mergeThreadRunEventMetadata(existing.metadata, incoming.metadata);
  if (metadata) {
    updated.metadata = metadata;
  } else {
    delete updated.metadata;
  }
  return updated;
}

function shouldUpgradeThreadRunEvent(
  existing: ThreadRunEvent,
  incoming: ThreadRunEventInput,
): boolean {
  if (existing.eventType !== incoming.eventType) {
    return false;
  }

  const existingTool = readThreadRunToolMetadata(existing.metadata);
  const incomingTool = readThreadRunToolMetadata(incoming.metadata);
  if (isRicherThreadRunToolMetadata(existingTool, incomingTool)) {
    return true;
  }

  const existingMessage = existing.message.trim();
  const incomingMessage = incoming.message.trim();
  if (
    incomingMessage.length > existingMessage.length &&
    isSameToolReference(existingTool, incomingTool)
  ) {
    return true;
  }

  return streamStateRank(incoming.streamState) > streamStateRank(existing.streamState);
}

function mergeThreadRunEventMetadata(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!existing && !incoming) {
    return undefined;
  }
  const merged: Record<string, unknown> = {
    ...(existing ?? {}),
    ...(incoming ?? {}),
  };
  const tool = mergeThreadRunToolMetadata(
    readThreadRunToolMetadata(existing),
    readThreadRunToolMetadata(incoming),
  );
  if (tool) {
    merged.tool = tool;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeThreadRunToolMetadata(
  existing: ThreadRunToolMetadata | undefined,
  incoming: ThreadRunToolMetadata | undefined,
): ThreadRunToolMetadata | undefined {
  if (!existing) {
    return incoming;
  }
  if (!incoming || existing.name !== incoming.name) {
    return existing;
  }
  return {
    ...existing,
    ...incoming,
  };
}

function isRicherThreadRunToolMetadata(
  existing: ThreadRunToolMetadata | undefined,
  incoming: ThreadRunToolMetadata | undefined,
): boolean {
  if (!incoming) {
    return false;
  }
  if (!existing) {
    return Boolean(incoming.detail || incoming.toolUseId || incoming.durationMs !== undefined || incoming.status);
  }
  if (existing.name !== incoming.name) {
    return false;
  }
  return Boolean(
    (incoming.detail && incoming.detail !== existing.detail) ||
      (incoming.toolUseId && incoming.toolUseId !== existing.toolUseId) ||
      (incoming.durationMs !== undefined && incoming.durationMs !== existing.durationMs) ||
      (incoming.status && incoming.status !== existing.status),
  );
}

function readThreadRunToolMetadata(
  metadata: Record<string, unknown> | undefined,
): ThreadRunToolMetadata | undefined {
  const raw = metadata?.tool;
  if (!isJsonRecord(raw)) {
    return undefined;
  }
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) {
    return undefined;
  }
  return {
    name,
    ...(typeof raw.detail === "string" && raw.detail.trim() && { detail: raw.detail.trim() }),
    ...(typeof raw.toolUseId === "string" && raw.toolUseId.trim() && { toolUseId: raw.toolUseId.trim() }),
    ...(typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) && { durationMs: raw.durationMs }),
    ...(isThreadRunToolStatus(raw.status) && { status: raw.status }),
  };
}

function isSameToolReference(
  existing: ThreadRunToolMetadata | undefined,
  incoming: ThreadRunToolMetadata | undefined,
): boolean {
  if (!existing || !incoming || existing.name !== incoming.name) {
    return false;
  }
  return !existing.toolUseId || !incoming.toolUseId || existing.toolUseId === incoming.toolUseId;
}

function streamStateRank(state: ThreadRunEvent["streamState"]): number {
  switch (state) {
    case "placeholder":
      return 1;
    case "streaming":
      return 2;
    case "finalized":
      return 3;
    case "none":
    default:
      return 0;
  }
}

function isThreadRunToolStatus(value: unknown): value is NonNullable<ThreadRunToolMetadata["status"]> {
  return value === "started" || value === "completed" || value === "failed";
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUsageAttributionJson(raw: string): UsageAttribution {
  try {
    const parsed = JSON.parse(raw) as Partial<UsageAttribution>;
    if (parsed.status === "attributed" && typeof parsed.agentId === "string" && parsed.agentId.trim()) {
      return { status: "attributed", agentId: parsed.agentId.trim() };
    }
    if (parsed.status === "unattributed") {
      return {
        status: "unattributed",
        ...(typeof parsed.reason === "string" && parsed.reason.trim()
          ? { reason: parsed.reason.trim() }
          : {}),
      };
    }
  } catch {
    // malformed attribution is still auditable as unattributed.
  }
  return { status: "unattributed", reason: "invalid_attribution_json" };
}

function parseJsonRecord(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
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
