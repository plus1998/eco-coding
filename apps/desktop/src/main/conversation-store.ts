import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  type CoreKind,
  createToolOutputPreview,
  isCoreKind,
  isFreshSubagentRequest,
  mergeStreamText,
} from "@eco/runtime";
import { logSuspiciousActivityLine, repairActivityText } from "../shared/activity-text";
import type { CompactConversationMessage } from "../shared/eco-compact-handoff";
import { parseThreadRunFileChangeMetadata } from "../shared/file-change.js";
import type {
  CoderTodoItem,
  CoderTodoStatus,
  ComposerDraftRecord,
  PromptImageAttachment,
  RuntimeAgentRole,
  ThreadActivityLine,
  ThreadApiErrorInfo,
  ThreadContextSnapshot,
  ThreadFollowUpBoundary,
  ThreadFollowUpDeliveryMode,
  ThreadFollowUpPriority,
  ThreadFollowUpRunPhase,
  ThreadFollowUpStatus,
  ThreadPendingFollowUp,
  ThreadPendingPlan,
  ThreadRunEvent,
  ThreadRunEventInput,
  ThreadRunToolMetadata,
  ThreadRuntimeConfig,
  ThreadStatus,
  ThreadSummary,
  TokenCostBreakdown,
} from "../shared/ipc";
import { projectThreadRunToolMetadata } from "../shared/thread-run-tool-projection.js";
import { parseThreadRuntimeConfigJson, serializeThreadRuntimeConfig } from "../shared/thread-runtime-config";
import { parseThreadRunGrepToolTarget, parseThreadRunReadToolTarget } from "../shared/tool-target.js";
import { sdkActivityLineId, sdkMessageUuidFromActivityLineId } from "./sdk-session-activity.js";
import { resolveResumeAgentIdFromRecords } from "./subagent-session-resolve.js";
import type {
  SubagentRunPhase,
  SubagentSessionStatus,
  ThreadSubagentSessionRecord,
} from "./subagent-session-types.js";
import { shouldAdvanceThreadRunEventSequence } from "./thread-run-event-sequence";
import type { SerializedThreadUsageState } from "./thread-usage-accumulator";
import {
  type AgentInstanceKind,
  type AgentInstanceRecord,
  type AgentInstanceStatus,
  normalizeRunAttemptPhase,
  type RunAttemptRecord,
  type RunAttemptStatus,
  type UsageAttribution,
  type UsageLedgerAttributionUpdate,
  type UsageLedgerEvent,
  type UsageLedgerKind,
  type UsageLedgerSource,
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
  core_kind: string | null;
  core_locked_at: string | null;
  sdk_session_id: string | null;
  sdk_cwd: string | null;
  routes_fingerprint: string | null;
  runtime_config_json: string | null;
}

export interface ThreadSdkSession {
  sessionId: string;
  cwd: string;
}

export interface ThreadCoreSession {
  threadId: string;
  coreKind: CoreKind;
  externalSessionId: string;
  cwd: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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

export type CompactTokenCountSource =
  | "provider_exact"
  | "tokenizer_exact"
  | "sdk_context_usage"
  | "local_heuristic";

export interface ThreadCompactHandoffRecord {
  threadId: string;
  summaryId: string;
  schemaVersion: number;
  generation: number;
  summary: string;
  recentMessages: CompactConversationMessage[];
  preTokensEstimate: number;
  preTokensSource: CompactTokenCountSource;
  postTokensEstimate: number;
  postTokensSource: CompactTokenCountSource;
  compressionRatio: number;
  sourceSessionId?: string;
  sourceStartMessageId?: string;
  sourceEndMessageId?: string;
  targetSessionId?: string;
  consumedAt?: string;
  createdAt: string;
}

export interface CommitCompactHandoffInput {
  sourceSessionId: string;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  summary: string;
  recentMessages: CompactConversationMessage[];
  preTokensEstimate: number;
  preTokensSource: CompactTokenCountSource;
  postTokensEstimate: number;
  postTokensSource: CompactTokenCountSource;
  compressionRatio: number;
  schemaVersion?: number;
}

interface CompactHandoffRow {
  thread_id: string;
  summary_id: string;
  schema_version: number;
  generation: number;
  summary: string;
  recent_user_messages_json: string;
  pre_tokens_estimate: number;
  pre_tokens_source: string;
  post_tokens_estimate: number;
  post_tokens_source: string;
  compression_ratio: number;
  source_session_id: string | null;
  source_start_message_id: string | null;
  source_end_message_id: string | null;
  target_session_id: string | null;
  consumed_at: string | null;
  created_at: string;
}

export function parseCompactHandoffRecentMessages(
  serialized: string,
  threadId: string,
): CompactConversationMessage[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`压缩交接近期对话 JSON 损坏（${threadId}）：${detail}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`压缩交接近期对话不是数组（${threadId}）。`);
  }
  return parsed.map((entry, index) => {
    if (typeof entry === "string") {
      const message = entry.trim();
      if (!message) {
        throw new Error(`压缩交接近期对话包含空的 legacy 消息（${threadId}，index=${index}）。`);
      }
      return { role: "user", message };
    }
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { role?: unknown }).role !== "string" ||
      typeof (entry as { message?: unknown }).message !== "string"
    ) {
      throw new Error(`压缩交接近期对话条目结构无效（${threadId}，index=${index}）。`);
    }
    const role = (entry as { role: string }).role.trim();
    const message = (entry as { message: string }).message.trim();
    const rawId = (entry as { id?: unknown }).id;
    if (rawId !== undefined && typeof rawId !== "string") {
      throw new Error(`压缩交接近期对话 id 无效（${threadId}，index=${index}）。`);
    }
    const id = typeof rawId === "string" ? rawId.trim() : "";
    if (!role || !message) {
      throw new Error(`压缩交接近期对话条目为空（${threadId}，index=${index}）。`);
    }
    return { ...(id && { id }), role, message };
  });
}

function compactHandoffRowToRecord(
  row: CompactHandoffRow,
  requestedThreadId: string,
): ThreadCompactHandoffRecord {
  const summary = row.summary.trim();
  if (!summary) {
    throw new Error(`压缩交接摘要为空（${requestedThreadId}）。`);
  }
  const summaryId = row.summary_id?.trim();
  if (!summaryId) {
    throw new Error(`压缩交接 summary id 无效（${requestedThreadId}）。`);
  }
  const record: ThreadCompactHandoffRecord = {
    threadId: row.thread_id,
    summaryId,
    schemaVersion: Math.trunc(row.schema_version),
    generation: Math.trunc(row.generation),
    summary,
    recentMessages: parseCompactHandoffRecentMessages(row.recent_user_messages_json, requestedThreadId),
    preTokensEstimate: row.pre_tokens_estimate,
    preTokensSource: parseCompactTokenCountSource(row.pre_tokens_source, requestedThreadId),
    postTokensEstimate: row.post_tokens_estimate,
    postTokensSource: parseCompactTokenCountSource(row.post_tokens_source, requestedThreadId),
    compressionRatio: row.compression_ratio,
    ...(row.source_session_id && { sourceSessionId: row.source_session_id }),
    ...(row.source_start_message_id && { sourceStartMessageId: row.source_start_message_id }),
    ...(row.source_end_message_id && { sourceEndMessageId: row.source_end_message_id }),
    ...(row.target_session_id && { targetSessionId: row.target_session_id }),
    ...(row.consumed_at && { consumedAt: row.consumed_at }),
    createdAt: row.created_at,
  };
  validateCompactMetrics(requestedThreadId, record);
  if (record.schemaVersion < 1 || record.generation < 1) {
    throw new Error(`压缩交接版本信息无效（${requestedThreadId}）。`);
  }
  return record;
}

function parseCompactTokenCountSource(value: string, threadId: string): CompactTokenCountSource {
  if (
    value === "provider_exact" ||
    value === "tokenizer_exact" ||
    value === "sdk_context_usage" ||
    value === "local_heuristic"
  ) {
    return value;
  }
  throw new Error(`压缩交接 token 来源无效（${threadId}）：${value}`);
}

function validateCompactMetrics(
  threadId: string,
  input: {
    preTokensEstimate: number;
    postTokensEstimate: number;
    compressionRatio: number;
  },
): void {
  if (
    !Number.isFinite(input.preTokensEstimate) ||
    input.preTokensEstimate <= 0 ||
    !Number.isInteger(input.preTokensEstimate)
  ) {
    throw new Error(`压缩交接压缩前 token 估算无效（${threadId}）。`);
  }
  if (
    !Number.isFinite(input.postTokensEstimate) ||
    input.postTokensEstimate < 0 ||
    !Number.isInteger(input.postTokensEstimate)
  ) {
    throw new Error(`压缩交接压缩后 token 估算无效（${threadId}）。`);
  }
  if (!Number.isFinite(input.compressionRatio) || input.compressionRatio < 0) {
    throw new Error(`压缩交接压缩比例无效（${threadId}）。`);
  }
  const expectedRatio = input.postTokensEstimate / input.preTokensEstimate;
  const ratioTolerance = Math.max(1e-9, Math.abs(expectedRatio) * 1e-9);
  if (Math.abs(input.compressionRatio - expectedRatio) > ratioTolerance) {
    throw new Error(`压缩交接压缩比例与 token 估算不一致（${threadId}）。`);
  }
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

interface ThreadPendingFollowUpRow {
  id: string;
  thread_id: string;
  prompt: string;
  attachments_json: string | null;
  priority: string;
  status: string;
  delivery_mode: string;
  source_run_attempt_id: string | null;
  target_run_attempt_id: string | null;
  queued_during_phase: string | null;
  delivery_boundary: string | null;
  error: string | null;
  queue_position: number | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
  applied_at: string | null;
}

const threadOwnedTables = [
  "thread_core_sessions",
  "thread_activity",
  "thread_pending_followups",
  "thread_pending_plans",
  "thread_coder_todos",
  "thread_applied_diffs",
  "thread_metrics_snapshots",
  "thread_compaction_archives",
  "thread_compact_handoff",
  "thread_subagent_sessions",
  "thread_subagent_metrics",
  "thread_run_attempts",
  "thread_agent_instances",
  "thread_usage_ledger_events",
  "thread_run_events",
  "thread_file_checkpoints",
] as const;

const MAX_PROJECTION_EVENT_CACHE_ENTRIES = 8;
const MAX_HOT_THREAD_RUN_EVENT_CACHE_ENTRIES = 256;

interface ProjectionEventCacheEntry {
  maxEvents: number;
  events: ThreadRunEvent[];
}

export async function createConversationStore(dbPath: string): Promise<ConversationStore> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite");
  const store = new ConversationStore(new sqlite.DatabaseSync(dbPath));
  store.initialize();
  return store;
}

export class ConversationStore {
  private readonly projectionEventCache = new Map<string, ProjectionEventCacheEntry>();
  private readonly hotThreadRunEventCache = new Map<string, ThreadRunEvent>();
  private readonly nextThreadRunEventSequences = new Map<string, number>();

  constructor(private readonly db: DatabaseSyncType) {}

  initialize(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
      PRAGMA foreign_keys = ON;
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        core_kind TEXT NOT NULL DEFAULT 'claude',
        core_locked_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_threads_workspace_updated
        ON threads(workspace_path, updated_at DESC);

      CREATE TABLE IF NOT EXISTS composer_drafts (
        context_key TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS thread_core_sessions (
        thread_id TEXT PRIMARY KEY,
        core_kind TEXT NOT NULL,
        external_session_id TEXT NOT NULL,
        cwd TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_core_sessions_external
        ON thread_core_sessions(core_kind, external_session_id);

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
        deferred_exit_plan_tool_use_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS thread_pending_followups (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        attachments_json TEXT,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        delivery_mode TEXT NOT NULL,
        source_run_attempt_id TEXT,
        target_run_attempt_id TEXT,
        queued_during_phase TEXT,
        delivery_boundary TEXT,
        error TEXT,
        queue_position INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        delivered_at TEXT,
        applied_at TEXT,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_pending_followups_thread_status
        ON thread_pending_followups(thread_id, status, priority, created_at);

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

      CREATE TABLE IF NOT EXISTS thread_compact_handoff (
        thread_id TEXT PRIMARY KEY,
        summary_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 2,
        generation INTEGER NOT NULL DEFAULT 1,
        summary TEXT NOT NULL,
        recent_user_messages_json TEXT NOT NULL,
        pre_tokens_estimate INTEGER NOT NULL DEFAULT 0,
        pre_tokens_source TEXT NOT NULL DEFAULT 'local_heuristic',
        post_tokens_estimate INTEGER NOT NULL,
        post_tokens_source TEXT NOT NULL DEFAULT 'local_heuristic',
        compression_ratio REAL NOT NULL DEFAULT 0,
        source_session_id TEXT,
        source_start_message_id TEXT,
        source_end_message_id TEXT,
        target_session_id TEXT,
        consumed_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

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

      CREATE INDEX IF NOT EXISTS idx_thread_run_events_thread_stream_latest_v2
        ON thread_run_events(
          thread_id, event_type, stream_key, request_id, run_attempt_id, sequence DESC
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
    if (!names.has("core_kind")) {
      this.db.exec(`ALTER TABLE threads ADD COLUMN core_kind TEXT`);
    }
    if (!names.has("core_locked_at")) {
      this.db.exec(`ALTER TABLE threads ADD COLUMN core_locked_at TEXT`);
    }
    const hasCodexThreadMap = Boolean(
      this.db
        .prepare(
          `SELECT 1
           FROM sqlite_master
           WHERE type = 'table' AND name = 'eco_thread_codex_map'`,
        )
        .get(),
    );
    if (hasCodexThreadMap) {
      this.db.exec(`
        UPDATE threads
        SET core_kind = 'codex'
        WHERE (core_kind IS NULL OR TRIM(core_kind) = '')
          AND (sdk_session_id IS NULL OR sdk_cwd IS NULL)
          AND EXISTS (
            SELECT 1
            FROM eco_thread_codex_map
            WHERE eco_thread_id = threads.id
          )
      `);
      this.db.exec(`
        UPDATE threads
        SET core_kind = 'claude'
        WHERE (core_kind IS NULL OR TRIM(core_kind) = '')
          AND sdk_session_id IS NOT NULL
          AND sdk_cwd IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM eco_thread_codex_map
            WHERE eco_thread_id = threads.id
          )
      `);
    } else {
      this.db.exec(`
        UPDATE threads
        SET core_kind = 'claude'
        WHERE core_kind IS NULL OR TRIM(core_kind) = ''
      `);
    }
    this.db.exec(`
      UPDATE threads
      SET core_locked_at = created_at
      WHERE core_kind IN ('claude', 'codex') AND core_locked_at IS NULL
    `);
    this.db.exec(`
      INSERT INTO thread_core_sessions (
        thread_id,
        core_kind,
        external_session_id,
        cwd,
        metadata_json,
        created_at,
        updated_at
      )
      SELECT id, 'claude', sdk_session_id, sdk_cwd, NULL, created_at, updated_at
      FROM threads
      WHERE core_kind = 'claude'
        AND sdk_session_id IS NOT NULL
        AND sdk_cwd IS NOT NULL
      ON CONFLICT(thread_id) DO UPDATE SET
        core_kind = excluded.core_kind,
        external_session_id = excluded.external_session_id,
        cwd = excluded.cwd,
        updated_at = excluded.updated_at
      WHERE thread_core_sessions.core_kind = excluded.core_kind
    `);

    const compactHandoffColumns = this.db
      .prepare(`PRAGMA table_info(thread_compact_handoff)`)
      .all() as Array<{ name: string }>;
    const compactHandoffNames = new Set(compactHandoffColumns.map((column) => column.name));
    const compactHandoffMigrations = [
      ["summary_id", "TEXT"],
      ["schema_version", "INTEGER NOT NULL DEFAULT 1"],
      ["generation", "INTEGER NOT NULL DEFAULT 1"],
      ["pre_tokens_estimate", "INTEGER NOT NULL DEFAULT 0"],
      ["pre_tokens_source", "TEXT NOT NULL DEFAULT 'local_heuristic'"],
      ["post_tokens_source", "TEXT NOT NULL DEFAULT 'local_heuristic'"],
      ["compression_ratio", "REAL NOT NULL DEFAULT 0"],
      ["source_session_id", "TEXT"],
      ["source_start_message_id", "TEXT"],
      ["source_end_message_id", "TEXT"],
      ["target_session_id", "TEXT"],
      ["consumed_at", "TEXT"],
    ] as const;
    for (const [name, definition] of compactHandoffMigrations) {
      if (!compactHandoffNames.has(name)) {
        this.db.exec(`ALTER TABLE thread_compact_handoff ADD COLUMN ${name} ${definition}`);
      }
    }
    this.db.exec(`
      UPDATE thread_compact_handoff
      SET summary_id = COALESCE(NULLIF(summary_id, ''), 'legacy-' || thread_id),
          schema_version = COALESCE(schema_version, 1),
          generation = COALESCE(generation, 1),
          pre_tokens_estimate = CASE
            WHEN pre_tokens_estimate IS NULL OR pre_tokens_estimate <= 0
            THEN post_tokens_estimate
            ELSE pre_tokens_estimate
          END,
          pre_tokens_source = COALESCE(NULLIF(pre_tokens_source, ''), 'local_heuristic'),
          post_tokens_source = COALESCE(NULLIF(post_tokens_source, ''), 'local_heuristic')
    `);
    this.db.exec(`
      UPDATE thread_compact_handoff
      SET compression_ratio = CASE
        WHEN compression_ratio IS NULL OR compression_ratio < 0
          OR (compression_ratio = 0 AND post_tokens_estimate > 0)
        THEN CAST(post_tokens_estimate AS REAL) / pre_tokens_estimate
        ELSE compression_ratio
      END
    `);

    const activityColumns = this.db.prepare(`PRAGMA table_info(thread_activity)`).all() as Array<{
      name: string;
    }>;
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

    const sessionColumns = this.db.prepare(`PRAGMA table_info(thread_subagent_sessions)`).all() as Array<{
      name: string;
    }>;
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
    const checkpointColumns = this.db.prepare(`PRAGMA table_info(thread_file_checkpoints)`).all() as Array<{
      name: string;
    }>;
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

      CREATE INDEX IF NOT EXISTS idx_thread_run_events_thread_stream_latest_v2
        ON thread_run_events(
          thread_id, event_type, stream_key, request_id, run_attempt_id, sequence DESC
        );

      CREATE TABLE IF NOT EXISTS thread_file_checkpoints (
        thread_id TEXT NOT NULL,
        user_message_id TEXT NOT NULL,
        activity_line_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, user_message_id),
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thread_pending_followups (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        attachments_json TEXT,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        delivery_mode TEXT NOT NULL,
        source_run_attempt_id TEXT,
        target_run_attempt_id TEXT,
        queued_during_phase TEXT,
        delivery_boundary TEXT,
        error TEXT,
        queue_position INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        delivered_at TEXT,
        applied_at TEXT,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_pending_followups_thread_status
        ON thread_pending_followups(thread_id, status, priority, created_at);
    `);
    const followUpColumns = this.db.prepare(`PRAGMA table_info(thread_pending_followups)`).all() as Array<{
      name: string;
    }>;
    const followUpNames = new Set(followUpColumns.map((column) => column.name));
    if (!followUpNames.has("queued_during_phase")) {
      this.db.exec(`ALTER TABLE thread_pending_followups ADD COLUMN queued_during_phase TEXT`);
    }
    if (!followUpNames.has("delivery_boundary")) {
      this.db.exec(`ALTER TABLE thread_pending_followups ADD COLUMN delivery_boundary TEXT`);
    }
    if (!followUpNames.has("queue_position")) {
      this.db.exec(`ALTER TABLE thread_pending_followups ADD COLUMN queue_position INTEGER`);
    }

    if (!names.has("claude_plan_file_path")) {
      this.db.exec(`ALTER TABLE threads ADD COLUMN claude_plan_file_path TEXT`);
    }

    const pendingPlanColumns = this.db.prepare(`PRAGMA table_info(thread_pending_plans)`).all() as Array<{
      name: string;
    }>;
    const pendingPlanNames = new Set(pendingPlanColumns.map((column) => column.name));
    if (!pendingPlanNames.has("plan_file_path")) {
      this.db.exec(`ALTER TABLE thread_pending_plans ADD COLUMN plan_file_path TEXT`);
    }
    if (!pendingPlanNames.has("deferred_exit_plan_tool_use_id")) {
      this.db.exec(`ALTER TABLE thread_pending_plans ADD COLUMN deferred_exit_plan_tool_use_id TEXT`);
    }
    this.migrateToolOutputProjection();
  }

  private migrateToolOutputProjection(): void {
    const migrationId = "thread-run-tool-output-projection-v1";
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_store_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    if (this.db.prepare(`SELECT 1 FROM conversation_store_migrations WHERE id = ?`).get(migrationId)) {
      return;
    }

    const update = this.db.prepare(`UPDATE thread_run_events SET metadata_json = ? WHERE id = ?`);
    const invalidEventIds: string[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.db
        .prepare(`SELECT id, metadata_json FROM thread_run_events WHERE metadata_json IS NOT NULL`)
        .all() as Array<{ id: string; metadata_json: string }>;
      this.db
        .prepare(`DELETE FROM thread_run_events WHERE event_type = 'context.tool_output_truncated'`)
        .run();
      for (const row of rows) {
        let metadata: Record<string, unknown>;
        try {
          const parsed = JSON.parse(row.metadata_json) as unknown;
          if (!isJsonRecord(parsed)) {
            invalidEventIds.push(row.id);
            continue;
          }
          metadata = parsed;
        } catch {
          invalidEventIds.push(row.id);
          continue;
        }
        const migrated = migratePersistedToolMetadata(metadata);
        if (migrated !== metadata) {
          update.run(Object.keys(migrated).length > 0 ? JSON.stringify(migrated) : null, row.id);
        }
      }
      this.db
        .prepare(`INSERT INTO conversation_store_migrations (id, applied_at) VALUES (?, ?)`)
        .run(migrationId, new Date().toISOString());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    if (invalidEventIds.length > 0) {
      process.stderr.write(
        `[eco] tool output projection migration skipped invalid metadata count=${invalidEventIds.length} eventIds=${invalidEventIds.join(",")}\n`,
      );
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
    const row = this.db.prepare(`SELECT runtime_config_json FROM threads WHERE id = ?`).get(threadId) as
      | { runtime_config_json: string | null }
      | undefined;
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
      : existing?.accumulator
        ? JSON.stringify(existing.accumulator)
        : null;
    const contextJson = hasContext
      ? JSON.stringify(input.context)
      : existing?.context
        ? JSON.stringify(existing.context)
        : null;

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
      .run(id, threadId, input.trigger, input.sessionId ?? null, JSON.stringify(input.payload), createdAt);
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

  getCompactHandoff(threadId: string): ThreadCompactHandoffRecord | undefined {
    const row = this.selectCompactHandoffRow(threadId, true);
    return row ? compactHandoffRowToRecord(row, threadId) : undefined;
  }

  /** Latest committed summary, including a handoff already consumed by a replacement SDK session. */
  getLatestCompactSummary(threadId: string): ThreadCompactHandoffRecord | undefined {
    const row = this.selectCompactHandoffRow(threadId, false);
    return row ? compactHandoffRowToRecord(row, threadId) : undefined;
  }

  /**
   * Atomic compaction commit: install the handoff only if the source SDK session is still current,
   * then clear main/subagent resume state in the same SQLite transaction.
   */
  commitCompactHandoffAndClearSession(
    threadId: string,
    input: CommitCompactHandoffInput,
  ): ThreadCompactHandoffRecord {
    const sourceSessionId = input.sourceSessionId.trim();
    if (!sourceSessionId) {
      throw new Error(`压缩提交缺少源 SDK session（${threadId}）。`);
    }
    const sourceStartMessageId = input.sourceStartMessageId.trim();
    const sourceEndMessageId = input.sourceEndMessageId.trim();
    if (!sourceStartMessageId || !sourceEndMessageId) {
      throw new Error(`压缩提交缺少源消息范围（${threadId}）。`);
    }
    const summary = input.summary.trim();
    if (!summary) {
      throw new Error(`压缩提交摘要为空（${threadId}）。`);
    }
    validateCompactMetrics(threadId, input);

    const createdAt = new Date().toISOString();
    const summaryId = `csm_${crypto.randomUUID()}`;
    const schemaVersion = Math.max(1, Math.trunc(input.schemaVersion ?? 2));
    let generation = 1;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.db
        .prepare(`SELECT generation FROM thread_compact_handoff WHERE thread_id = ?`)
        .get(threadId) as { generation: number } | undefined;
      generation = Math.max(1, Math.trunc(previous?.generation ?? 0) + 1);

      const sessionUpdate = this.db
        .prepare(
          `UPDATE threads
           SET sdk_session_id = NULL, sdk_cwd = NULL, updated_at = ?
           WHERE id = ? AND sdk_session_id = ?`,
        )
        .run(createdAt, threadId, sourceSessionId);
      if (Number(sessionUpdate.changes ?? 0) !== 1) {
        throw new Error(`源 SDK session 已变化，拒绝提交旧压缩摘要（${threadId}）。`);
      }
      this.db
        .prepare(
          `DELETE FROM thread_core_sessions
           WHERE thread_id = ? AND core_kind = 'claude' AND external_session_id = ?`,
        )
        .run(threadId, sourceSessionId);

      this.writeCompactHandoffRow(threadId, {
        summaryId,
        schemaVersion,
        generation,
        summary,
        recentMessages: input.recentMessages,
        preTokensEstimate: input.preTokensEstimate,
        preTokensSource: input.preTokensSource,
        postTokensEstimate: input.postTokensEstimate,
        postTokensSource: input.postTokensSource,
        compressionRatio: input.compressionRatio,
        sourceSessionId,
        sourceStartMessageId,
        sourceEndMessageId,
        createdAt,
      });
      this.db.prepare(`DELETE FROM thread_subagent_sessions WHERE thread_id = ?`).run(threadId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return {
      threadId,
      summaryId,
      schemaVersion,
      generation,
      summary,
      recentMessages: input.recentMessages.map((message) => ({ ...message })),
      preTokensEstimate: input.preTokensEstimate,
      preTokensSource: input.preTokensSource,
      postTokensEstimate: input.postTokensEstimate,
      postTokensSource: input.postTokensSource,
      compressionRatio: input.compressionRatio,
      sourceSessionId,
      sourceStartMessageId,
      sourceEndMessageId,
      createdAt,
    };
  }

  /** Non-atomic fixture/import helper. Production compaction uses commitCompactHandoffAndClearSession. */
  saveCompactHandoff(
    threadId: string,
    input: {
      summary: string;
      recentMessages: CompactConversationMessage[];
      postTokensEstimate: number;
      preTokensEstimate?: number;
      preTokensSource?: CompactTokenCountSource;
      postTokensSource?: CompactTokenCountSource;
      compressionRatio?: number;
    },
  ): ThreadCompactHandoffRecord {
    const createdAt = new Date().toISOString();
    const previous = this.selectCompactHandoffRow(threadId, false);
    const generation = Math.max(1, Math.trunc(previous?.generation ?? 0) + 1);
    const summaryId = `csm_${crypto.randomUUID()}`;
    const preTokensEstimate = input.preTokensEstimate ?? input.postTokensEstimate;
    const compressionRatio =
      input.compressionRatio ?? (preTokensEstimate > 0 ? input.postTokensEstimate / preTokensEstimate : 1);
    const record: ThreadCompactHandoffRecord = {
      threadId,
      summaryId,
      schemaVersion: 2,
      generation,
      summary: input.summary.trim(),
      recentMessages: input.recentMessages.map((message) => ({ ...message })),
      preTokensEstimate,
      preTokensSource: input.preTokensSource ?? "local_heuristic",
      postTokensEstimate: input.postTokensEstimate,
      postTokensSource: input.postTokensSource ?? "local_heuristic",
      compressionRatio,
      createdAt,
    };
    validateCompactMetrics(threadId, record);
    this.writeCompactHandoffRow(threadId, record);
    return record;
  }

  /** Non-atomic fixture/import helper. Production session capture uses captureSdkSessionAndConsumeCompactHandoff. */
  markCompactHandoffConsumed(threadId: string, targetSessionId: string): boolean {
    const sessionId = targetSessionId.trim();
    if (!sessionId) {
      throw new Error(`压缩交接消费缺少目标 SDK session（${threadId}）。`);
    }
    const consumedAt = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE thread_compact_handoff
         SET target_session_id = ?, consumed_at = ?
         WHERE thread_id = ? AND consumed_at IS NULL`,
      )
      .run(sessionId, consumedAt, threadId);
    return Number(result.changes ?? 0) === 1;
  }

  clearCompactHandoff(threadId: string): void {
    this.db.prepare(`DELETE FROM thread_compact_handoff WHERE thread_id = ?`).run(threadId);
  }

  private selectCompactHandoffRow(threadId: string, onlyPending: boolean): CompactHandoffRow | undefined {
    return this.db
      .prepare(
        `SELECT thread_id, summary_id, schema_version, generation, summary,
                recent_user_messages_json, pre_tokens_estimate, pre_tokens_source,
                post_tokens_estimate, post_tokens_source, compression_ratio,
                source_session_id, source_start_message_id, source_end_message_id,
                target_session_id, consumed_at, created_at
         FROM thread_compact_handoff
         WHERE thread_id = ?${onlyPending ? " AND consumed_at IS NULL" : ""}`,
      )
      .get(threadId) as CompactHandoffRow | undefined;
  }

  private writeCompactHandoffRow(
    threadId: string,
    input: {
      summaryId: string;
      schemaVersion: number;
      generation: number;
      summary: string;
      recentMessages: CompactConversationMessage[];
      preTokensEstimate: number;
      preTokensSource: CompactTokenCountSource;
      postTokensEstimate: number;
      postTokensSource: CompactTokenCountSource;
      compressionRatio: number;
      sourceSessionId?: string;
      sourceStartMessageId?: string;
      sourceEndMessageId?: string;
      createdAt: string;
    },
  ): void {
    this.db
      .prepare(
        `INSERT INTO thread_compact_handoff (
           thread_id, summary_id, schema_version, generation, summary,
           recent_user_messages_json, pre_tokens_estimate, pre_tokens_source,
           post_tokens_estimate, post_tokens_source, compression_ratio,
           source_session_id, source_start_message_id, source_end_message_id,
           target_session_id, consumed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           summary_id = excluded.summary_id,
           schema_version = excluded.schema_version,
           generation = excluded.generation,
           summary = excluded.summary,
           recent_user_messages_json = excluded.recent_user_messages_json,
           pre_tokens_estimate = excluded.pre_tokens_estimate,
           pre_tokens_source = excluded.pre_tokens_source,
           post_tokens_estimate = excluded.post_tokens_estimate,
           post_tokens_source = excluded.post_tokens_source,
           compression_ratio = excluded.compression_ratio,
           source_session_id = excluded.source_session_id,
           source_start_message_id = excluded.source_start_message_id,
           source_end_message_id = excluded.source_end_message_id,
           target_session_id = NULL,
           consumed_at = NULL,
           created_at = excluded.created_at`,
      )
      .run(
        threadId,
        input.summaryId,
        input.schemaVersion,
        input.generation,
        input.summary,
        JSON.stringify(input.recentMessages),
        input.preTokensEstimate,
        input.preTokensSource,
        input.postTokensEstimate,
        input.postTokensSource,
        input.compressionRatio,
        input.sourceSessionId ?? null,
        input.sourceStartMessageId ?? null,
        input.sourceEndMessageId ?? null,
        input.createdAt,
      );
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

    return rows
      .map((row) => rowToThreadMetrics(row))
      .filter((entry): entry is ThreadMetricsRecord => entry !== undefined);
  }

  saveThread(thread: ThreadSummary): void {
    const now = new Date().toISOString();
    const coreKind = thread.coreKind ?? "claude";
    if (!isCoreKind(coreKind)) {
      throw new Error(`Unsupported thread Core: ${String(coreKind)}`);
    }
    const coreLockedAt = thread.coreLockedAt ?? now;
    const runtimeConfigJson = thread.runtimeConfig
      ? serializeThreadRuntimeConfig(thread.runtimeConfig)
      : null;
    this.db
      .prepare(
        `INSERT INTO threads (
           id,
           title,
           prompt,
           workspace_path,
           status,
           message,
           created_at,
           updated_at,
           core_kind,
           core_locked_at,
           runtime_config_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        coreKind,
        coreLockedAt,
        runtimeConfigJson,
      );
  }

  setThreadCoreForDraft(threadId: string, coreKind: CoreKind): void {
    const existing = this.db
      .prepare(`SELECT core_kind, core_locked_at FROM threads WHERE id = ?`)
      .get(threadId) as { core_kind: string | null; core_locked_at: string | null } | undefined;
    if (!existing) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    if (existing.core_locked_at) {
      throw new Error(`Thread Core is locked: ${threadId}`);
    }
    const session = this.getThreadCoreSession(threadId);
    if (session) {
      throw new Error(`Unlocked thread has an existing Core session: ${threadId}`);
    }
    const update = this.db
      .prepare(`UPDATE threads SET core_kind = ?, updated_at = ? WHERE id = ? AND core_locked_at IS NULL`)
      .run(coreKind, new Date().toISOString(), threadId);
    if (Number(update.changes ?? 0) !== 1) {
      throw new Error(`Thread Core lock changed while updating: ${threadId}`);
    }
  }

  lockThreadCore(threadId: string, coreKind: CoreKind, lockedAt = new Date().toISOString()): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db
        .prepare(`SELECT core_kind, core_locked_at FROM threads WHERE id = ?`)
        .get(threadId) as { core_kind: string | null; core_locked_at: string | null } | undefined;
      if (!existing) {
        throw new Error(`Thread not found: ${threadId}`);
      }
      if (existing.core_kind !== coreKind) {
        throw new Error(
          `Thread Core mismatch: ${threadId} is ${existing.core_kind ?? "unknown"}, requested ${coreKind}`,
        );
      }
      if (!existing.core_locked_at) {
        this.db
          .prepare(
            `UPDATE threads
             SET core_locked_at = ?, updated_at = ?
             WHERE id = ? AND core_kind = ? AND core_locked_at IS NULL`,
          )
          .run(lockedAt, lockedAt, threadId, coreKind);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  saveThreadCoreSession(input: {
    threadId: string;
    coreKind: CoreKind;
    externalSessionId: string;
    cwd: string;
    metadata?: Record<string, unknown>;
  }): void {
    const externalSessionId = input.externalSessionId.trim();
    const cwd = input.cwd.trim();
    if (!externalSessionId || !cwd) {
      throw new Error(`Core session requires a session id and cwd: ${input.threadId}`);
    }
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertThreadCore(input.threadId, input.coreKind);
      this.writeThreadCoreSessionRow({ ...input, externalSessionId, cwd }, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getThreadCoreSession(threadId: string): ThreadCoreSession | undefined {
    const row = this.db
      .prepare(
        `SELECT sessions.thread_id,
                sessions.core_kind,
                sessions.external_session_id,
                sessions.cwd,
                sessions.metadata_json,
                sessions.created_at,
                sessions.updated_at,
                threads.core_kind AS thread_core_kind
         FROM thread_core_sessions AS sessions
         INNER JOIN threads ON threads.id = sessions.thread_id
         WHERE sessions.thread_id = ?`,
      )
      .get(threadId) as
      | {
          thread_id: string;
          core_kind: string;
          external_session_id: string;
          cwd: string;
          metadata_json: string | null;
          created_at: string;
          updated_at: string;
          thread_core_kind: string | null;
        }
      | undefined;
    if (!row) {
      return undefined;
    }
    if (!isCoreKind(row.core_kind)) {
      throw new Error(`Unsupported persisted Core: ${row.core_kind}`);
    }
    if (row.thread_core_kind !== row.core_kind) {
      throw new Error(
        `Core session mismatch: ${row.thread_id} is ${row.thread_core_kind ?? "unknown"}, binding is ${row.core_kind}`,
      );
    }
    const metadata = parseCoreSessionMetadata(row.metadata_json, row.thread_id);
    return {
      threadId: row.thread_id,
      coreKind: row.core_kind,
      externalSessionId: row.external_session_id,
      cwd: row.cwd,
      ...(metadata ? { metadata } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getThreadIdByCoreSession(coreKind: CoreKind, externalSessionId: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT thread_id
         FROM thread_core_sessions
         WHERE core_kind = ? AND external_session_id = ?`,
      )
      .get(coreKind, externalSessionId.trim()) as { thread_id: string } | undefined;
    return row?.thread_id;
  }

  deleteThreadCoreSession(threadId: string, coreKind: CoreKind): void {
    this.db
      .prepare(`DELETE FROM thread_core_sessions WHERE thread_id = ? AND core_kind = ?`)
      .run(threadId.trim(), coreKind);
  }

  deleteThread(threadId: string): boolean {
    const id = threadId.trim();
    if (!id || !this.getThread(id)) {
      return false;
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.deleteComposerDraft(`thread:${id}`);
      for (const table of threadOwnedTables) {
        this.db.prepare(`DELETE FROM ${table} WHERE thread_id = ?`).run(id);
      }
      this.db.prepare(`DELETE FROM threads WHERE id = ?`).run(id);
      this.db.exec("COMMIT");
      this.invalidateThreadRunEventCaches(id);
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  enqueueThreadFollowUp(input: {
    threadId: string;
    prompt: string;
    attachments?: readonly PromptImageAttachment[];
    priority?: ThreadFollowUpPriority;
    deliveryMode?: ThreadFollowUpDeliveryMode;
    sourceRunAttemptId?: string;
    queuedDuringPhase?: ThreadFollowUpRunPhase;
  }): ThreadPendingFollowUp {
    const now = new Date().toISOString();
    const record: ThreadPendingFollowUp = {
      id: `tfu_${crypto.randomUUID()}`,
      threadId: input.threadId,
      prompt: input.prompt,
      priority: input.priority ?? "normal",
      status: "queued",
      deliveryMode: input.deliveryMode ?? "queued",
      createdAt: now,
      updatedAt: now,
      ...(input.attachments && input.attachments.length > 0 ? { attachments: [...input.attachments] } : {}),
      ...(input.sourceRunAttemptId?.trim() ? { sourceRunAttemptId: input.sourceRunAttemptId.trim() } : {}),
      ...(input.queuedDuringPhase ? { queuedDuringPhase: input.queuedDuringPhase } : {}),
    };
    this.db
      .prepare(
        `INSERT INTO thread_pending_followups (
           id, thread_id, prompt, attachments_json, priority, status, delivery_mode,
           source_run_attempt_id, target_run_attempt_id, queued_during_phase, delivery_boundary, error,
           created_at, updated_at, delivered_at, applied_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, NULL, NULL)`,
      )
      .run(
        record.id,
        record.threadId,
        record.prompt,
        record.attachments ? JSON.stringify(record.attachments) : null,
        record.priority,
        record.status,
        record.deliveryMode,
        record.sourceRunAttemptId ?? null,
        record.queuedDuringPhase ?? null,
        record.createdAt,
        record.updatedAt,
      );
    this.db.prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`).run(now, input.threadId);
    return record;
  }

  getThreadFollowUp(threadId: string, followUpId: string): ThreadPendingFollowUp | undefined {
    const row = this.db
      .prepare(
        `SELECT id, thread_id, prompt, attachments_json, priority, status, delivery_mode,
                source_run_attempt_id, target_run_attempt_id, queued_during_phase, delivery_boundary, error,
                queue_position, created_at, updated_at, delivered_at, applied_at
         FROM thread_pending_followups
         WHERE thread_id = ? AND id = ?`,
      )
      .get(threadId, followUpId) as ThreadPendingFollowUpRow | undefined;
    return row ? rowToThreadPendingFollowUp(row) : undefined;
  }

  listThreadFollowUps(
    threadId: string,
    options?: { statuses?: readonly ThreadFollowUpStatus[] },
  ): ThreadPendingFollowUp[] {
    const statuses = options?.statuses?.filter(isThreadFollowUpStatus) ?? [];
    const base = `SELECT id, thread_id, prompt, attachments_json, priority, status, delivery_mode,
                         source_run_attempt_id, target_run_attempt_id, queued_during_phase, delivery_boundary, error,
                         queue_position, created_at, updated_at, delivered_at, applied_at
                  FROM thread_pending_followups
                  WHERE thread_id = ?`;
    const where = statuses.length > 0 ? ` AND status IN (${statuses.map(() => "?").join(", ")})` : "";
    const rows = this.db
      .prepare(
        `${base}${where}
         ORDER BY COALESCE(queue_position, 2147483647) ASC,
                  CASE priority WHEN 'escalated' THEN 0 ELSE 1 END,
                  created_at ASC,
                  rowid ASC`,
      )
      .all(threadId, ...statuses) as unknown as ThreadPendingFollowUpRow[];
    return rows.map(rowToThreadPendingFollowUp);
  }

  updateThreadFollowUpStatus(
    threadId: string,
    followUpId: string,
    input: {
      status: ThreadFollowUpStatus;
      deliveryMode?: ThreadFollowUpDeliveryMode;
      targetRunAttemptId?: string;
      deliveryBoundary?: ThreadFollowUpBoundary;
      error?: string;
    },
  ): ThreadPendingFollowUp | undefined {
    const existing = this.getThreadFollowUp(threadId, followUpId);
    if (!existing) {
      return undefined;
    }
    const now = new Date().toISOString();
    const deliveredAt = input.status === "delivered" ? now : existing.deliveredAt;
    const appliedAt = input.status === "applied" ? now : existing.appliedAt;
    this.db
      .prepare(
        `UPDATE thread_pending_followups
         SET status = ?,
             delivery_mode = COALESCE(?, delivery_mode),
             target_run_attempt_id = COALESCE(?, target_run_attempt_id),
             delivery_boundary = COALESCE(?, delivery_boundary),
             error = ?,
             updated_at = ?,
             delivered_at = ?,
             applied_at = ?
         WHERE thread_id = ? AND id = ?`,
      )
      .run(
        input.status,
        input.deliveryMode ?? null,
        input.targetRunAttemptId ?? null,
        input.deliveryBoundary ?? null,
        input.error ?? null,
        now,
        deliveredAt ?? null,
        appliedAt ?? null,
        threadId,
        followUpId,
      );
    return this.getThreadFollowUp(threadId, followUpId);
  }

  reorderQueuedThreadFollowUps(threadId: string, followUpIds: readonly string[]): ThreadPendingFollowUp[] {
    const queued = this.listThreadFollowUps(threadId, { statuses: ["queued"] });
    const queuedIds = new Set(queued.map((followUp) => followUp.id));
    if (
      followUpIds.length !== queuedIds.size ||
      new Set(followUpIds).size !== followUpIds.length ||
      followUpIds.some((id) => !queuedIds.has(id))
    ) {
      throw new Error("Follow-up order does not match the queued messages.");
    }
    const statement = this.db.prepare(
      `UPDATE thread_pending_followups
       SET queue_position = ?, updated_at = ?
       WHERE thread_id = ? AND id = ? AND status = 'queued'`,
    );
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      followUpIds.forEach((followUpId, index) => {
        statement.run(index, now, threadId, followUpId);
      });
      this.db.prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`).run(now, threadId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listThreadFollowUps(threadId, { statuses: ["queued"] });
  }

  cancelThreadFollowUp(threadId: string, followUpId: string): ThreadPendingFollowUp | undefined {
    const existing = this.getThreadFollowUp(threadId, followUpId);
    if (!existing || existing.status !== "queued") {
      return undefined;
    }
    return this.updateThreadFollowUpStatus(threadId, followUpId, { status: "cancelled" });
  }

  updateThreadFollowUp(
    threadId: string,
    followUpId: string,
    input: {
      prompt: string;
      attachments?: readonly PromptImageAttachment[];
    },
  ): ThreadPendingFollowUp | undefined {
    const existing = this.getThreadFollowUp(threadId, followUpId);
    if (!existing || existing.status !== "queued") {
      return undefined;
    }
    const attachments = input.attachments?.length ? [...input.attachments] : undefined;
    const prompt = input.prompt.trim() || (attachments?.length ? "请查看并分析我附上的图片。" : "");
    if (!prompt && !attachments?.length) {
      return undefined;
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE thread_pending_followups
         SET prompt = ?,
             attachments_json = ?,
             updated_at = ?
         WHERE thread_id = ? AND id = ?`,
      )
      .run(prompt, attachments ? JSON.stringify(attachments) : null, now, threadId, followUpId);
    this.db.prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`).run(now, threadId);
    return this.getThreadFollowUp(threadId, followUpId);
  }

  escalateThreadFollowUp(threadId: string, followUpId: string): ThreadPendingFollowUp | undefined {
    const existing = this.getThreadFollowUp(threadId, followUpId);
    if (!existing || existing.status !== "queued") {
      return undefined;
    }
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `UPDATE thread_pending_followups
           SET status = 'superseded', updated_at = ?
           WHERE thread_id = ?
             AND id <> ?
             AND status = 'queued'
             AND priority = 'escalated'`,
        )
        .run(now, threadId, followUpId);
      this.db
        .prepare(
          `UPDATE thread_pending_followups
           SET priority = 'escalated',
               delivery_mode = 'interrupt_resume',
               updated_at = ?
           WHERE thread_id = ? AND id = ?`,
        )
        .run(now, threadId, followUpId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getThreadFollowUp(threadId, followUpId);
  }

  claimQueuedThreadFollowUps(
    threadId: string,
    input?: {
      deliveryMode?: ThreadFollowUpDeliveryMode;
      targetRunAttemptId?: string;
      priority?: ThreadFollowUpPriority;
      deliveryBoundary?: ThreadFollowUpBoundary;
    },
  ): ThreadPendingFollowUp[] {
    const queued = this.listThreadFollowUps(threadId, { statuses: ["queued"] })
      .filter((followUp) => !input?.priority || followUp.priority === input.priority)
      .slice(0, 1);
    if (queued.length === 0) {
      return [];
    }
    const now = new Date().toISOString();
    const ids = queued.map((followUp) => followUp.id);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `UPDATE thread_pending_followups
           SET status = 'delivered',
             delivery_mode = ?,
             target_run_attempt_id = COALESCE(?, target_run_attempt_id),
             delivery_boundary = COALESCE(?, delivery_boundary),
             delivered_at = ?,
             updated_at = ?
           WHERE thread_id = ?
             AND status = 'queued'
             AND id IN (${ids.map(() => "?").join(", ")})`,
        )
        .run(
          input?.deliveryMode ?? "resume",
          input?.targetRunAttemptId ?? null,
          input?.deliveryBoundary ?? null,
          now,
          now,
          threadId,
          ...ids,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listThreadFollowUps(threadId).filter((followUp) => ids.includes(followUp.id));
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

  private assertThreadCore(threadId: string, coreKind: CoreKind): void {
    const row = this.db.prepare(`SELECT core_kind, core_locked_at FROM threads WHERE id = ?`).get(threadId) as
      | { core_kind: string | null; core_locked_at: string | null }
      | undefined;
    if (!row) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    if (row.core_kind !== coreKind) {
      throw new Error(
        `Thread Core mismatch: ${threadId} is ${row.core_kind ?? "unknown"}, requested ${coreKind}`,
      );
    }
    if (!row.core_locked_at) {
      const lockedAt = new Date().toISOString();
      this.db
        .prepare(`UPDATE threads SET core_locked_at = ?, updated_at = ? WHERE id = ?`)
        .run(lockedAt, lockedAt, threadId);
    }
  }

  private writeThreadCoreSessionRow(
    input: {
      threadId: string;
      coreKind: CoreKind;
      externalSessionId: string;
      cwd: string;
      metadata?: Record<string, unknown>;
    },
    updatedAt: string,
  ): void {
    const existing = this.db
      .prepare(`SELECT core_kind FROM thread_core_sessions WHERE thread_id = ?`)
      .get(input.threadId) as { core_kind: string } | undefined;
    if (existing && existing.core_kind !== input.coreKind) {
      throw new Error(
        `Core session mismatch: ${input.threadId} has ${existing.core_kind}, requested ${input.coreKind}`,
      );
    }
    this.db
      .prepare(
        `INSERT INTO thread_core_sessions (
           thread_id,
           core_kind,
           external_session_id,
           cwd,
           metadata_json,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           core_kind = excluded.core_kind,
           external_session_id = excluded.external_session_id,
           cwd = excluded.cwd,
           metadata_json = excluded.metadata_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.threadId,
        input.coreKind,
        input.externalSessionId,
        input.cwd,
        input.metadata ? JSON.stringify(input.metadata) : null,
        updatedAt,
        updatedAt,
      );
  }

  saveSdkSession(threadId: string, sessionId: string, cwd: string): void {
    const normalizedSessionId = sessionId.trim();
    const normalizedCwd = cwd.trim();
    if (!normalizedSessionId || !normalizedCwd) {
      throw new Error(`Claude session requires a session id and cwd: ${threadId}`);
    }
    const updatedAt = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertThreadCore(threadId, "claude");
      const update = this.db
        .prepare(
          `UPDATE threads
           SET sdk_session_id = ?, sdk_cwd = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(normalizedSessionId, normalizedCwd, updatedAt, threadId);
      if (Number(update.changes ?? 0) !== 1) {
        throw new Error(`Claude session thread not found: ${threadId}`);
      }
      this.writeThreadCoreSessionRow(
        {
          threadId,
          coreKind: "claude",
          externalSessionId: normalizedSessionId,
          cwd: normalizedCwd,
        },
        updatedAt,
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Atomically captures the replacement SDK session and consumes any pending compact handoff.
   * A compacted source session must never be reinstalled as the target session.
   */
  captureSdkSessionAndConsumeCompactHandoff(threadId: string, sessionId: string, cwd: string): boolean {
    const targetSessionId = sessionId.trim();
    const targetCwd = cwd.trim();
    if (!targetSessionId) {
      throw new Error(`SDK session capture 缺少 session id（${threadId}）。`);
    }
    if (!targetCwd) {
      throw new Error(`SDK session capture 缺少 cwd（${threadId}）。`);
    }

    const capturedAt = new Date().toISOString();
    let consumedHandoff = false;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const pendingRow = this.selectCompactHandoffRow(threadId, true);
      const pendingHandoff = pendingRow ? compactHandoffRowToRecord(pendingRow, threadId) : undefined;
      if (pendingHandoff?.sourceSessionId === targetSessionId) {
        throw new Error(`压缩后的新 SDK session 与源 session 相同，拒绝恢复旧上下文（${threadId}）。`);
      }

      const sessionUpdate = this.db
        .prepare(
          `UPDATE threads
           SET sdk_session_id = ?, sdk_cwd = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(targetSessionId, targetCwd, capturedAt, threadId);
      if (Number(sessionUpdate.changes ?? 0) !== 1) {
        throw new Error(`SDK session capture 找不到线程记录（${threadId}）。`);
      }
      this.assertThreadCore(threadId, "claude");
      this.writeThreadCoreSessionRow(
        {
          threadId,
          coreKind: "claude",
          externalSessionId: targetSessionId,
          cwd: targetCwd,
        },
        capturedAt,
      );

      if (pendingHandoff) {
        const consumed = this.db
          .prepare(
            `UPDATE thread_compact_handoff
             SET target_session_id = ?, consumed_at = ?
             WHERE thread_id = ? AND consumed_at IS NULL`,
          )
          .run(targetSessionId, capturedAt, threadId);
        if (Number(consumed.changes ?? 0) !== 1) {
          throw new Error(`压缩交接消费状态已变化，拒绝提交 SDK session（${threadId}）。`);
        }
        consumedHandoff = true;
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return consumedHandoff;
  }

  getSdkSession(threadId: string): ThreadSdkSession | undefined {
    const row = this.db.prepare(`SELECT sdk_session_id, sdk_cwd FROM threads WHERE id = ?`).get(threadId) as
      | { sdk_session_id: string | null; sdk_cwd: string | null }
      | undefined;
    if (!row?.sdk_session_id || !row.sdk_cwd) {
      return undefined;
    }
    return { sessionId: row.sdk_session_id, cwd: row.sdk_cwd };
  }

  clearSdkSession(threadId: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertThreadCore(threadId, "claude");
      this.db
        .prepare(
          `UPDATE threads
           SET sdk_session_id = NULL, sdk_cwd = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .run(new Date().toISOString(), threadId);
      this.db
        .prepare(`DELETE FROM thread_core_sessions WHERE thread_id = ? AND core_kind = 'claude'`)
        .run(threadId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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
      .all(threadId) as Array<{
      user_message_id: string;
      activity_line_id: string | null;
      created_at: string;
    }>;
    return rows.map((row) => ({
      userMessageId: row.user_message_id,
      ...(row.activity_line_id && { activityLineId: row.activity_line_id }),
      createdAt: row.created_at,
    }));
  }

  bindLatestUserActivityToSdkMessage(
    threadId: string,
    userMessageId: string,
  ): ThreadActivityLine | undefined {
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

  bindLatestUserRunEventToSdkMessage(
    threadId: string,
    userMessageId: string,
  ): ThreadActivityLine | undefined {
    const id = userMessageId.trim();
    if (!threadId.trim() || !id) {
      return undefined;
    }

    const activityLineId = sdkActivityLineId(id);
    const rewindTarget = { activityLineId, userMessageId: id };
    const existing = this.db
      .prepare(
        `SELECT message
         FROM thread_run_events
         WHERE thread_id = ? AND stream_key = ?
         ORDER BY sequence DESC
         LIMIT 1`,
      )
      .get(threadId, activityLineId) as { message: string } | undefined;
    if (existing) {
      this.saveFileCheckpoint(threadId, id, activityLineId);
      return {
        id: activityLineId,
        role: "user",
        message: existing.message,
        rewindTarget,
      };
    }

    const row = this.db
      .prepare(
        `SELECT id, message, metadata_json
         FROM thread_run_events
         WHERE thread_id = ?
           AND role = 'user'
           AND event_type = 'thread.status'
           AND (stream_key IS NULL OR stream_key = '')
         ORDER BY sequence DESC
         LIMIT 1`,
      )
      .get(threadId) as { id: string; message: string; metadata_json: string | null } | undefined;

    this.saveFileCheckpoint(threadId, id, activityLineId);
    if (!row) {
      return undefined;
    }

    this.db
      .prepare(
        `UPDATE thread_run_events
         SET stream_key = ?, metadata_json = ?
         WHERE thread_id = ? AND id = ?`,
      )
      .run(
        activityLineId,
        JSON.stringify({
          ...(parseJsonRecord(row.metadata_json) ?? {}),
          rewindTarget,
        }),
        threadId,
        row.id,
      );
    this.invalidateThreadRunEventCaches(threadId);
    return {
      id: activityLineId,
      role: "user",
      message: row.message,
      rewindTarget,
    };
  }

  getActivityRewindTarget(
    threadId: string,
    activityLineId: string,
  ): ThreadActivityLine["rewindTarget"] | undefined {
    const sdkUserMessageId = sdkMessageUuidFromActivityLineId(activityLineId);
    if (sdkUserMessageId) {
      return { activityLineId: sdkActivityLineId(sdkUserMessageId), userMessageId: sdkUserMessageId };
    }
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
    const sdkUserMessageId = sdkMessageUuidFromActivityLineId(activityLineId);
    if (sdkUserMessageId) {
      return this.rewindThreadToSdkActivityLine(threadId, activityLineId, sdkUserMessageId);
    }

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
      (this.db.prepare(sql).run(...args) as { changes?: number }).changes ?? 0;

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
      deleteChanges(
        `DELETE FROM thread_pending_followups WHERE thread_id = ? AND created_at >= ?`,
        threadId,
        cutoffCreatedAt,
      );
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
      this.invalidateThreadRunEventCaches(threadId);
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

  private rewindThreadToSdkActivityLine(
    threadId: string,
    activityLineId: string,
    userMessageId: string,
  ): ThreadActivityRewindSummary {
    const runBoundary = this.db
      .prepare(
        `SELECT sequence, observed_at
         FROM thread_run_events
         WHERE thread_id = ? AND stream_key = ?
         ORDER BY sequence ASC
         LIMIT 1`,
      )
      .get(threadId, activityLineId) as { sequence: number; observed_at: string } | undefined;
    if (!runBoundary) {
      throw new Error("该节点缺少运行事件索引，无法安全回滚。");
    }

    const cutoffCreatedAt = runBoundary.observed_at;
    const cutoffRunSequence = runBoundary.sequence;
    const deleteChanges = (sql: string, ...args: (string | number | null)[]): number =>
      (this.db.prepare(sql).run(...args) as { changes?: number }).changes ?? 0;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      deleteChanges(
        `DELETE FROM thread_file_checkpoints
         WHERE thread_id = ?
           AND (user_message_id = ? OR activity_line_id = ? OR created_at >= ?)`,
        threadId,
        userMessageId,
        activityLineId,
        cutoffCreatedAt,
      );
      const removedRunEventCount = deleteChanges(
        `DELETE FROM thread_run_events WHERE thread_id = ? AND sequence >= ?`,
        threadId,
        cutoffRunSequence,
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
      deleteChanges(
        `DELETE FROM thread_pending_followups WHERE thread_id = ? AND created_at >= ?`,
        threadId,
        cutoffCreatedAt,
      );
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
      this.invalidateThreadRunEventCaches(threadId);
      return {
        activityLineId,
        userMessageId,
        cutoffCreatedAt,
        cutoffRunSequence,
        removedActivityCount: 0,
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

  updateUsageLedgerEventAttribution(eventId: string, update: UsageLedgerAttributionUpdate): boolean {
    const result = this.db
      .prepare(
        `UPDATE thread_usage_ledger_events
         SET agent_id = ?,
             role = COALESCE(?, role),
             parent_tool_use_id = COALESCE(?, parent_tool_use_id),
             attribution_json = ?,
             metadata_json = COALESCE(?, metadata_json)
         WHERE id = ?`,
      )
      .run(
        update.agentId ?? null,
        update.role ?? null,
        update.parentToolUseId ?? null,
        JSON.stringify(update.attribution),
        update.metadata ? JSON.stringify(update.metadata) : null,
        eventId,
      ) as {
      changes?: number;
    };
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
    event = sanitizeThreadRunEventForPersistence(event);
    const existing = this.getThreadRunEvent(event.threadId, event.id);
    if (existing) {
      const upgraded = mergeRicherThreadRunEvent(existing, event);
      if (!upgraded) {
        return existing;
      }
      const versioned = shouldAdvanceThreadRunEventSequence(existing)
        ? {
            ...upgraded,
            sequence: this.nextThreadRunEventSequence(event.threadId),
          }
        : upgraded;
      this.db
        .prepare(
          `UPDATE thread_run_events
              SET sequence = ?, scope = ?, role = ?, agent_id = ?, parent_agent_id = ?,
                  parent_tool_use_id = ?, run_attempt_id = ?, request_id = ?, stream_key = ?,
                  stream_state = ?, message = ?, metadata_json = ?, observed_at = ?
            WHERE thread_id = ? AND id = ?`,
        )
        .run(
          versioned.sequence,
          versioned.scope,
          versioned.role ?? null,
          versioned.agentId ?? null,
          versioned.parentAgentId ?? null,
          versioned.parentToolUseId ?? null,
          versioned.runAttemptId ?? null,
          versioned.requestId ?? null,
          versioned.streamKey ?? null,
          versioned.streamState,
          versioned.message,
          versioned.metadata ? JSON.stringify(versioned.metadata) : null,
          versioned.observedAt,
          versioned.threadId,
          versioned.id,
        );
      this.rememberHotThreadRunEvent(versioned);
      this.updateProjectionEventCache(versioned);
      return versioned;
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
    const nextSequence = this.nextThreadRunEventSequences.get(record.threadId);
    if (nextSequence !== undefined && record.sequence >= nextSequence) {
      this.nextThreadRunEventSequences.set(record.threadId, record.sequence + 1);
    }
    this.rememberHotThreadRunEvent(record);
    this.updateProjectionEventCache(record);
    return record;
  }

  /** Rewrites persisted run events when a local placeholder request id is adopted upstream. */
  rekeyThreadRunRequestId(threadId: string, fromRequestId: string, toRequestId: string): number {
    const from = fromRequestId.trim();
    const to = toRequestId.trim();
    if (!from || !to || from === to) {
      return 0;
    }
    const result = this.db
      .prepare(
        `UPDATE thread_run_events
            SET request_id = ?
          WHERE thread_id = ? AND request_id = ?`,
      )
      .run(to, threadId, from);
    const changes = Number(result.changes ?? 0);
    if (changes > 0) {
      this.invalidateThreadRunEventCaches(threadId);
    }
    return changes;
  }

  attributeThreadRunEventsBySdkMessageIds(
    threadId: string,
    messageIds: readonly string[],
    agentId: string,
    onConflict?: (input: {
      eventId: string;
      messageId: string;
      existingAgentId: string;
      incomingAgentId: string;
    }) => void,
  ): number {
    const normalizedAgentId = agentId.trim();
    const normalizedMessageIds = new Set(messageIds.map((messageId) => messageId.trim()).filter(Boolean));
    if (!normalizedAgentId || normalizedMessageIds.size === 0) {
      return 0;
    }
    const exactAgent = this.listAgentInstances(threadId).find(
      (candidate) => candidate.agentId === normalizedAgentId,
    );
    const exactRole = exactAgent?.role.trim();
    const exactParentAgentId = exactAgent?.parentAgentId?.trim();
    const exactParentToolUseId = exactAgent?.parentToolUseId?.trim();
    const rows = this.db
      .prepare(
        `SELECT id, event_type, role, agent_id, parent_agent_id, parent_tool_use_id, scope, metadata_json
         FROM thread_run_events
         WHERE thread_id = ? AND metadata_json IS NOT NULL`,
      )
      .all(threadId) as Array<{
      id: string;
      event_type: string;
      role: string | null;
      agent_id: string | null;
      parent_agent_id: string | null;
      parent_tool_use_id: string | null;
      scope: string;
      metadata_json: string | null;
    }>;
    const update = this.db.prepare(
      `UPDATE thread_run_events
       SET role = ?, agent_id = ?, parent_agent_id = ?, parent_tool_use_id = ?,
           scope = 'agent', metadata_json = ?
       WHERE thread_id = ? AND id = ?`,
    );
    const plannerSessionId = this.getSdkSession(threadId)?.sessionId?.trim();
    let updated = 0;
    for (const row of rows) {
      const metadata = parseJsonRecord(row.metadata_json);
      const sdkMessageId = typeof metadata?.sdkMessageId === "string" ? metadata.sdkMessageId.trim() : "";
      if (!sdkMessageId || !normalizedMessageIds.has(sdkMessageId)) {
        continue;
      }
      const existingAgentId = row.agent_id?.trim();
      if (existingAgentId && existingAgentId !== normalizedAgentId && existingAgentId !== plannerSessionId) {
        onConflict?.({
          eventId: row.id,
          messageId: sdkMessageId,
          existingAgentId,
          incomingAgentId: normalizedAgentId,
        });
      }

      const nextRole =
        exactRole && row.role !== "thinking" && !row.event_type.startsWith("thinking.")
          ? exactRole
          : row.role;
      const nextParentAgentId = exactParentAgentId ?? row.parent_agent_id;
      const nextParentToolUseId = exactParentToolUseId ?? row.parent_tool_use_id;
      let nextMetadataJson = row.metadata_json;
      const metadataParentToolUseId =
        typeof metadata?.parentToolUseId === "string" ? metadata.parentToolUseId.trim() : "";
      const metadataParentToolUseIdSnake =
        typeof metadata?.parent_tool_use_id === "string" ? metadata.parent_tool_use_id.trim() : "";
      if (
        exactParentToolUseId &&
        (metadataParentToolUseId !== exactParentToolUseId ||
          metadataParentToolUseIdSnake !== exactParentToolUseId)
      ) {
        nextMetadataJson = JSON.stringify({
          ...(metadata ?? {}),
          parentToolUseId: exactParentToolUseId,
          parent_tool_use_id: exactParentToolUseId,
        });
      }

      if (
        existingAgentId === normalizedAgentId &&
        row.scope === "agent" &&
        row.role === nextRole &&
        row.parent_agent_id === nextParentAgentId &&
        row.parent_tool_use_id === nextParentToolUseId &&
        row.metadata_json === nextMetadataJson
      ) {
        continue;
      }
      const result = update.run(
        nextRole,
        normalizedAgentId,
        nextParentAgentId,
        nextParentToolUseId,
        nextMetadataJson,
        threadId,
        row.id,
      );
      updated += Number(result.changes ?? 0);
    }
    if (updated > 0) {
      this.invalidateThreadRunEventCaches(threadId);
    }
    return updated;
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

  /**
   * Projection reads collapse legacy cumulative stream rows. New streams are upserted in place,
   * while this query keeps existing large databases responsive without destructive migration.
   */
  listThreadRunEventsForProjection(threadId: string, maxEvents?: number): ThreadRunEvent[] {
    const boundedMaxEvents =
      typeof maxEvents === "number" && Number.isFinite(maxEvents)
        ? Math.max(1, Math.floor(maxEvents))
        : undefined;
    if (boundedMaxEvents !== undefined) {
      const cached = this.projectionEventCache.get(threadId);
      if (cached?.maxEvents === boundedMaxEvents) {
        this.touchProjectionEventCache(threadId, cached);
        return cached.events;
      }
    }
    const projectionQuery = `WITH latest_streams AS (
       SELECT event_type, stream_key, request_id, run_attempt_id, MAX(sequence) AS sequence
       FROM thread_run_events
       WHERE thread_id = ?
         AND event_type IN ('message.delta', 'thinking.delta')
         AND stream_key IS NOT NULL
       GROUP BY event_type, stream_key, request_id, run_attempt_id
     )
     SELECT event.id, event.thread_id, event.sequence, event.event_type, event.scope, event.role,
            event.agent_id, event.parent_agent_id, event.parent_tool_use_id,
            event.run_attempt_id, event.request_id, event.stream_key, event.stream_state,
            event.message, event.metadata_json, event.observed_at
     FROM thread_run_events AS event
     LEFT JOIN latest_streams AS latest
       ON latest.event_type = event.event_type
      AND latest.stream_key = event.stream_key
      AND latest.request_id IS event.request_id
      AND latest.run_attempt_id IS event.run_attempt_id
     WHERE event.thread_id = ?
       AND (
         event.event_type NOT IN ('message.delta', 'thinking.delta')
         OR event.stream_key IS NULL
         OR event.sequence = latest.sequence
       )`;
    const sql = boundedMaxEvents
      ? `SELECT * FROM (${projectionQuery} ORDER BY event.sequence DESC, event.observed_at DESC, event.id DESC LIMIT ?)
         ORDER BY sequence ASC, observed_at ASC, id ASC`
      : `${projectionQuery} ORDER BY event.sequence ASC, event.observed_at ASC, event.id ASC`;
    const rows = this.db
      .prepare(sql)
      .all(
        ...(boundedMaxEvents ? [threadId, threadId, boundedMaxEvents] : [threadId, threadId]),
      ) as unknown as ThreadRunEventRow[];
    const events = rows.map(rowToThreadRunEvent);
    if (boundedMaxEvents !== undefined) {
      this.rememberProjectionEvents(threadId, boundedMaxEvents, events);
    }
    return events;
  }

  /** Removes legacy cumulative stream prefixes now that stream rows are updated in place. */
  compactLegacyThreadRunStreamEvents(): number {
    const result = this.db
      .prepare(
        `DELETE FROM thread_run_events AS stale
         WHERE stale.event_type IN ('message.delta', 'thinking.delta')
           AND stale.stream_key IS NOT NULL
           AND EXISTS (
             SELECT 1
             FROM thread_run_events AS newer
             WHERE newer.thread_id = stale.thread_id
               AND newer.event_type = stale.event_type
               AND newer.stream_key = stale.stream_key
               AND newer.request_id IS stale.request_id
               AND newer.run_attempt_id IS stale.run_attempt_id
               AND newer.sequence > stale.sequence
           )`,
      )
      .run();
    const removed = Number(result.changes ?? 0);
    if (removed > 0) {
      this.hotThreadRunEventCache.clear();
      this.projectionEventCache.clear();
      this.nextThreadRunEventSequences.clear();
    }
    return removed;
  }

  clearThreadRunEvents(threadId: string): void {
    this.db.prepare(`DELETE FROM thread_run_events WHERE thread_id = ?`).run(threadId);
    this.invalidateThreadRunEventCaches(threadId);
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
      .get(threadId, agentId) as { last_active_at: string | null; accumulated_ms: number | null } | undefined;
    const lastActiveMs = row?.last_active_at ? Date.parse(row.last_active_at) : nowMs;
    const segmentMs =
      Number.isFinite(lastActiveMs) && lastActiveMs > 0 ? Math.max(0, nowMs - lastActiveMs) : 0;
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

  markSubagentSessionHandedOff(threadId: string, agentId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE thread_subagent_sessions
         SET status = 'handed_off',
             ended_at = COALESCE(ended_at, ?),
             updated_at = ?
         WHERE thread_id = ? AND agent_id = ?`,
      )
      .run(now, now, threadId, agentId);
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

  listResumableSubagentSessions(threadId: string, phase?: SubagentRunPhase): ThreadSubagentSessionRecord[] {
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
    const row = this.db.prepare(`SELECT routes_fingerprint FROM threads WHERE id = ?`).get(threadId) as
      | { routes_fingerprint: string | null }
      | undefined;
    const value = row?.routes_fingerprint?.trim();
    return value || undefined;
  }

  listThreads(): ThreadSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, prompt, workspace_path, status, message, created_at, updated_at,
                core_kind, core_locked_at, sdk_session_id, sdk_cwd, runtime_config_json
         FROM threads
         ORDER BY created_at DESC`,
      )
      .all() as unknown as ThreadRow[];

    return rows.map(rowToThread);
  }

  getThread(threadId: string): ThreadSummary | undefined {
    const row = this.db
      .prepare(
        `SELECT id, title, prompt, workspace_path, status, message, created_at, updated_at,
                core_kind, core_locked_at, sdk_session_id, sdk_cwd, runtime_config_json
         FROM threads
         WHERE id = ?`,
      )
      .get(threadId) as ThreadRow | undefined;

    return row ? rowToThread(row) : undefined;
  }

  getComposerDraft(contextKey: string): ComposerDraftRecord | undefined {
    const key = contextKey.trim();
    if (!key) {
      return undefined;
    }
    const row = this.db
      .prepare(`SELECT context_key, prompt, updated_at FROM composer_drafts WHERE context_key = ?`)
      .get(key) as { context_key: string; prompt: string; updated_at: string } | undefined;
    return row ? { contextKey: row.context_key, prompt: row.prompt, updatedAt: row.updated_at } : undefined;
  }

  saveComposerDraft(contextKey: string, prompt: string): ComposerDraftRecord | undefined {
    const key = contextKey.trim();
    if (!key) {
      throw new Error("Composer draft context key is required.");
    }
    if (prompt.length === 0) {
      this.deleteComposerDraft(key);
      return undefined;
    }
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO composer_drafts (context_key, prompt, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(context_key) DO UPDATE SET
           prompt = excluded.prompt,
           updated_at = excluded.updated_at`,
      )
      .run(key, prompt, updatedAt);
    return { contextKey: key, prompt, updatedAt };
  }

  deleteComposerDraft(contextKey: string): boolean {
    const key = contextKey.trim();
    if (!key) {
      return false;
    }
    return Number(this.db.prepare(`DELETE FROM composer_drafts WHERE context_key = ?`).run(key).changes) > 0;
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
    const last = this.getLastActivityLine(threadId);
    if (!line.stream && last?.stream && this.activityLineMatchesForMerge(last, line)) {
      const merged = line.message.trim() ? mergeStreamText(last.message, line.message) : last.message;
      this.db.prepare(`UPDATE thread_activity SET message = ?, stream = 0 WHERE id = ?`).run(merged, last.id);
      const finalized = { ...last, message: merged, stream: false };
      logSuspiciousActivityLine(threadId, finalized);
      return finalized;
    }
    if (line.stream && last?.stream && this.activityLineMatchesForMerge(last, line)) {
      const merged = mergeStreamText(last.message, line.message);
      this.db.prepare(`UPDATE thread_activity SET message = ? WHERE id = ?`).run(merged, last.id);
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

    this.db.prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), threadId);

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
           thread_id, user_prompt, analysis, plan, workspace_path, worktree_path, routes_json,
           plan_file_path, deferred_exit_plan_tool_use_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           user_prompt = excluded.user_prompt,
           analysis = excluded.analysis,
           plan = excluded.plan,
           workspace_path = excluded.workspace_path,
           worktree_path = excluded.worktree_path,
           routes_json = excluded.routes_json,
           plan_file_path = excluded.plan_file_path,
           deferred_exit_plan_tool_use_id = excluded.deferred_exit_plan_tool_use_id,
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
        plan.planFilePath?.trim() || null,
        plan.deferredExitPlanToolUseId?.trim() || null,
        new Date().toISOString(),
      );
  }

  getPendingPlan(threadId: string): (ThreadPendingPlan & { routesJson: string }) | undefined {
    const row = this.db
      .prepare(
        `SELECT thread_id, user_prompt, analysis, plan, workspace_path, worktree_path, routes_json,
                plan_file_path, deferred_exit_plan_tool_use_id
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
          plan_file_path: string | null;
          deferred_exit_plan_tool_use_id: string | null;
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
      ...(row.plan_file_path?.trim() ? { planFilePath: row.plan_file_path.trim() } : {}),
      ...(row.deferred_exit_plan_tool_use_id?.trim()
        ? { deferredExitPlanToolUseId: row.deferred_exit_plan_tool_use_id.trim() }
        : {}),
    };
  }

  getThreadClaudePlanFilePath(threadId: string): string | undefined {
    const row = this.db.prepare(`SELECT claude_plan_file_path FROM threads WHERE id = ?`).get(threadId) as
      | { claude_plan_file_path: string | null }
      | undefined;
    const path = row?.claude_plan_file_path?.trim();
    return path || undefined;
  }

  setThreadClaudePlanFilePath(threadId: string, planFilePath: string | undefined): void {
    this.db
      .prepare(
        `UPDATE threads
         SET claude_plan_file_path = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(planFilePath?.trim() || null, new Date().toISOString(), threadId);
  }

  clearThreadClaudePlanFilePath(threadId: string): void {
    this.setThreadClaudePlanFilePath(threadId, undefined);
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
        insert.run(todo.id, threadId, todo.title, todo.detail, todo.status, todo.position, todo.updatedAt);
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
    this.invalidateThreadRunEventCaches(threadId);
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
    const cacheKey = threadRunEventCacheKey(threadId, eventId);
    const cached = this.hotThreadRunEventCache.get(cacheKey);
    if (cached) {
      this.hotThreadRunEventCache.delete(cacheKey);
      this.hotThreadRunEventCache.set(cacheKey, cached);
      return cached;
    }
    const row = this.db
      .prepare(
        `SELECT id, thread_id, sequence, event_type, scope, role, agent_id,
                parent_agent_id, parent_tool_use_id, run_attempt_id, request_id, stream_key,
                stream_state, message, metadata_json, observed_at
         FROM thread_run_events
         WHERE thread_id = ? AND id = ?`,
      )
      .get(threadId, eventId) as ThreadRunEventRow | undefined;
    if (!row) {
      return undefined;
    }
    const event = rowToThreadRunEvent(row);
    this.rememberHotThreadRunEvent(event);
    return event;
  }

  private nextThreadRunEventSequence(threadId: string): number {
    const cached = this.nextThreadRunEventSequences.get(threadId);
    if (cached !== undefined) {
      this.nextThreadRunEventSequences.set(threadId, cached + 1);
      return cached;
    }
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
         FROM thread_run_events
         WHERE thread_id = ?`,
      )
      .get(threadId) as { next_sequence: number } | undefined;
    const next = row?.next_sequence ?? 1;
    this.nextThreadRunEventSequences.set(threadId, next + 1);
    return next;
  }

  private rememberHotThreadRunEvent(event: ThreadRunEvent): void {
    if (!isCollapsibleProjectionStreamEvent(event)) {
      return;
    }
    const cacheKey = threadRunEventCacheKey(event.threadId, event.id);
    this.hotThreadRunEventCache.delete(cacheKey);
    this.hotThreadRunEventCache.set(cacheKey, event);
    while (this.hotThreadRunEventCache.size > MAX_HOT_THREAD_RUN_EVENT_CACHE_ENTRIES) {
      const oldestKey = this.hotThreadRunEventCache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.hotThreadRunEventCache.delete(oldestKey);
    }
  }

  private rememberProjectionEvents(threadId: string, maxEvents: number, events: ThreadRunEvent[]): void {
    const entry = { maxEvents, events };
    this.touchProjectionEventCache(threadId, entry);
    while (this.projectionEventCache.size > MAX_PROJECTION_EVENT_CACHE_ENTRIES) {
      const oldestThreadId = this.projectionEventCache.keys().next().value;
      if (oldestThreadId === undefined) {
        break;
      }
      this.projectionEventCache.delete(oldestThreadId);
    }
  }

  private touchProjectionEventCache(threadId: string, entry: ProjectionEventCacheEntry): void {
    this.projectionEventCache.delete(threadId);
    this.projectionEventCache.set(threadId, entry);
  }

  private updateProjectionEventCache(event: ThreadRunEvent): void {
    const cached = this.projectionEventCache.get(event.threadId);
    if (!cached) {
      return;
    }
    const events = cached.events.filter((candidate) => {
      if (candidate.id === event.id) {
        return false;
      }
      return !(
        isCollapsibleProjectionStreamEvent(event) &&
        isCollapsibleProjectionStreamEvent(candidate) &&
        sameProjectionStreamIdentity(candidate, event)
      );
    });
    events.push(event);
    events.sort(compareThreadRunEvents);
    const boundedEvents =
      events.length > cached.maxEvents ? events.slice(events.length - cached.maxEvents) : events;
    this.touchProjectionEventCache(event.threadId, {
      maxEvents: cached.maxEvents,
      events: boundedEvents,
    });
  }

  private invalidateThreadRunEventCaches(threadId: string): void {
    this.projectionEventCache.delete(threadId);
    this.nextThreadRunEventSequences.delete(threadId);
    const prefix = `${threadId}\0`;
    for (const cacheKey of this.hotThreadRunEventCache.keys()) {
      if (cacheKey.startsWith(prefix)) {
        this.hotThreadRunEventCache.delete(cacheKey);
      }
    }
  }
}

function threadRunEventCacheKey(threadId: string, eventId: string): string {
  return `${threadId}\0${eventId}`;
}

function isCollapsibleProjectionStreamEvent(event: ThreadRunEvent): boolean {
  return (
    (event.eventType === "message.delta" || event.eventType === "thinking.delta") && Boolean(event.streamKey)
  );
}

function sameProjectionStreamIdentity(left: ThreadRunEvent, right: ThreadRunEvent): boolean {
  return (
    left.eventType === right.eventType &&
    left.streamKey === right.streamKey &&
    left.requestId === right.requestId &&
    left.runAttemptId === right.runAttemptId
  );
}

function compareThreadRunEvents(left: ThreadRunEvent, right: ThreadRunEvent): number {
  const sequenceDiff = left.sequence - right.sequence;
  if (sequenceDiff !== 0) {
    return sequenceDiff;
  }
  const observedAtDiff = left.observedAt.localeCompare(right.observedAt);
  return observedAtDiff !== 0 ? observedAtDiff : left.id.localeCompare(right.id);
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
    phase: normalizeRunAttemptPhase(row.phase) ?? "execution",
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

function sanitizeThreadRunEventForPersistence(event: ThreadRunEventInput): ThreadRunEventInput {
  if (!event.metadata || !("tool" in event.metadata)) {
    return event;
  }
  const metadata = sanitizeThreadRunEventMetadata(event.metadata);
  const sanitized: ThreadRunEventInput = { ...event };
  if (metadata) {
    sanitized.metadata = metadata;
  } else {
    delete sanitized.metadata;
  }
  return sanitized;
}

function sanitizeThreadRunEventMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const next = { ...metadata };
  const tool = projectThreadRunToolMetadata(readThreadRunToolMetadata(metadata));
  if (tool) {
    next.tool = tool;
  } else {
    delete next.tool;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function migratePersistedToolMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const rawTool = metadata.tool;
  if (!isJsonRecord(rawTool)) {
    return metadata;
  }
  const name = typeof rawTool.name === "string" ? rawTool.name.trim() : "";
  const legacyOutput =
    typeof rawTool.output === "string" && rawTool.output.trim() ? rawTool.output : undefined;
  const existingPreview =
    typeof rawTool.outputPreview === "string" && rawTool.outputPreview.trim()
      ? rawTool.outputPreview
      : undefined;
  const preview =
    name === "Bash" && (existingPreview || legacyOutput)
      ? createToolOutputPreview(existingPreview ?? legacyOutput ?? "")
      : undefined;
  const migratedRawTool: Record<string, unknown> = {
    ...rawTool,
    ...(preview?.text ? { outputPreview: preview.text } : {}),
    ...((preview?.truncated ||
      rawTool.outputTruncated === true ||
      rawTool.outputPreviewTruncated === true) && { outputPreviewTruncated: true }),
  };
  const tool = projectThreadRunToolMetadata(readThreadRunToolMetadata({ tool: migratedRawTool }));
  const next = { ...metadata };
  if (tool) {
    next.tool = tool;
  } else {
    delete next.tool;
  }
  return JSON.stringify(next) === JSON.stringify(metadata) ? metadata : next;
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
    scope: incoming.scope,
    streamState: incoming.streamState,
    message: incoming.message,
    observedAt: incoming.observedAt,
    ...(incoming.role?.trim() && { role: incoming.role.trim() }),
    ...(incoming.agentId?.trim() && { agentId: incoming.agentId.trim() }),
    ...(incoming.parentAgentId?.trim() && { parentAgentId: incoming.parentAgentId.trim() }),
    ...(incoming.parentToolUseId?.trim() && { parentToolUseId: incoming.parentToolUseId.trim() }),
    ...(incoming.runAttemptId?.trim() && { runAttemptId: incoming.runAttemptId.trim() }),
    ...(incoming.requestId?.trim() && { requestId: incoming.requestId.trim() }),
    ...(incoming.streamKey?.trim() && { streamKey: incoming.streamKey.trim() }),
  };
  const metadata = mergeThreadRunEventMetadata(existing.metadata, incoming.metadata);
  if (metadata) {
    updated.metadata = metadata;
  } else {
    delete updated.metadata;
  }
  return updated;
}

function shouldUpgradeThreadRunEvent(existing: ThreadRunEvent, incoming: ThreadRunEventInput): boolean {
  if (existing.eventType !== incoming.eventType) {
    return false;
  }

  const existingTool = readThreadRunToolMetadata(existing.metadata);
  const incomingTool = readThreadRunToolMetadata(incoming.metadata);
  if (isRicherThreadRunToolMetadata(existingTool, incomingTool)) {
    return true;
  }

  if (
    (existing.eventType === "message.delta" || existing.eventType === "thinking.delta") &&
    existing.streamKey &&
    existing.streamKey === incoming.streamKey &&
    incoming.observedAt >= existing.observedAt &&
    (incoming.message !== existing.message || incoming.streamState !== existing.streamState)
  ) {
    return true;
  }

  if (existing.eventType === "agent.started" && agentStartedIdentityEnrichment(existing.metadata, incoming.metadata)) {
    return true;
  }

  return streamStateRank(incoming.streamState) > streamStateRank(existing.streamState);
}

function agentStartedIdentityEnrichment(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): boolean {
  if (!incoming) {
    return false;
  }
  const incomingNickname = readMetadataString(incoming, "agentNickname") ?? readMetadataString(incoming, "nickname");
  const existingNickname = readMetadataString(existing, "agentNickname") ?? readMetadataString(existing, "nickname");
  if (incomingNickname && incomingNickname !== existingNickname) {
    return true;
  }
  const incomingTaskName = readMetadataString(incoming, "taskName");
  const existingTaskName = readMetadataString(existing, "taskName");
  if (incomingTaskName && incomingTaskName !== existingTaskName) {
    return true;
  }
  return false;
}

function readMetadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
  const description = incoming.description ?? existing.description;
  return {
    ...existing,
    ...incoming,
    ...(description !== undefined ? { description } : {}),
    ...(incoming.readTarget
      ? { readTarget: incoming.readTarget }
      : existing.readTarget
        ? { readTarget: existing.readTarget }
        : {}),
    ...(incoming.grepTarget
      ? { grepTarget: incoming.grepTarget }
      : existing.grepTarget
        ? { grepTarget: existing.grepTarget }
        : {}),
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
    return Boolean(
      incoming.detail ||
        incoming.toolUseId ||
        incoming.durationMs !== undefined ||
        incoming.exitCode !== undefined ||
        incoming.status ||
        incoming.description ||
        incoming.outputPreview ||
        incoming.outputPreviewTruncated ||
        incoming.fileChange ||
        incoming.readTarget ||
        incoming.grepTarget,
    );
  }
  if (existing.name !== incoming.name) {
    return false;
  }
  return Boolean(
    (incoming.detail && incoming.detail !== existing.detail) ||
      (incoming.outputPreview && incoming.outputPreview !== existing.outputPreview) ||
      (incoming.outputPreviewTruncated && !existing.outputPreviewTruncated) ||
      (incoming.toolUseId && incoming.toolUseId !== existing.toolUseId) ||
      (incoming.durationMs !== undefined && incoming.durationMs !== existing.durationMs) ||
      (incoming.exitCode !== undefined && incoming.exitCode !== existing.exitCode) ||
      (incoming.status && incoming.status !== existing.status) ||
      (incoming.description && incoming.description !== existing.description) ||
      (incoming.fileChange && !isSameJsonValue(incoming.fileChange, existing.fileChange)) ||
      (incoming.readTarget && !isSameJsonValue(incoming.readTarget, existing.readTarget)) ||
      (incoming.grepTarget && !isSameJsonValue(incoming.grepTarget, existing.grepTarget)),
  );
}

function isSameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
  const fileChange = parseThreadRunFileChangeMetadata(raw.fileChange);
  const readTarget = parseThreadRunReadToolTarget(raw.readTarget);
  const grepTarget = parseThreadRunGrepToolTarget(raw.grepTarget);
  return {
    name,
    ...(typeof raw.detail === "string" && raw.detail.trim() && { detail: raw.detail.trim() }),
    ...(typeof raw.outputPreview === "string" &&
      raw.outputPreview.trim() && { outputPreview: raw.outputPreview.trim() }),
    ...(raw.outputPreviewTruncated === true && { outputPreviewTruncated: true }),
    ...(typeof raw.toolUseId === "string" && raw.toolUseId.trim() && { toolUseId: raw.toolUseId.trim() }),
    ...(typeof raw.durationMs === "number" &&
      Number.isFinite(raw.durationMs) && { durationMs: raw.durationMs }),
    ...(typeof raw.exitCode === "number" && Number.isFinite(raw.exitCode) && { exitCode: raw.exitCode }),
    ...(isThreadRunToolStatus(raw.status) && { status: raw.status }),
    ...(typeof raw.description === "string" &&
      raw.description.trim() && { description: raw.description.trim() }),
    ...(fileChange && { fileChange }),
    ...(readTarget && { readTarget }),
    ...(grepTarget && { grepTarget }),
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
    if (parsed.status === "pending") {
      return {
        status: "pending",
        ...(typeof parsed.reason === "string" && parsed.reason.trim()
          ? { reason: parsed.reason.trim() }
          : {}),
      };
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

function rowToThreadPendingFollowUp(row: ThreadPendingFollowUpRow): ThreadPendingFollowUp {
  const attachments = parsePromptImageAttachmentsJson(row.attachments_json);
  const queuedDuringPhase = normalizeThreadFollowUpRunPhase(row.queued_during_phase);
  return {
    id: row.id,
    threadId: row.thread_id,
    prompt: row.prompt,
    priority: isThreadFollowUpPriority(row.priority) ? row.priority : "normal",
    status: isThreadFollowUpStatus(row.status) ? row.status : "failed",
    deliveryMode: isThreadFollowUpDeliveryMode(row.delivery_mode) ? row.delivery_mode : "queued",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(row.delivered_at ? { deliveredAt: row.delivered_at } : {}),
    ...(row.applied_at ? { appliedAt: row.applied_at } : {}),
    ...(row.source_run_attempt_id ? { sourceRunAttemptId: row.source_run_attempt_id } : {}),
    ...(row.target_run_attempt_id ? { targetRunAttemptId: row.target_run_attempt_id } : {}),
    ...(queuedDuringPhase ? { queuedDuringPhase } : {}),
    ...(isThreadFollowUpBoundary(row.delivery_boundary) ? { deliveryBoundary: row.delivery_boundary } : {}),
    ...(row.queue_position !== null ? { queuePosition: row.queue_position } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}

function parsePromptImageAttachmentsJson(raw: string | null): PromptImageAttachment[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isPromptImageAttachment);
  } catch {
    return [];
  }
}

function isPromptImageAttachment(value: unknown): value is PromptImageAttachment {
  if (!isJsonRecord(value)) {
    return false;
  }
  return (
    isPromptImageMediaType(value.mediaType) && typeof value.data === "string" && value.data.trim().length > 0
  );
}

function isPromptImageMediaType(value: unknown): value is PromptImageAttachment["mediaType"] {
  return value === "image/jpeg" || value === "image/png" || value === "image/gif" || value === "image/webp";
}

function isThreadFollowUpStatus(value: unknown): value is ThreadFollowUpStatus {
  return (
    value === "queued" ||
    value === "delivered" ||
    value === "applied" ||
    value === "superseded" ||
    value === "cancelled" ||
    value === "failed"
  );
}

function isThreadFollowUpPriority(value: unknown): value is ThreadFollowUpPriority {
  return value === "normal" || value === "escalated";
}

function isThreadFollowUpDeliveryMode(value: unknown): value is ThreadFollowUpDeliveryMode {
  return (
    value === "queued" || value === "resume" || value === "interrupt_resume" || value === "streaming_push"
  );
}

function normalizeThreadFollowUpRunPhase(value: unknown): ThreadFollowUpRunPhase | undefined {
  if (value === "question") {
    return "ask";
  }
  if (value === "planning" || value === "execution" || value === "ask" || value === "continuation") {
    return value;
  }
  return undefined;
}

function isThreadFollowUpRunPhase(value: unknown): value is ThreadFollowUpRunPhase {
  return normalizeThreadFollowUpRunPhase(value) !== undefined;
}

function isThreadFollowUpBoundary(value: unknown): value is ThreadFollowUpBoundary {
  return value === "safe_boundary" || value === "forced_interrupt";
}

function rowToThread(row: ThreadRow): ThreadSummary {
  const runtimeConfig = parseThreadRuntimeConfigJson(row.runtime_config_json);
  const coreKind = isCoreKind(row.core_kind) ? row.core_kind : undefined;
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    workspacePath: row.workspace_path,
    status: row.status as ThreadStatus,
    message: row.message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(coreKind ? { coreKind } : {}),
    ...(row.core_locked_at ? { coreLockedAt: row.core_locked_at } : {}),
    ...(row.sdk_session_id && row.sdk_cwd ? { sdkSessionId: row.sdk_session_id, sdkCwd: row.sdk_cwd } : {}),
    ...(runtimeConfig ? { runtimeConfig } : {}),
  };
}

function parseCoreSessionMetadata(
  value: string | null,
  threadId: string,
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Core session metadata JSON is invalid: ${threadId}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Core session metadata must be an object: ${threadId}`);
  }
  return parsed as Record<string, unknown>;
}
