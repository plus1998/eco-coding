import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  normalizeRunAttemptPhase,
  type RunAttemptRecord,
  type AgentInstanceRecord,
} from "../../src/main/usage-ledger";
import { ConversationStore } from "../../src/main/conversation-store";
import { ConversationV2LegacyMigrator } from "../../src/main/conversation-v2-legacy-migration";
import { ConversationV2Store } from "../../src/main/conversation-v2-store";
import { buildThreadRunProjection } from "../../src/main/conversation-v2-runtime-projection";
import {
  buildConversationV2OnlyProjection,
  mergeConversationV2IntoProjection,
} from "../../src/renderer/ActivityLogView";
import type { ThreadRunProjectionSnapshot } from "../../src/shared/ipc";
import {
  installConversationV2Bootstrap,
  mergeConversationV2OlderPage,
  mergeConversationV2ToolPage,
} from "../../src/renderer/conversation-v2-renderer-state";
import { type FeedShape, feedShape } from "./feed-shape";

/**
 * The real-row corpus, loaded and migrated in one place.
 *
 * The parity test and the cross-end fixture generator both need "these rows, in a fresh
 * database, through the production migrator": two copies of that setup would let the two
 * nets disagree about what they are comparing, which is how a harness stops testing the
 * thing it names.
 *
 * The corpus itself is described by `scripts/feed-corpus-fixture.mjs`: real event types,
 * scopes, roles, owners, stream identities, tool names, metadata keys and times, with free
 * text replaced by content-addressed placeholders so a chat log does not have to live in the
 * repository.
 */
export interface CorpusRow {
  [column: string]: unknown;
}

export interface CorpusConversation {
  conversationId: string;
  thread: CorpusRow;
  attempts: CorpusRow[];
  agents: CorpusRow[];
  events: CorpusRow[];
  users: CorpusRow[];
}

export interface Corpus {
  conversations: CorpusConversation[];
}

export const NOW_MS = Date.parse("2026-09-17T00:00:00.000Z");
/** A page budget wide enough that paging never truncates the comparison. */
export const WHOLE_CONVERSATION_MAX_BYTES = 256 * 1024 * 1024;
/** The page size the desktop client bootstraps with (`App.tsx`). */
export const BOOTSTRAP_PAGE_SIZE = 60;
/** The page size the desktop client follows history with (`App.tsx`). */
export const HISTORY_PAGE_SIZE = 100;

/**
 * Keeps the historical parity baseline explicit without shipping the former
 * V1 hydration helper in the production renderer. The current renderer reads
 * these fields from the V2 projection extras snapshot instead.
 */
function withCorpusProjectionExtras(
  projection: ThreadRunProjectionSnapshot,
  legacy?: ThreadRunProjectionSnapshot,
): ThreadRunProjectionSnapshot {
  if (!legacy) return projection;
  return {
    ...projection,
    requestSpans: legacy.requestSpans,
    ...(legacy.billing ? { billing: legacy.billing } : {}),
    ...(legacy.context ? { context: legacy.context } : {}),
    ...(legacy.subagentTimings ? { subagentTimings: legacy.subagentTimings } : {}),
  };
}

export function loadCorpus(): Corpus {
  return JSON.parse(
    readFileSync(new URL("../fixtures/feed-parity/conversation-corpus.json", import.meta.url), "utf8"),
  ) as Corpus;
}

export function insertRows(db: DatabaseSync, table: string, rows: CorpusRow[]): void {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]!);
  const statement = db.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  );
  for (const row of rows) {
    statement.run(...columns.map((column) => (row[column] ?? null) as never));
  }
}

function stripV2Marker(metadataJson: unknown): string | null {
  if (typeof metadataJson !== "string" || !metadataJson.includes("conversationV2MessageId")) {
    return (metadataJson as string | null) ?? null;
  }
  const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
  delete parsed.conversationV2MessageId;
  return JSON.stringify(parsed);
}

/**
 * A fresh legacy database holding exactly one corpus conversation, then the production
 * migrator run over it: the cold state the migration path is defined for.
 */
export function migrateCorpusConversation(conversation: CorpusConversation) {
  const db = new DatabaseSync(":memory:");
  const legacy = new ConversationStore(db);
  legacy.initialize();
  insertRows(db, "threads", [conversation.thread]);
  insertRows(db, "thread_run_attempts", conversation.attempts);
  insertRows(db, "thread_agent_instances", conversation.agents);
  // Rows copied from a live database carry the identity of the V2 message the runtime
  // already recorded there. A cold migration has no such message, and the marker would
  // tell the mirror to leave the row alone, so it is removed: it describes the live
  // database this corpus came from, not the legacy row itself.
  insertRows(
    db,
    "thread_run_events",
    conversation.events.map((row) => ({
      ...row,
      metadata_json: stripV2Marker(row.metadata_json),
    })),
  );
  insertRows(db, "thread_user_messages", conversation.users);

  const v2 = new ConversationV2Store(db);
  v2.initialize();
  new ConversationV2LegacyMigrator(db, v2).migrate(conversation.conversationId);
  return { legacy, v2 };
}

/** The migrated conversation as the runtime hands it to a client: the V2 read models. */
export function corpusBootstrap(conversation: CorpusConversation) {
  const { legacy, v2 } = migrateCorpusConversation(conversation);
  // The client's read, page by page: `bootstrap()` answers with the newest window and a
  // cursor, and the rest of the history arrives through `messagesPage()`. Comparing one
  // window against the legacy projection's full history reported every older row as
  // "missing from V2" — paging is the client's job, and this mirrors it (the same sizes the
  // desktop uses) so the comparison is about what survives the migration, not about which
  // window was asked for.
  const bootstrap = v2.bootstrap(
    conversation.conversationId,
    BOOTSTRAP_PAGE_SIZE,
    WHOLE_CONVERSATION_MAX_BYTES,
  );
  let session = installConversationV2Bootstrap(bootstrap);
  const seenCursors = new Set<string>();
  while (session.hasOlder) {
    const cursor = session.olderCursor;
    if (!cursor || seenCursors.has(cursor)) {
      throw new Error("corpus history paging repeated its cursor");
    }
    seenCursors.add(cursor);
    session = mergeConversationV2OlderPage(
      session,
      v2.messagesPage(conversation.conversationId, cursor, HISTORY_PAGE_SIZE, WHOLE_CONVERSATION_MAX_BYTES),
    );
  }
  for (const runId of session.runs.keys()) {
    let cursor: string | undefined;
    const seenToolCursors = new Set<string>();
    while (true) {
      const page = v2.toolsPage(
        conversation.conversationId,
        runId,
        cursor,
        HISTORY_PAGE_SIZE,
        WHOLE_CONVERSATION_MAX_BYTES,
      );
      session = mergeConversationV2ToolPage(session, page);
      if (!page.hasMore) break;
      const nextCursor = page.nextCursor;
      if (!nextCursor || seenToolCursors.has(nextCursor)) {
        throw new Error("corpus tool paging repeated its cursor");
      }
      seenToolCursors.add(nextCursor);
      cursor = nextCursor;
    }
  }
  return { legacy, v2, bootstrap, session };
}

export function legacyProjectionFor(
  conversation: CorpusConversation,
  legacy: ConversationStore,
): ReturnType<typeof buildThreadRunProjection> {
  return buildThreadRunProjection({
    threadId: conversation.conversationId,
    status: "completed",
    // The old side must read the fixed source rows, never a store API now backed by V2.
    attempts: conversation.attempts.map(
      (row): RunAttemptRecord => ({
        threadId: String(row.thread_id),
        attemptId: String(row.attempt_id),
        phase: normalizeRunAttemptPhase(row.phase)!,
        retryIndex: Number(row.retry_index),
        status: row.status as RunAttemptRecord["status"],
        startedAt: String(row.started_at),
        ...(row.ended_at ? { endedAt: String(row.ended_at) } : {}),
        ...(row.metadata_json ? { metadata: JSON.parse(String(row.metadata_json)) } : {}),
      }),
    ),
    agents: conversation.agents.map(
      (row): AgentInstanceRecord => ({
        threadId: String(row.thread_id),
        agentId: String(row.agent_id),
        role: row.role as AgentInstanceRecord["role"],
        kind: row.kind as AgentInstanceRecord["kind"],
        status: row.status as AgentInstanceRecord["status"],
        startedAt: String(row.started_at),
        updatedAt: String(row.updated_at),
        ...(row.ended_at ? { endedAt: String(row.ended_at) } : {}),
        ...(row.run_attempt_id ? { runAttemptId: String(row.run_attempt_id) } : {}),
        ...(row.parent_agent_id ? { parentAgentId: String(row.parent_agent_id) } : {}),
        ...(row.parent_tool_use_id ? { parentToolUseId: String(row.parent_tool_use_id) } : {}),
        ...(row.mission_key ? { missionKey: String(row.mission_key) } : {}),
        ...(row.todo_id ? { todoId: String(row.todo_id) } : {}),
        ...(row.metadata_json ? { metadata: JSON.parse(String(row.metadata_json)) } : {}),
      }),
    ),
    events: legacy.listThreadRunEvents(conversation.conversationId),
    nowMs: NOW_MS,
  });
}

/**
 * The same conversation through both chains, as the Feed's rendered shape.
 *
 * Both sides are the **production combination**, not a chain's raw output (the same rule as
 * `feed-regression-test-plan.md` 5.2.c): the old side is what the runtime rendered before the
 * read-side switch (legacy projection with the V2 rows merged in), the new side is what it
 * renders now (V2 read models, with the historical extras copied in by the test-only corpus
 * helper). Comparing an un-hydrated V2 projection would quietly test a
 * combination nothing runs — and would miss the hydration extras steering the display
 * timeline, which is exactly how a row ends up drawn on one side and not the other.
 */
export function corpusChainShapes(conversation: CorpusConversation): {
  old: FeedShape;
  current: FeedShape;
  /**
   * The prompts the read model holds, so a comparison can ask whether the Feed drew each of
   * them once — two prompts that say the same thing are two prompts, and neither the row's
   * text nor its time is its identity.
   */
  userMessageIds: string[];
} {
  const { legacy, session } = corpusBootstrap(conversation);
  const legacyProjection = legacyProjectionFor(conversation, legacy);
  const thread = {
    createdAt: String(conversation.thread.created_at),
    status: "completed",
  };
  return {
    old: feedShape(mergeConversationV2IntoProjection(legacyProjection, session)),
    current: feedShape(
      withCorpusProjectionExtras(buildConversationV2OnlyProjection(session, thread), legacyProjection),
    ),
    userMessageIds: [...session.messages.values()]
      .filter((message) => message.role === "user")
      .map((message) => message.body),
  };
}
