import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createConversationStore } from "../src/main/conversation-store";
import { buildUsageLedgerEventKey, type UsageLedgerEvent } from "../src/main/usage-ledger";
import { buildSingleUsageLedgerEvent } from "../src/main/usage-ledger-adapters";
import type { ThreadSummary } from "../src/shared/ipc";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

async function createLegacyStore(dbPath: string) {
  return createConversationStore(dbPath, {
    freshStorageMode: "legacy_compat",
    requiredStorageMode: "legacy_compat",
  });
}

function makeThread(): ThreadSummary {
  return {
    id: "thr_usage_ledger_store",
    title: "Ledger",
    prompt: "hello",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "ok",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeEvent(): UsageLedgerEvent {
  return {
    id: "ule_evt_1",
    idempotencyKey: buildUsageLedgerEventKey({
      threadId: "thr_usage_ledger_store",
      source: "sdk",
      sourceEventId: "sdk-result:evt_1",
      usageKind: "request_final",
      modelId: "claude-test",
      agentId: "agent_coder_a",
    }),
    threadId: "thr_usage_ledger_store",
    runAttemptId: "attempt_1",
    agentId: "agent_coder_a",
    parentToolUseId: "toolu_agent_a",
    source: "sdk",
    sourceEventId: "sdk-result:evt_1",
    requestKey: "sdk-result:evt_1",
    sdkMessageId: "msg_1",
    usageKind: "request_final",
    role: "coder",
    modelId: "claude-test",
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 50,
    cacheCreationTokens: 10,
    reportedCostUsd: 0.03,
    attribution: { status: "attributed", agentId: "agent_coder_a" },
    metadata: { path: "sdk.result" },
    observedAt: "2026-01-01T00:00:01.000Z",
  };
}

function insertLegacyUsageEvent(db: DatabaseSync, event: UsageLedgerEvent): void {
  db.prepare(
    `INSERT INTO thread_usage_ledger_events (
         id, idempotency_key, thread_id, run_attempt_id, agent_id, parent_tool_use_id,
         source, source_event_id, request_key, provider_request_id, sdk_message_id,
         usage_kind, role, model_id,
         input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, reasoning_tokens,
         reported_cost_usd, attribution_json, metadata_json, observed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
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
    event.reasoningTokens ?? 0,
    event.reportedCostUsd ?? null,
    JSON.stringify(event.attribution),
    event.metadata ? JSON.stringify(event.metadata) : null,
    event.observedAt,
  );
}

function insertLegacyMetrics(
  db: DatabaseSync,
  threadId: string,
  accumulator: Record<string, unknown> | null,
  context: Record<string, unknown> | null,
): void {
  db.prepare(
    `INSERT INTO thread_metrics_snapshots (
         thread_id, accumulator_json, context_json, updated_at
       ) VALUES (?, ?, ?, ?)`,
  ).run(
    threadId,
    accumulator === null ? null : JSON.stringify(accumulator),
    context === null ? null : JSON.stringify(context),
    "2026-01-01T00:00:01.000Z",
  );
}

test.skipIf(!sqliteAvailable)("conversation store persists usage ledger records idempotently", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-usage-ledger-"));
  const store = await createConversationStore(path.join(dir, "eco.sqlite"));
  store.saveThread(makeThread());

  store.upsertRunAttempt({
    threadId: "thr_usage_ledger_store",
    attemptId: "attempt_1",
    phase: "execution",
    retryIndex: 0,
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    metadata: { reason: "test" },
  });
  store.upsertAgentInstance({
    threadId: "thr_usage_ledger_store",
    agentId: "agent_coder_a",
    role: "coder",
    kind: "subagent",
    status: "active",
    runAttemptId: "attempt_1",
    parentAgentId: "planner_session",
    parentToolUseId: "toolu_agent_a",
    todoId: "todo-1",
    startedAt: "2026-01-01T00:00:00.500Z",
    updatedAt: "2026-01-01T00:00:00.500Z",
  });

  const event = makeEvent();
  expect(store.appendUsageLedgerEvent(event)).toBe(true);
  expect(store.appendUsageLedgerEvent({ ...event, id: "ule_evt_duplicate" })).toBe(false);

  const attempts = store.listRunAttempts("thr_usage_ledger_store");
  const agents = store.listAgentInstances("thr_usage_ledger_store");
  const events = store.listUsageLedgerEvents("thr_usage_ledger_store");

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.metadata?.reason).toBe("test");
  expect(agents[0]?.parentToolUseId).toBe("toolu_agent_a");
  expect(agents[0]?.todoId).toBe("todo-1");
  expect(events).toHaveLength(1);
  expect(events[0]?.id).toBe("ule_evt_1");
  expect(events[0]?.attribution).toEqual({ status: "attributed", agentId: "agent_coder_a" });
  expect(events[0]?.metadata?.path).toBe("sdk.result");
});

test.skipIf(!sqliteAvailable)("repairs only uniquely provable V2 ledger agent attribution", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-usage-ledger-attribution-"));
  const store = await createConversationStore(path.join(dir, "eco.sqlite"));
  const threadId = "thr_usage_ledger_store";
  store.saveThread(makeThread());
  store.upsertRunAttempt({
    threadId,
    attemptId: "attempt_unique",
    phase: "execution",
    retryIndex: 0,
    status: "completed",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:02.000Z",
  });
  store.upsertAgentInstance({
    threadId,
    agentId: "agent_unique",
    role: "coder",
    kind: "subagent",
    status: "stopped",
    runAttemptId: "attempt_unique",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:02.000Z",
    updatedAt: "2026-01-01T00:00:02.000Z",
  });
  store.appendUsageLedgerEvent(
    buildSingleUsageLedgerEvent({
      threadId,
      role: "coder",
      source: "pi",
      sourceEventId: "missing-agent-unique",
      runAttemptId: "attempt_unique",
      usage: {
        modelId: "test-model",
        inputTokens: 3,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    }),
  );

  store.appendUsageLedgerEvent(
    buildSingleUsageLedgerEvent({
      threadId,
      role: "coder",
      source: "pi",
      sourceEventId: "missing-agent-parent-conflict",
      runAttemptId: "attempt_unique",
      parentToolUseId: "toolu_not_in_registry",
      usage: {
        modelId: "test-model",
        inputTokens: 7,
        outputTokens: 6,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    }),
  );

  store.upsertRunAttempt({
    threadId,
    attemptId: "attempt_parent_linked",
    phase: "execution",
    retryIndex: 0,
    status: "completed",
    startedAt: "2026-01-01T00:00:06.000Z",
    endedAt: "2026-01-01T00:00:08.000Z",
  });
  for (const [agentId, parentToolUseId] of [
    ["agent_parent_a", "toolu_parent_a"],
    ["agent_parent_b", "toolu_parent_b"],
  ] as const) {
    store.upsertAgentInstance({
      threadId,
      agentId,
      role: "coder",
      kind: "subagent",
      status: "stopped",
      runAttemptId: "attempt_parent_linked",
      parentToolUseId,
      startedAt: "2026-01-01T00:00:06.000Z",
      endedAt: "2026-01-01T00:00:08.000Z",
      updatedAt: "2026-01-01T00:00:08.000Z",
    });
  }
  store.appendUsageLedgerEvent(
    buildSingleUsageLedgerEvent({
      threadId,
      role: "coder",
      source: "pi",
      sourceEventId: "missing-agent-parent-linked",
      runAttemptId: "attempt_parent_linked",
      parentToolUseId: "toolu_parent_b",
      usage: {
        modelId: "test-model",
        inputTokens: 6,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    }),
  );

  store.upsertRunAttempt({
    threadId,
    attemptId: "attempt_ambiguous",
    phase: "execution",
    retryIndex: 0,
    status: "completed",
    startedAt: "2026-01-01T00:00:03.000Z",
    endedAt: "2026-01-01T00:00:05.000Z",
  });
  for (const agentId of ["agent_ambiguous_a", "agent_ambiguous_b"]) {
    store.upsertAgentInstance({
      threadId,
      agentId,
      role: "coder",
      kind: "subagent",
      status: "stopped",
      runAttemptId: "attempt_ambiguous",
      startedAt: "2026-01-01T00:00:03.000Z",
      endedAt: "2026-01-01T00:00:05.000Z",
      updatedAt: "2026-01-01T00:00:05.000Z",
    });
  }
  const ambiguous = buildSingleUsageLedgerEvent({
    threadId,
    role: "coder",
    source: "pi",
    sourceEventId: "missing-agent-ambiguous",
    runAttemptId: "attempt_ambiguous",
    usage: {
      modelId: "test-model",
      inputTokens: 5,
      outputTokens: 4,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
  });
  store.appendUsageLedgerEvent(ambiguous);

  expect(store.reconcileAllConversationV2UsageLedgerAttribution()).toMatchObject({
    conversations: 1,
    scanned: 4,
    attributed: 2,
    ambiguous: 1,
  });
  const events = store.listUsageLedgerEvents(threadId);
  expect(events.find((event) => event.sourceEventId === "missing-agent-unique")).toMatchObject({
    agentId: "agent_unique",
    attribution: { status: "attributed", agentId: "agent_unique" },
  });
  expect(events.find((event) => event.sourceEventId === "missing-agent-parent-linked")).toMatchObject({
    agentId: "agent_parent_b",
    attribution: { status: "attributed", agentId: "agent_parent_b" },
  });
  const parentConflict = events.find((event) => event.sourceEventId === "missing-agent-parent-conflict");
  expect(parentConflict).toMatchObject({
    attribution: { status: "unattributed", reason: "agent_id_missing" },
  });
  expect(parentConflict).not.toHaveProperty("agentId");
  expect(events.find((event) => event.sourceEventId === "missing-agent-ambiguous")).toMatchObject({
    attribution: { status: "unattributed", reason: "agent_id_missing" },
  });
});

test.skipIf(!sqliteAvailable)(
  "migrates legacy usage rows into V2 and serves them through projection extras",
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-usage-ledger-v2-cutover-"));
    const dbPath = path.join(dir, "eco.sqlite");
    const store = await createLegacyStore(dbPath);
    store.saveThread(makeThread());

    const event = makeEvent();
    const legacyDb = new DatabaseSync(dbPath);
    insertLegacyUsageEvent(legacyDb, event);
    expect(
      legacyDb
        .prepare(`SELECT COUNT(*) AS count FROM thread_usage_ledger_events WHERE thread_id = ?`)
        .get(event.threadId),
    ).toEqual({ count: 1 });
    legacyDb.close();

    store.switchToV2OnlyStorage();

    const cutoverDb = new DatabaseSync(dbPath);
    expect(
      cutoverDb
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_usage_ledger_events'`,
        )
        .get(),
    ).toBeUndefined();
    expect(
      cutoverDb
        .prepare(
          `SELECT COUNT(*) AS count FROM conversation_usage_ledger_events_v2 WHERE conversation_id = ?`,
        )
        .get(event.threadId),
    ).toEqual({ count: 1 });
    cutoverDb.close();

    expect(store.listUsageLedgerEvents(event.threadId)).toEqual([event]);
    const extras = store.getConversationV2ProjectionExtras(event.threadId);
    expect(extras?.ledgerEvents).toEqual([
      expect.objectContaining({
        id: event.id,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        source: event.source,
        usageKind: event.usageKind,
      }),
    ]);

    // Recreate a stale V1 table after the cutover to exercise the V2-only
    // startup repair path that older builds could leave behind.
    const staleEvent = {
      ...event,
      id: "ule_evt_stale",
      idempotencyKey: `${event.idempotencyKey}:stale`,
      sourceEventId: "sdk-result:evt_stale",
      requestKey: "sdk-result:evt_stale",
      observedAt: "2026-01-01T00:00:02.000Z",
    };
    const staleDb = new DatabaseSync(dbPath);
    staleDb.exec(`
    CREATE TABLE thread_usage_ledger_events (
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
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      reported_cost_usd REAL,
      attribution_json TEXT NOT NULL,
      metadata_json TEXT,
      observed_at TEXT NOT NULL
    );
  `);
    insertLegacyUsageEvent(staleDb, staleEvent);
    staleDb.close();

    // A V2-only process must not merge a table that appears after cutover
    // into a live read. Reopen is the explicit maintenance boundary that may
    // import and retire such a leftover table.
    expect(store.listUsageLedgerEvents(event.threadId)).toEqual([event]);

    const reopened = await createConversationStore(dbPath);
    expect(reopened.getConversationStorageMode()).toBe("v2_only");
    expect(reopened.listUsageLedgerEvents(event.threadId)).toEqual([event, staleEvent]);
    const repairedDb = new DatabaseSync(dbPath);
    expect(
      repairedDb
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_usage_ledger_events'`,
        )
        .get(),
    ).toBeUndefined();
    expect(
      repairedDb
        .prepare(
          `SELECT COUNT(*) AS count FROM conversation_usage_ledger_events_v2 WHERE conversation_id = ?`,
        )
        .get(event.threadId),
    ).toEqual({ count: 2 });
    repairedDb.close();
  },
);

test.skipIf(!sqliteAvailable)(
  "migrates legacy metrics snapshots into V2 and retires the V1 table",
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-metrics-v2-cutover-"));
    const dbPath = path.join(dir, "eco.sqlite");
    const thread = { ...makeThread(), id: "thr_metrics_v2_cutover" };
    const store = await createLegacyStore(dbPath);
    store.saveThread(thread);

    const accumulator = { total: { inputTokens: 11, outputTokens: 7 }, byRole: {} };
    const context = { occupied: 123, limit: 1000, occupancyPct: 12.3, limitsResolved: true, segments: [] };
    const legacyDb = new DatabaseSync(dbPath);
    insertLegacyMetrics(legacyDb, thread.id, accumulator, context);
    legacyDb.close();

    store.switchToV2OnlyStorage();

    expect(store.getConversationStorageMode()).toBe("v2_only");
    store.saveThreadMetrics(thread.id, {
      accumulator: JSON.parse(JSON.stringify({ total: { inputTokens: 999 }, source: "stale-runtime" })),
      context,
    });
    expect(store.getThreadMetrics(thread.id)).toEqual({
      threadId: thread.id,
      context,
      updatedAt: expect.any(String),
    });
    expect(store.listThreadMetrics()).toEqual([expect.objectContaining({ threadId: thread.id, context })]);

    const cutoverDb = new DatabaseSync(dbPath);
    expect(
      cutoverDb
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_metrics_snapshots'`)
        .get(),
    ).toBeUndefined();
    const projection = cutoverDb
      .prepare(`SELECT snapshot_json FROM conversation_projection_snapshots_v2 WHERE conversation_id = ?`)
      .get(thread.id) as { snapshot_json: string };
    expect(JSON.parse(projection.snapshot_json)).toEqual(expect.objectContaining({ context }));
    expect(JSON.parse(projection.snapshot_json)).not.toHaveProperty("usageState");
    cutoverDb.close();

    // A stale table left by an older cutover is migrated and removed on V2-only reopen.
    const staleDb = new DatabaseSync(dbPath);
    staleDb.exec(`
    CREATE TABLE thread_metrics_snapshots (
      thread_id TEXT PRIMARY KEY,
      accumulator_json TEXT,
      context_json TEXT,
      updated_at TEXT NOT NULL
    );
  `);
    insertLegacyMetrics(staleDb, thread.id, { stale: true }, null);
    staleDb.close();

    const reopened = await createConversationStore(dbPath);
    expect(reopened.getConversationStorageMode()).toBe("v2_only");
    // Existing V2 fields remain authoritative when a stale legacy row reappears.
    expect(reopened.getThreadMetrics(thread.id)).toEqual({
      threadId: thread.id,
      context,
      updatedAt: expect.any(String),
    });
    const repairedDb = new DatabaseSync(dbPath);
    expect(
      repairedDb
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_metrics_snapshots'`)
        .get(),
    ).toBeUndefined();
    repairedDb.close();
  },
);

test.skipIf(!sqliteAvailable)("refuses malformed legacy metrics during the V2-only cutover", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-metrics-v2-corrupt-"));
  const dbPath = path.join(dir, "eco.sqlite");
  const thread = { ...makeThread(), id: "thr_metrics_v2_corrupt" };
  const store = await createLegacyStore(dbPath);
  store.saveThread(thread);

  const legacyDb = new DatabaseSync(dbPath);
  legacyDb
    .prepare(
      `INSERT INTO thread_metrics_snapshots (
         thread_id, accumulator_json, context_json, updated_at
       ) VALUES (?, ?, ?, ?)`,
    )
    .run(thread.id, "{broken", null, "2026-01-01T00:00:01.000Z");
  legacyDb.close();

  expect(() => store.switchToV2OnlyStorage()).toThrow("Legacy thread metrics accumulator JSON is invalid");
  expect(store.getConversationStorageMode()).toBe("legacy_compat");
  const unchangedDb = new DatabaseSync(dbPath);
  expect(
    unchangedDb
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_metrics_snapshots'`)
      .get(),
  ).toEqual({ name: "thread_metrics_snapshots" });
  unchangedDb.close();
});

test.skipIf(!sqliteAvailable)(
  "refuses malformed migrated usage state during the V2-only cutover",
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-metrics-v2-snapshot-corrupt-"));
    const dbPath = path.join(dir, "eco.sqlite");
    const thread = { ...makeThread(), id: "thr_metrics_v2_snapshot_corrupt" };
    const store = await createLegacyStore(dbPath);
    store.saveThread(thread);
    store.conversationV2().saveProjectionSnapshot(thread.id, {
      requestSpans: [],
      usageState: [],
    });

    expect(() => store.switchToV2OnlyStorage()).toThrow("Conversation V2 usage state is invalid");
    expect(store.getConversationStorageMode()).toBe("legacy_compat");
    expect(store.conversationV2().getProjectionSnapshot(thread.id)).toEqual({
      requestSpans: [],
      usageState: [],
    });
  },
);
