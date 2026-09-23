import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  CONVERSATION_V2_ERROR,
  type ConversationEventInput,
  ConversationV2Error,
  stableHash,
} from "@eco/shared";
import type { ThreadRunEvent, ThreadRunEventType } from "../shared/thread-run-events";
import { appendLegacyThreadRunEventToConversationV2 } from "./conversation-v2-legacy-adapter";
import { conversationV2RunEventForAttempt } from "./conversation-v2-run-events";
import { conversationV2ProviderReceipt } from "./conversation-v2-runtime-writer";
import type { ConversationAppendResult, ConversationV2Store } from "./conversation-v2-store";
import { isPromptImageAttachmentRecord, type PromptImageFileStore } from "./prompt-image-file-store";
import { normalizeRunAttemptPhase, type RunAttemptStatus } from "./usage-ledger";

interface LegacyUserMessageRow {
  thread_id: string;
  activity_line_id: string;
  upstream_message_id?: string | null;
  text: string;
  attachments_json: string | null;
  created_at: string;
}

interface LegacyRunEventRow {
  id: string;
  thread_id: string;
  sequence: number;
  event_type: string;
  scope: string;
  role: string | null;
  agent_id: string | null;
  parent_agent_id?: string | null;
  parent_tool_use_id?: string | null;
  run_attempt_id: string | null;
  request_id: string | null;
  stream_key: string | null;
  stream_state: string;
  message: string;
  metadata_json: string | null;
  observed_at: string;
}

type MigrationSource =
  | { kind: "user"; row: LegacyUserMessageRow }
  | { kind: "event"; row: LegacyRunEventRow };

interface LegacyRunAttemptRow {
  phase: string;
  retry_index: number;
  metadata_json: string | null;
  thread_id: string;
  attempt_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
}

interface LegacyAgentInstanceRow {
  updated_at: string;
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
  metadata_json: string | null;
}

interface LegacyTodoRow {
  id: string;
  thread_id: string;
  title: string;
  detail: string;
  status: string;
  position: number;
  updated_at: string;
}

export interface ConversationV2MigrationReport {
  conversationId: string;
  sourceFingerprint: string;
  userMessageCount: number;
  legacyEventCount: number;
  /** Attempts of `thread_run_attempts` that seed the V2 run of their turn. */
  runAttemptCount: number;
  /** Legacy agent registry rows that become replayable `agent.upsert` effects. */
  agentInstanceCount: number;
  emittedEventCount: number;
  noopEventCount: number;
  unmappedEventTypes: string[];
  missingFields: string[];
  conflicts: string[];
  canMigrate: boolean;
  phase: "dry_run" | "completed";
}

/**
 * Idempotent migration boundary for the current legacy SQLite tables.
 *
 * The dry-run is deliberately strict about source shape. Events that are
 * structurally valid but have no V2 read-model equivalent become explicit
 * `noop` facts with a diagnostic reason, so the sync range remains continuous.
 */
export class ConversationV2LegacyMigrator {
  constructor(
    private readonly db: DatabaseSyncType,
    private readonly store: ConversationV2Store,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly promptImageFileStore?: PromptImageFileStore,
  ) {}

  inspect(conversationId: string): ConversationV2MigrationReport {
    const id = requireConversationId(conversationId);
    this.ensureLegacyTables();
    const users = this.userMessages(id);
    const events = this.runEvents(id);
    // The attempt table is part of the source: it is the only record of what a run
    // did, so a change there has to invalidate the fingerprint like any other source
    // change, and its rows become the V2 runs of the migrated conversation.
    const attempts = this.runAttempts(id);
    const agents = this.agentInstances(id);
    const sourceFingerprint = stableHash({ users, events, attempts, agents });
    const unmapped = new Set<string>();
    const missing = new Set<string>();
    const conflicts = new Set<string>();
    const eventIds = new Set<string>();
    const sequences = new Set<number>();
    for (const row of events) {
      if (!isSupportedLegacyType(row.event_type as ThreadRunEventType)) {
        unmapped.add(row.event_type);
      }
      if (!row.id.trim()) missing.add(`event:${row.sequence}:id`);
      if (!row.observed_at.trim()) missing.add(`event:${row.sequence}:observed_at`);
      if (row.metadata_json && !parseMetadata(row.metadata_json)) {
        missing.add(`event:${row.sequence}:metadata_json`);
      }
      if (eventIds.has(row.id)) conflicts.add(`duplicate_event_id:${row.id}`);
      eventIds.add(row.id);
      if (sequences.has(row.sequence)) conflicts.add(`duplicate_sequence:${row.sequence}`);
      sequences.add(row.sequence);
    }
    for (const row of users) {
      if (!row.activity_line_id.trim()) missing.add("user_message:activity_line_id");
      if (!row.created_at.trim()) missing.add(`user_message:${row.activity_line_id}:created_at`);
      if (row.attachments_json) {
        const attachments = parseAttachments(row.attachments_json);
        if (!attachments) {
          missing.add(`user_message:${row.activity_line_id}:attachments_json`);
        } else if (attachments.length > 0) {
          if (!this.promptImageFileStore) {
            missing.add(`user_message:${row.activity_line_id}:durable_attachments`);
          } else {
            for (const [index, value] of attachments.entries()) {
              if (isPromptImageAttachmentRecord(value)) {
                try {
                  this.promptImageFileStore.validateAttachmentForMigration(value);
                } catch {
                  missing.add(`user_message:${row.activity_line_id}:durable_attachment_${index}`);
                }
                continue;
              }
              if (!isLegacyOpaqueAttachmentRecord(value)) {
                missing.add(`user_message:${row.activity_line_id}:attachment_${index}`);
                continue;
              }
              try {
                this.promptImageFileStore.validateLegacyAttachmentForMigration(value);
              } catch {
                missing.add(`user_message:${row.activity_line_id}:opaque_attachment_${index}`);
              }
            }
          }
        }
      }
    }
    const userMessageIds = new Set<string>();
    for (const row of users) {
      if (userMessageIds.has(row.activity_line_id)) {
        conflicts.add(`duplicate_user_message:${row.activity_line_id}`);
      }
      userMessageIds.add(row.activity_line_id);
    }
    const seenAttemptIds = new Set<string>();
    for (const row of attempts) {
      if (!normalizeRunAttemptPhase(row.phase))
        conflicts.add(`unknown_attempt_phase:${row.attempt_id}:${row.phase}`);
      if (!Number.isSafeInteger(row.retry_index) || row.retry_index < 0)
        conflicts.add(`invalid_attempt_retry:${row.attempt_id}`);
      if (row.metadata_json && !parseMetadata(row.metadata_json))
        conflicts.add(`invalid_attempt_metadata:${row.attempt_id}`);
      if (!row.attempt_id.trim()) missing.add("run_attempt:attempt_id");
      if (!row.started_at.trim()) {
        missing.add(`run_attempt:${row.attempt_id}:started_at`);
      }
      if (seenAttemptIds.has(row.attempt_id)) {
        conflicts.add(`duplicate_run_attempt:${row.attempt_id}`);
      }
      seenAttemptIds.add(row.attempt_id);
      if (!normalizeLegacyAttemptStatus(row.status)) {
        conflicts.add(`unknown_attempt_status:${row.attempt_id}:${row.status}`);
      }
    }
    const seenAgentIds = new Set<string>();
    for (const row of agents) {
      if (!row.agent_id.trim()) missing.add("agent_instance:agent_id");
      if (!row.role.trim()) missing.add(`agent_instance:${row.agent_id}:role`);
      if (!row.kind.trim()) missing.add(`agent_instance:${row.agent_id}:kind`);
      if (!row.status.trim()) missing.add(`agent_instance:${row.agent_id}:status`);
      if (!row.started_at.trim()) {
        missing.add(`agent_instance:${row.agent_id}:started_at`);
      }
      if (row.metadata_json && !parseMetadata(row.metadata_json)) {
        missing.add(`agent_instance:${row.agent_id}:metadata_json`);
      }
      if (seenAgentIds.has(row.agent_id)) {
        conflicts.add(`duplicate_agent_instance:${row.agent_id}`);
      }
      seenAgentIds.add(row.agent_id);
    }
    return {
      conversationId: id,
      sourceFingerprint,
      userMessageCount: users.length,
      legacyEventCount: events.length,
      runAttemptCount: attempts.length,
      agentInstanceCount: agents.length,
      emittedEventCount: 0,
      noopEventCount: 0,
      unmappedEventTypes: [...unmapped].sort(),
      missingFields: [...missing].sort(),
      conflicts: [...conflicts].sort(),
      canMigrate: missing.size === 0 && conflicts.size === 0,
      phase: "dry_run",
    };
  }

  migrate(conversationId: string): ConversationV2MigrationReport {
    const report = this.inspect(conversationId);
    if (!report.canMigrate) {
      throw new ConversationV2Error(
        CONVERSATION_V2_ERROR.migrationIncomplete,
        "Legacy conversation data is incomplete or has ordering conflicts.",
        { ...report },
      );
    }
    const existing = this.db
      .prepare(
        `SELECT source_fingerprint, phase, checkpoint, validation_json
         FROM conversation_migrations_v2
         WHERE migration_version = 1 AND conversation_id = ?`,
      )
      .get(report.conversationId) as
      | {
          source_fingerprint: string;
          phase: string;
          checkpoint: string | null;
          validation_json: string | null;
        }
      | undefined;
    if (existing?.source_fingerprint === report.sourceFingerprint && existing.phase === "completed") {
      this.assertProviderInputCoverage(report);
      const toolSummaryEventCount = this.reconcileLegacyToolSummaries(
        report.conversationId,
        `migration:v1:${report.sourceFingerprint}`,
      );
      this.store.validateIntegrity(report.conversationId);
      const todoEventCount = this.seedCoderTodos(
        report.conversationId,
        `migration:v1:${report.sourceFingerprint}`,
      );
      const completed = parseCompletedReport(existing.validation_json);
      return {
        ...report,
        ...(completed ?? {}),
        emittedEventCount:
          (completed?.emittedEventCount ?? report.emittedEventCount) + todoEventCount + toolSummaryEventCount,
        phase: "completed",
      };
    }
    if (existing && existing.source_fingerprint !== report.sourceFingerprint) {
      throw new ConversationV2Error(
        CONVERSATION_V2_ERROR.migrationIncomplete,
        "Legacy conversation source changed after migration started.",
        {
          previous: existing.source_fingerprint,
          current: report.sourceFingerprint,
        },
      );
    }
    const migrationPrefix = `migration:v1:${report.sourceFingerprint}`;
    const sourceUsers = this.userMessages(report.conversationId);
    const sourceEvents = this.runEvents(report.conversationId);
    const currentSourceFingerprint = stableHash({
      users: sourceUsers,
      events: sourceEvents,
      attempts: this.runAttempts(report.conversationId),
      agents: this.agentInstances(report.conversationId),
    });
    if (currentSourceFingerprint !== report.sourceFingerprint) {
      throw new ConversationV2Error(
        CONVERSATION_V2_ERROR.migrationIncomplete,
        "Legacy conversation source changed during migration planning.",
        {
          previous: report.sourceFingerprint,
          current: currentSourceFingerprint,
        },
      );
    }
    const sources = mergeMigrationSources(sourceUsers, sourceEvents);
    const existingEventCount = Number(
      (
        this.db
          .prepare(`SELECT COUNT(*) AS count FROM conversation_events_v2 WHERE conversation_id = ?`)
          .get(report.conversationId) as { count: number }
      ).count,
    );
    const hasExistingEvents = existingEventCount > 0;
    const canResume =
      existing?.source_fingerprint === report.sourceFingerprint &&
      (existing.phase === "running" || existing.phase === "failed") &&
      this.hasOnlyMigrationEvents(report.conversationId, migrationPrefix);
    if (hasExistingEvents && !canResume) {
      throw new ConversationV2Error(
        CONVERSATION_V2_ERROR.migrationIncomplete,
        "Cannot migrate into a conversation that already has V2 events.",
      );
    }

    const resumeIndex = canResume ? parseMigrationCheckpoint(existing?.checkpoint, sources.length) : 0;
    let emittedEventCount = canResume ? this.countMigrationEvents(report.conversationId, migrationPrefix) : 0;
    let noopEventCount = canResume
      ? this.countMigrationNoopEvents(report.conversationId, migrationPrefix)
      : 0;
    let completedSourceIndex = resumeIndex;
    this.saveProgress(report, "running", resumeIndex, {
      ...report,
      emittedEventCount,
      noopEventCount,
    });
    try {
      this.store.ensureConversation(report.conversationId);
      const prefix = migrationPrefix;
      // Seed the legacy agent registry before translating provider rows. Some legacy rows
      // are scoped to an agent but leave `agent_id` empty; the adapter resolves those rows
      // from the replayable V2 registry by parent tool or role/run window. Appending the
      // registry after the source loop made those rows permanently main-owned, even though
      // the same migration later wrote the agent facts. The source key keeps this safe on
      // resume and makes the ordering deterministic for a fresh replay.
      emittedEventCount += this.seedAgentInstances(report.conversationId, prefix);
      // Seed the runs before the row loop: `thread_run_attempts` is the authority for
      // execution state, and without these events a migrated conversation has no V2
      // run at all — V2-only consumers read runs and nothing else, so every turn would
      // show up without a status or a duration. Idempotent by source key, so a resume
      // re-runs it without appending anything.
      emittedEventCount += this.seedRunAttempts(report.conversationId, prefix);
      for (const [index, source] of sources.entries()) {
        if (index < resumeIndex) continue;
        const results: ConversationAppendResult[] = [];
        const append = (input: ConversationEventInput): ConversationAppendResult => {
          const result = this.store.appendInCurrentTransaction(input);
          results.push(result);
          return result;
        };
        const previousEmitted = emittedEventCount;
        const previousNoop = noopEventCount;
        this.db.exec("BEGIN IMMEDIATE");
        try {
          if (source.kind === "user") {
            const row = source.row;
            const messageId = `migration_message_${stableHash(`${report.sourceFingerprint}:${row.activity_line_id}`)}`;
            const turnId = `migration_turn_${stableHash(`${report.sourceFingerprint}:${row.activity_line_id}`)}`;
            const payload: Record<string, unknown> = {
              role: "user",
              channel: "answer",
              body: row.text,
              status: "final",
              historyTarget: {
                activityLineId: row.activity_line_id,
                ...(row.upstream_message_id?.trim() ? { userMessageId: row.upstream_message_id.trim() } : {}),
              },
            };
            const attachments = parseAttachments(row.attachments_json);
            if (attachments !== undefined && attachments.length > 0) {
              const imageStore = this.promptImageFileStore;
              if (!imageStore) {
                throw new ConversationV2Error(
                  CONVERSATION_V2_ERROR.migrationIncomplete,
                  `Durable prompt image store is required for ${row.activity_line_id}.`,
                );
              }
              payload.attachments = attachments.map((value, index) => {
                if (!isPromptImageAttachmentRecord(value)) {
                  if (!isLegacyOpaqueAttachmentRecord(value)) {
                    throw new ConversationV2Error(
                      CONVERSATION_V2_ERROR.migrationIncomplete,
                      `Legacy attachment ${row.activity_line_id}:${index} is invalid.`,
                    );
                  }
                  const metadata = imageStore.validateLegacyAttachmentForMigration(value);
                  return sanitizeLegacyOpaqueAttachment(value, metadata);
                }
                return imageStore.persistAttachmentForMigration(value);
              });
            }
            const result = append({
              conversationId: report.conversationId,
              eventId: `migration_event_${stableHash(`${prefix}:user:${row.activity_line_id}`)}`,
              sourceEventKey: `${prefix}:user:${row.activity_line_id}`,
              type: "message.created",
              occurredAt: row.created_at,
              turnId,
              messageId,
              payload,
            });
            emittedEventCount += result.duplicate ? 0 : 1;
          } else {
            const row = source.row;
            const legacy = toThreadRunEvent(row);
            const emitted = appendLegacyThreadRunEventToConversationV2(this.store, legacy, {
              sourcePrefix: prefix,
              inCurrentTransaction: true,
              onAppendResult: (result) => results.push(result),
            });
            if (emitted > 0) {
              emittedEventCount += emitted;
            } else {
              append(noopEvent(report.conversationId, prefix, row, "legacy_event_unmapped"));
              emittedEventCount += 1;
              noopEventCount += 1;
            }
            const receipt = append(conversationV2ProviderReceipt(legacy, `${prefix}:input`));
            if (!receipt.duplicate) {
              emittedEventCount += 1;
              noopEventCount += 1;
            }
          }
          this.saveProgress(report, "running", index + 1, {
            ...report,
            emittedEventCount,
            noopEventCount,
          });
          this.db.exec("COMMIT");
        } catch (error) {
          try {
            this.db.exec("ROLLBACK");
          } catch {
            // SQLite may have already rolled back after SQLITE_FULL or another
            // fatal storage error; keep the original migration failure visible.
          }
          emittedEventCount = previousEmitted;
          noopEventCount = previousNoop;
          throw error;
        }
        completedSourceIndex = index + 1;
        this.store.publishCommitted(results);
      }
      // User prompt rows can intentionally replace a legacy event row in the visible
      // migration order. Keep an immutable identity receipt for that hidden source row
      // as well, so V2 can prove conservation and reconstruct the source index later.
      const migratedEventIds = new Set(
        sources
          .filter((source): source is Extract<MigrationSource, { kind: "event" }> => source.kind === "event")
          .map((source) => source.row.id),
      );
      for (const row of sourceEvents) {
        if (migratedEventIds.has(row.id)) continue;
        const receipt = this.store.append(
          conversationV2ProviderReceipt(toThreadRunEvent(row), `${prefix}:input`, {
            includeMessageId: false,
          }),
        );
        if (!receipt.duplicate) {
          emittedEventCount += 1;
          noopEventCount += 1;
        }
      }
      // Agent instances are source facts, not a cache repair. They were appended before the
      // provider rows above so owner resolution could use the same immutable registry while
      // translating rows. The source key makes the operation idempotent on resume.
      emittedEventCount += this.seedCoderTodos(report.conversationId, prefix);
      // Do not mark a migration complete merely because every source row was
      // visited. The durable event/effect pair and its hashes must also be
      // readable after the final transaction.
      this.store.validateIntegrity(report.conversationId);
      this.assertProviderInputCoverage(report);
      const completed = {
        ...report,
        emittedEventCount,
        noopEventCount,
        phase: "completed" as const,
      };
      this.saveProgress(report, "completed", sources.length, completed);
      return completed;
    } catch (error) {
      try {
        this.saveProgress(report, "failed", completedSourceIndex, {
          ...report,
          emittedEventCount,
          noopEventCount,
        });
      } catch {
        // A full database can reject the failure checkpoint too. Keep the
        // original migration error visible instead of masking it.
      }
      throw error;
    }
  }

  private saveProgress(
    report: ConversationV2MigrationReport,
    phase: string,
    checkpoint: number,
    validation: unknown,
  ): void {
    this.db
      .prepare(
        `INSERT INTO conversation_migrations_v2
           (migration_version, conversation_id, source_fingerprint, phase, checkpoint, validation_json, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(migration_version, conversation_id) DO UPDATE SET
           source_fingerprint = excluded.source_fingerprint,
           phase = excluded.phase,
           checkpoint = excluded.checkpoint,
           validation_json = excluded.validation_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        report.conversationId,
        report.sourceFingerprint,
        phase,
        String(checkpoint),
        JSON.stringify(validation),
        this.now(),
      );
  }

  private assertProviderInputCoverage(report: ConversationV2MigrationReport): void {
    const missing = this.db
      .prepare(`SELECT e.id FROM thread_run_events e
      WHERE e.thread_id = ? AND NOT EXISTS (
        SELECT 1 FROM conversation_provider_inputs_v2 p
        WHERE p.conversation_id = e.thread_id AND p.input_id = e.id
      ) ORDER BY e.sequence`)
      .all(report.conversationId);
    if (missing.length > 0) {
      throw new ConversationV2Error(
        CONVERSATION_V2_ERROR.migrationIncomplete,
        `Migrated conversation is missing V2 provider identities (${missing.length}: ${missing
          .map((row) => String((row as { id?: unknown }).id ?? "?"))
          .join(", ")}); a full maintenance reimport is required.`,
        { conversationId: report.conversationId, missing },
      );
    }
  }

  private countMigrationEvents(conversationId: string, prefix: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM conversation_events_v2
         WHERE conversation_id = ? AND source_event_key LIKE ?`,
      )
      .get(conversationId, `${prefix}:%`) as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  private countMigrationNoopEvents(conversationId: string, prefix: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM conversation_events_v2
         WHERE conversation_id = ?
           AND type = 'noop'
           AND source_event_key LIKE ?`,
      )
      .get(conversationId, `${prefix}:%`) as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  /**
   * Upgrade V2 tool rows created by an older adapter while the legacy source is still
   * available. The source event is immutable and idempotent, so the only legal repair is
   * a new `tool.updated` fact that fills fields the existing summary does not have.
   */
  private reconcileLegacyToolSummaries(conversationId: string, sourcePrefix: string): number {
    const results: ConversationAppendResult[] = [];
    let emitted = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of this.runEvents(conversationId)) {
        if (!isLegacyToolSummarySource(row)) continue;
        const legacy = toThreadRunEvent(row);
        const count = appendLegacyThreadRunEventToConversationV2(this.store, legacy, {
          mode: "migration",
          sourcePrefix,
          inCurrentTransaction: true,
          onAppendResult: (result) => results.push(result),
        });
        emitted += count;
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the source error if SQLite already rolled back the transaction.
      }
      throw error;
    }
    this.store.publishCommitted(results);
    return emitted;
  }

  private ensureLegacyTables(): void {
    const rows = this.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('thread_user_messages', 'thread_run_events')`,
      )
      .all() as Array<{ name: string }>;
    const names = new Set(rows.map((row) => row.name));
    if (!names.has("thread_user_messages") || !names.has("thread_run_events")) {
      throw new ConversationV2Error(
        CONVERSATION_V2_ERROR.migrationIncomplete,
        "Legacy conversation tables are not available.",
      );
    }
  }

  private userMessages(conversationId: string): LegacyUserMessageRow[] {
    const columns = new Set(
      (this.db.prepare(`PRAGMA table_info(thread_user_messages)`).all() as Array<{ name?: unknown }>).map(
        (column) => (typeof column.name === "string" ? column.name : ""),
      ),
    );
    const upstreamMessageId = columns.has("upstream_message_id")
      ? "upstream_message_id"
      : "NULL AS upstream_message_id";
    return this.db
      .prepare(
        `SELECT thread_id, activity_line_id, ${upstreamMessageId},
                text, attachments_json, created_at
         FROM thread_user_messages WHERE thread_id = ?
         ORDER BY created_at ASC, activity_line_id ASC`,
      )
      .all(conversationId) as unknown as LegacyUserMessageRow[];
  }

  /**
   * Attempts of the conversation. The table is optional: a legacy snapshot that
   * predates the attempt ledger simply has no runs to seed, which is not a defect
   * of the source and must not fail the migration.
   */
  private runAttempts(conversationId: string): LegacyRunAttemptRow[] {
    const exists = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_run_attempts'`)
      .get() as { name?: string } | undefined;
    if (!exists?.name) return [];
    return this.db
      .prepare(
        `SELECT thread_id, attempt_id, phase, retry_index, metadata_json, status, started_at, ended_at
         FROM thread_run_attempts WHERE thread_id = ?
         ORDER BY started_at ASC, attempt_id ASC`,
      )
      .all(conversationId) as unknown as LegacyRunAttemptRow[];
  }

  /**
   * Agent registry rows are optional for old snapshots, but when present they are part of
   * the migration source and must be fingerprinted and replayable like messages and runs.
   */
  private agentInstances(conversationId: string): LegacyAgentInstanceRow[] {
    const exists = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_agent_instances'`)
      .get() as { name?: string } | undefined;
    if (!exists?.name) return [];
    return this.db
      .prepare(
        `SELECT thread_id, agent_id, role, kind, status, run_attempt_id,
                parent_agent_id, parent_tool_use_id, mission_key, todo_id,
                started_at, ended_at, updated_at, metadata_json
         FROM thread_agent_instances WHERE thread_id = ?
         ORDER BY started_at ASC, agent_id ASC`,
      )
      .all(conversationId) as unknown as LegacyAgentInstanceRow[];
  }

  /** Import the legacy todo snapshot once; subsequent runtime writes originate in V2. */
  private seedCoderTodos(conversationId: string, prefix: string): number {
    const alreadySeeded = this.db
      .prepare(
        `SELECT 1 FROM conversation_events_v2
         WHERE conversation_id = ? AND type = 'todo.updated' LIMIT 1`,
      )
      .get(conversationId) as { 1?: number } | undefined;
    if (alreadySeeded) return 0;
    const exists = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_coder_todos'`)
      .get() as { name?: string } | undefined;
    if (!exists?.name) return 0;
    const todos = this.db
      .prepare(
        `SELECT id, thread_id, title, detail, status, position, updated_at
         FROM thread_coder_todos WHERE thread_id = ?
         ORDER BY position ASC, id ASC`,
      )
      .all(conversationId) as unknown as LegacyTodoRow[];
    if (todos.length === 0) return 0;
    const sourceEventKey = `${prefix}:todos:${stableHash(todos)}`;
    const result = this.store.append({
      conversationId,
      eventId: `migration_event_${stableHash(sourceEventKey)}`,
      sourceEventKey,
      type: "todo.updated",
      occurredAt:
        todos
          .map((todo) => todo.updated_at)
          .sort()
          .at(-1) ?? this.now(),
      payload: {
        todos: todos.map((todo) => ({
          todoId: todo.id,
          conversationId,
          title: todo.title,
          detail: todo.detail,
          status: todo.status,
          position: todo.position,
          updatedAt: todo.updated_at,
        })),
      },
    });
    return result.duplicate ? 0 : 1;
  }

  /** One `run.*` event per attempt, keyed so a repeated pass appends nothing. */
  private seedRunAttempts(conversationId: string, prefix: string): number {
    let written = 0;
    for (const attempt of this.runAttempts(conversationId)) {
      const status = normalizeLegacyAttemptStatus(attempt.status);
      // An unreadable status was reported as a conflict by `inspect`, so the
      // migration never reaches this point with one.
      if (!status || !attempt.attempt_id.trim() || !attempt.started_at.trim()) {
        continue;
      }
      const result = this.store.append(
        conversationV2RunEventForAttempt({
          conversationId,
          attemptId: attempt.attempt_id,
          status,
          phase: normalizeRunAttemptPhase(attempt.phase)!,
          retryIndex: attempt.retry_index,
          ...(attempt.metadata_json ? { metadata: parseMetadata(attempt.metadata_json)! } : {}),
          startedAt: attempt.started_at,
          ...(attempt.ended_at ? { endedAt: attempt.ended_at } : {}),
          sourcePrefix: `${prefix}:run`,
          now: this.now,
        }),
      );
      if (!result.duplicate) written += 1;
    }
    return written;
  }

  /** One replayable `agent.upsert` effect per legacy registry row. */
  private seedAgentInstances(conversationId: string, prefix: string): number {
    let written = 0;
    for (const agent of this.agentInstances(conversationId)) {
      const metadata = parseMetadata(agent.metadata_json);
      const optionalMetadataText = (key: string): string | undefined => {
        const value = metadata?.[key];
        return typeof value === "string" && value.trim() ? value : undefined;
      };
      const taskName = optionalMetadataText("taskName");
      const delegationSummary = optionalMetadataText("delegationSummary");
      const delegationPrompt = optionalMetadataText("delegationPrompt");
      const sourceEventKey = `${prefix}:agent:${agent.agent_id}`;
      const result = this.store.append({
        conversationId,
        eventId: `migration_event_${stableHash(sourceEventKey)}`,
        sourceEventKey,
        type: "agent.created",
        occurredAt: agent.ended_at ?? agent.started_at,
        ...(agent.run_attempt_id ? { runId: agent.run_attempt_id } : {}),
        agentId: agent.agent_id,
        agentInstanceId: agent.agent_id,
        ...(agent.parent_agent_id
          ? { parentAgentId: agent.parent_agent_id, parentAgentInstanceId: agent.parent_agent_id }
          : {}),
        ...(agent.parent_tool_use_id ? { parentToolCallId: agent.parent_tool_use_id } : {}),
        payload: {
          authority: "lifecycle",
          updatedAt: agent.updated_at,
          ...(metadata ? { metadata } : {}),
          agentInstanceId: agent.agent_id,
          role: agent.role,
          kind: agent.kind,
          status: agent.status,
          startedAt: agent.started_at,
          ...(agent.ended_at ? { endedAt: agent.ended_at } : {}),
          ...(agent.mission_key !== null ? { mission: agent.mission_key } : {}),
          ...(agent.todo_id ? { todoId: agent.todo_id } : {}),
          ...(taskName ? { taskName } : {}),
          ...(delegationSummary ? { delegationSummary } : {}),
          ...(delegationPrompt ? { delegationPrompt } : {}),
        },
      });
      if (!result.duplicate) written += 1;
    }
    return written;
  }

  private runEvents(conversationId: string): LegacyRunEventRow[] {
    const columns = new Set(
      (
        this.db.prepare(`PRAGMA table_info(thread_run_events)`).all() as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    );
    const optionalColumn = (name: string): string => (columns.has(name) ? name : `NULL AS ${name}`);
    return this.db
      .prepare(
        `SELECT id, thread_id, sequence, event_type, scope, role, agent_id,
                ${optionalColumn("parent_agent_id")}, ${optionalColumn("parent_tool_use_id")},
                run_attempt_id, request_id, stream_key, stream_state, message,
                metadata_json, observed_at
         FROM thread_run_events WHERE thread_id = ? ORDER BY sequence ASC, id ASC`,
      )
      .all(conversationId) as unknown as LegacyRunEventRow[];
  }

  private hasOnlyMigrationEvents(conversationId: string, prefix: string): boolean {
    const rows = this.db
      .prepare(
        `SELECT source_event_key
         FROM conversation_events_v2
         WHERE conversation_id = ?`,
      )
      .all(conversationId) as Array<{ source_event_key: string | null }>;
    return (
      rows.length > 0 &&
      rows.every(
        (row) => typeof row.source_event_key === "string" && row.source_event_key.startsWith(`${prefix}:`),
      )
    );
  }
}

/**
 * Merge the two legacy orderings without moving either source backwards.
 * Legacy run-event sequence is authoritative within that table; user
 * messages only have their recorded timestamp, so cross-source placement is
 * deterministic and intentionally documented by the stable source keys.
 */
function mergeMigrationSources(
  users: readonly LegacyUserMessageRow[],
  events: readonly LegacyRunEventRow[],
): MigrationSource[] {
  const orderedUsers = [...users].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.activity_line_id.localeCompare(right.activity_line_id),
  );
  const pairedPromptRows = legacyPromptEventRowsRepresentedByUsers(users, events);
  const orderedEvents = [...events]
    .filter((row) => !pairedPromptRows.has(row.id))
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  const sources: MigrationSource[] = [];
  let userIndex = 0;
  let eventIndex = 0;
  while (userIndex < orderedUsers.length || eventIndex < orderedEvents.length) {
    const user = orderedUsers[userIndex];
    const event = orderedEvents[eventIndex];
    if (!user) {
      sources.push({ kind: "event", row: event! });
      eventIndex += 1;
      continue;
    }
    if (!event || user.created_at <= event.observed_at) {
      sources.push({ kind: "user", row: user });
      userIndex += 1;
      continue;
    }
    sources.push({ kind: "event", row: event });
    eventIndex += 1;
  }
  return sources;
}

/**
 * The legacy prompt rows a `thread_user_messages` row already represents.
 *
 * A prompt is written twice outside V2: as a `thread.status` / `thread.user_prompt` row in
 * the event log, and as the user message the app keeps for it. V2 holds one message for a
 * prompt, so the migration has to pick one of the two records — and it has to pick the
 * same one whether the conversation was migrated from the log or written live. The live
 * path answers it already: the runtime writes the V2 message with the user message and
 * stamps `metadata.conversationV2MessageId` onto the prompt row so the mirror leaves it
 * alone. For the migration the two records are paired by the identity the runtime itself
 * leaves behind —
 *
 *  - `metadata.rewindTarget.activityLineId`, which is the user message's
 *    `activity_line_id` on every prompt row that carries it, and
 *  - the prompt's own text at the same instant (within a second), for the rows written
 *    before that field existed.
 *
 * A prompt row that matches neither is a real row of its own and keeps its message.
 * Rewinding a turn re-sends the prompt: the new row carries a new activity line, and the
 * user message table keeps the send it belongs to, so the rewind's own rows are matched by
 * the first rule even when their text is identical to an earlier prompt's.
 */
function legacyPromptEventRowsRepresentedByUsers(
  users: readonly LegacyUserMessageRow[],
  events: readonly LegacyRunEventRow[],
): Set<string> {
  const account = new Set(users.map((user) => user.activity_line_id.trim()));
  const represented = new Set<string>();
  for (const event of events) {
    if (!isLegacyPromptRow(event)) continue;
    const metadata = parseMetadata(event.metadata_json);
    const rewindTarget = metadata?.rewindTarget;
    const target =
      rewindTarget && typeof rewindTarget === "object"
        ? (rewindTarget as { activityLineId?: unknown }).activityLineId
        : undefined;
    const rewindId = typeof target === "string" ? target.trim() : "";
    if (rewindId && account.has(rewindId)) {
      represented.add(event.id);
      continue;
    }
    const observedAt = Date.parse(event.observed_at);
    const match = users.find(
      (user) =>
        user.text === event.message &&
        Number.isFinite(observedAt) &&
        Math.abs(Date.parse(user.created_at) - observedAt) <= 1_000,
    );
    if (match) represented.add(event.id);
  }
  return represented;
}

/** The live type the runtime writes on a user prompt, and the role it writes with. */
function isLegacyPromptRow(row: LegacyRunEventRow): boolean {
  const metadata = parseMetadata(row.metadata_json);
  return (
    metadata?.liveType === "thread.user_prompt" &&
    row.role === "user" &&
    row.scope !== "agent" &&
    row.event_type !== "message.delta" &&
    row.event_type !== "message.final"
  );
}

function isLegacyToolSummarySource(row: LegacyRunEventRow): boolean {
  if (
    row.event_type === "tool.started" ||
    row.event_type === "tool.completed" ||
    row.event_type === "tool.failed"
  ) {
    return true;
  }
  const metadata = parseMetadata(row.metadata_json);
  const liveType = typeof metadata?.liveType === "string" ? metadata.liveType : "";
  return (
    liveType.startsWith("tool.") ||
    liveType.startsWith("bash_approval.") ||
    liveType.startsWith("plan_approval.") ||
    liveType.startsWith("clarification.")
  );
}

function requireConversationId(value: string): string {
  const id = value.trim();
  if (!id) throw new ConversationV2Error(CONVERSATION_V2_ERROR.invalidParams, "conversationId is required.");
  return id;
}

function parseAttachments(value: string | null): unknown[] | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isLegacyOpaqueAttachmentRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const mediaType = typeof record.mediaType === "string" ? record.mediaType.trim() : "";
  const filePath = typeof record.path === "string" ? record.path.trim() : "";
  const data = typeof record.data === "string" ? record.data.trim() : "";
  return Boolean((id || mediaType) && (id || filePath || data));
}

function sanitizeLegacyOpaqueAttachment(
  value: Record<string, unknown>,
  metadata: { byteLength?: number },
): Record<string, unknown> {
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const mediaType = typeof value.mediaType === "string" ? value.mediaType.trim() : "";
  const byteLength =
    Number.isSafeInteger(value.byteLength) && Number(value.byteLength) >= 0
      ? Number(value.byteLength)
      : metadata.byteLength;
  return {
    ...(id ? { id } : {}),
    ...(mediaType ? { mediaType } : {}),
    ...(byteLength !== undefined ? { byteLength } : {}),
    legacyOpaque: true,
  };
}

function parseMetadata(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function toThreadRunEvent(row: LegacyRunEventRow): ThreadRunEvent {
  const eventType = row.event_type as ThreadRunEventType;
  const metadata = parseMetadata(row.metadata_json);
  return {
    id: row.id,
    threadId: row.thread_id,
    sequence: row.sequence,
    eventType,
    scope: row.scope === "agent" || row.scope === "both" ? row.scope : "main",
    streamState:
      row.stream_state === "streaming" ||
      row.stream_state === "placeholder" ||
      row.stream_state === "finalized"
        ? row.stream_state
        : "none",
    message: row.message,
    observedAt: row.observed_at,
    ...(row.role ? { role: row.role } : {}),
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.parent_agent_id ? { parentAgentId: row.parent_agent_id } : {}),
    ...(row.parent_tool_use_id ? { parentToolUseId: row.parent_tool_use_id } : {}),
    ...(row.run_attempt_id ? { runAttemptId: row.run_attempt_id } : {}),
    ...(row.request_id ? { requestId: row.request_id } : {}),
    ...(row.stream_key ? { streamKey: row.stream_key } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function isSupportedLegacyType(type: ThreadRunEventType): boolean {
  return (
    type === "message.delta" ||
    type === "message.final" ||
    type === "thinking.delta" ||
    type === "thinking.final" ||
    type === "run.attempt.started" ||
    type === "run.attempt.completed" ||
    type === "run.attempt.failed" ||
    type === "run.attempt.cancelled" ||
    type === "tool.started" ||
    type === "tool.completed" ||
    type === "tool.failed" ||
    // A notice the reader has to see: the adapter mirrors it as a system-channel message,
    // so it is a mapped row now (`conversation-v2-legacy-adapter.ts`).
    type === "api.error"
  );
}

function noopEvent(
  conversationId: string,
  prefix: string,
  row: LegacyRunEventRow,
  reason: string,
): ConversationEventInput {
  const key = `${prefix}:event:${row.id}:${row.sequence}:noop`;
  return {
    conversationId,
    eventId: `migration_event_${stableHash(key)}`,
    sourceEventKey: key,
    type: "noop",
    occurredAt: row.observed_at,
    payload: { reason, legacyEventType: row.event_type },
  };
}

function normalizeLegacyAttemptStatus(value: string): RunAttemptStatus | undefined {
  const status = value.trim().toLowerCase();
  if (status === "running" || status === "completed" || status === "failed") {
    return status;
  }
  if (status === "cancelled" || status === "canceled") return "cancelled";
  return undefined;
}

function parseCompletedReport(value: string | null): Partial<ConversationV2MigrationReport> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Partial<ConversationV2MigrationReport>)
      : undefined;
  } catch {
    return undefined;
  }
}

function parseMigrationCheckpoint(value: string | null | undefined, sourceCount: number): number {
  if (value === undefined || value === null || value.trim() === "") return 0;
  const checkpoint = Number(value);
  if (!Number.isSafeInteger(checkpoint) || checkpoint < 0 || checkpoint > sourceCount) {
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.migrationIncomplete,
      "Legacy conversation migration checkpoint is invalid.",
      { checkpoint: value, sourceCount },
    );
  }
  return checkpoint;
}
