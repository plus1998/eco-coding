import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConversationStore } from "../src/main/conversation-store";
import type { ModelSettingsSnapshot, ThreadSummary } from "../src/shared/ipc";
import { buildThreadRuntimeConfigFromDefaults } from "../src/shared/thread-runtime-config";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

const settings: ModelSettingsSnapshot = {
  providers: [],
  agentTemplates: [],
  orchestrationProfiles: [],
  routeProfiles: [
    {
      id: "profile-a",
      name: "方案 A",
      routes: [
        { role: "planner", providerId: "p1", modelId: "m1" },
        { role: "explore", providerId: "p1", modelId: "m1" },
        { role: "architect", providerId: "p1", modelId: "m1" },
        { role: "coder", providerId: "p1", modelId: "m1" },
        { role: "reviewer", providerId: "p1", modelId: "m1" },
        { role: "tester", providerId: "p1", modelId: "m1" },
      ],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    },
  ],
};

test.skipIf(!sqliteAvailable)("migrates old activity table before sdk user message index", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-activity-migration-"));
  const dbPath = path.join(dir, "eco-coding.sqlite");
  const sqlite = await import("node:sqlite");
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE thread_activity (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      message TEXT NOT NULL,
      stream INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );
  `);
  db.close();

  await createConversationStore(dbPath);

  const migrated = new sqlite.DatabaseSync(dbPath);
  const columns = migrated.prepare(`PRAGMA table_info(thread_activity)`).all() as Array<{ name: string }>;
  expect(columns.map((column) => column.name)).toContain("sdk_user_message_id");
  const indexes = migrated.prepare(`PRAGMA index_list(thread_activity)`).all() as Array<{ name: string }>;
  expect(indexes.map((index) => index.name)).toContain("idx_thread_activity_thread_sdk_user_message");
  migrated.close();
});

test.skipIf(!sqliteAvailable)("persists and loads thread runtime config", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-conversation-runtime-"));
  const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
  const runtimeConfig = buildThreadRuntimeConfigFromDefaults({
    settings,
    workflowDefaults: { sessionMode: "plan" },
  });

  const thread: ThreadSummary = {
    id: "thr_test",
    title: "Test",
    prompt: "hello",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "ok",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runtimeConfig,
  };

  store.saveThread(thread);
  const loaded = store.getThread("thr_test");
  expect(loaded?.runtimeConfig).toEqual(runtimeConfig);

  store.saveThreadRuntimeConfig("thr_test", {
    ...runtimeConfig,
    sessionMode: "agent",
    routeProfileId: "profile-a",
  });
  expect(store.getThread("thr_test")?.runtimeConfig?.sessionMode).toBe("agent");
});

test.skipIf(!sqliteAvailable)("listThreads keeps creation order when updated_at changes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-thread-order-"));
  const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));

  const older: ThreadSummary = {
    id: "thr_old",
    title: "Older",
    prompt: "one",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "ok",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
  const newer: ThreadSummary = {
    id: "thr_new",
    title: "Newer",
    prompt: "two",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "ok",
    createdAt: "2024-06-01T00:00:00.000Z",
    updatedAt: "2024-06-01T00:00:00.000Z",
  };

  store.saveThread(older);
  store.saveThread(newer);
  store.saveThread({ ...older, updatedAt: "2025-01-01T00:00:00.000Z" });

  expect(store.listThreads().map((thread) => thread.id)).toEqual(["thr_new", "thr_old"]);
});

test.skipIf(!sqliteAvailable)("saves and lists compaction archives", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-compaction-archive-"));
  const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
  const thread: ThreadSummary = {
    id: "thr_compact",
    title: "Compact",
    prompt: "hello",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "ok",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.saveThread(thread);

  store.saveCompactionArchive("thr_compact", {
    trigger: "auto",
    sessionId: "sess_1",
    payload: { activityLineCount: 2, activityLines: [{ id: "a1", role: "system", message: "hi" }] },
  });

  const archives = store.listCompactionArchives("thr_compact");
  expect(archives).toHaveLength(1);
  expect(archives[0]?.trigger).toBe("auto");
  expect(archives[0]?.sessionId).toBe("sess_1");
  expect(archives[0]?.payload.activityLineCount).toBe(2);
});

test.skipIf(!sqliteAvailable)("saves, reads, and clears compact handoff", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-compact-handoff-"));
  const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
  const thread: ThreadSummary = {
    id: "thr_handoff",
    title: "Handoff",
    prompt: "hello",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "ok",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.saveThread(thread);

  store.saveCompactHandoff("thr_handoff", {
    summary: "summary text",
    recentUserMessages: ["recent-1", "recent-2"],
    postTokensEstimate: 1234,
  });

  const handoff = store.getCompactHandoff("thr_handoff");
  expect(handoff?.summary).toBe("summary text");
  expect(handoff?.recentUserMessages).toEqual(["recent-1", "recent-2"]);
  expect(handoff?.postTokensEstimate).toBe(1234);

  store.clearCompactHandoff("thr_handoff");
  expect(store.getCompactHandoff("thr_handoff")).toBeUndefined();
});

test.skipIf(!sqliteAvailable)("deleteThread removes thread-owned records", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-delete-thread-"));
  const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
  const thread: ThreadSummary = {
    id: "thr_delete",
    title: "Delete",
    prompt: "hello",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "ok",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
  store.saveThread(thread);
  store.saveSdkSession(thread.id, "session_123", "/tmp/project");
  store.appendActivityLine(thread.id, { role: "system", message: "hello" });
  store.saveCompactionArchive(thread.id, { trigger: "auto", payload: { activityLineCount: 1 } });
  store.appendThreadRunEvent({
    id: "tre_delete",
    threadId: thread.id,
    eventType: "thread.status",
    scope: "main",
    streamState: "none",
    message: "status",
    observedAt: "2024-01-01T00:00:01.000Z",
  });

  expect(store.deleteThread(thread.id)).toBe(true);
  expect(store.getThread(thread.id)).toBeUndefined();
  expect(store.listActivityLines(thread.id)).toEqual([]);
  expect(store.listCompactionArchives(thread.id)).toEqual([]);
  expect(store.listThreadRunEvents(thread.id)).toEqual([]);
  expect(store.deleteThread(thread.id)).toBe(false);
});

test.skipIf(!sqliteAvailable)("rewindThreadToActivityLine prunes target and later thread state", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-rewind-thread-"));
  const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
  const thread: ThreadSummary = {
    id: "thr_rewind",
    title: "Rewind",
    prompt: "first prompt",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "ok",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
  store.saveThread(thread);

  const first = store.appendActivityLine(thread.id, { id: "act_first", role: "user", message: "first" });
  store.appendThreadRunEvent({
    id: "evt_first",
    threadId: thread.id,
    sequence: 1,
    eventType: "thread.status",
    scope: "main",
    role: "user",
    streamKey: first.id,
    streamState: "none",
    message: "first",
    observedAt: "2024-01-01T00:00:01.000Z",
  });
  expect(store.bindLatestUserActivityToSdkMessage(thread.id, "user-first")?.rewindTarget).toEqual({
    activityLineId: "act_first",
    userMessageId: "user-first",
  });

  await new Promise((resolve) => setTimeout(resolve, 2));

  const target = store.appendActivityLine(thread.id, { id: "act_target", role: "user", message: "target" });
  store.appendThreadRunEvent({
    id: "evt_target",
    threadId: thread.id,
    sequence: 2,
    eventType: "thread.status",
    scope: "main",
    role: "user",
    streamKey: target.id,
    streamState: "none",
    message: "target",
    observedAt: "2024-01-01T00:00:02.000Z",
  });
  store.bindLatestUserActivityToSdkMessage(thread.id, "user-target");
  store.appendActivityLine(thread.id, { id: "act_future", role: "planner", message: "future" });
  store.appendThreadRunEvent({
    id: "evt_future",
    threadId: thread.id,
    sequence: 3,
    eventType: "thread.status",
    scope: "main",
    streamState: "none",
    message: "future",
    observedAt: "2024-01-01T00:00:03.000Z",
  });
  store.savePendingPlan({
    threadId: thread.id,
    userPrompt: "target",
    analysis: "analysis",
    plan: "plan",
    workspacePath: "/tmp/project",
    worktreePath: "/tmp/project",
    routesJson: "[]",
  });
  store.replaceCoderTodos(thread.id, [
    {
      id: "todo_future",
      threadId: thread.id,
      title: "future",
      detail: "",
      status: "pending",
      position: 0,
      updatedAt: new Date().toISOString(),
    },
  ]);
  store.saveThreadMetrics(thread.id, {
    context: { occupied: 1, limit: 10, occupancyPct: 10, limitsResolved: true, segments: [] },
  });
  store.saveAppliedDiff(thread.id, "/tmp/project", "diff --git a/a b/a", ["a"]);
  store.saveCompactionArchive(thread.id, { trigger: "auto", payload: { activityLineCount: 3 } });
  store.upsertRunAttempt({
    threadId: thread.id,
    attemptId: "attempt_future",
    phase: "execution",
    retryIndex: 0,
    status: "running",
    startedAt: new Date().toISOString(),
  });
  store.upsertAgentInstance({
    threadId: thread.id,
    agentId: "agent_future",
    role: "coder",
    kind: "subagent",
    status: "active",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  store.appendUsageLedgerEvent({
    id: "usage_future",
    idempotencyKey: "usage_future",
    threadId: thread.id,
    source: "sdk",
    sourceEventId: "evt_usage_future",
    usageKind: "request_final",
    role: "planner",
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    observedAt: new Date().toISOString(),
    attribution: { status: "unattributed", reason: "test" },
  });
  store.upsertSubagentSessionActive({
    threadId: thread.id,
    role: "coder",
    agentId: "subagent_future",
    phase: "execution",
  });
  store.upsertSubagentMetrics(thread.id, {
    agentId: "subagent_future",
    role: "coder",
    status: "active",
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    contextOccupied: 2,
    contextLimit: 10,
    ecoCostUsd: 0,
    ecoCostBreakdown: { inputUsd: 0, outputUsd: 0, cacheReadUsd: 0, cacheCreationUsd: 0, totalUsd: 0 },
  });

  const summary = store.rewindThreadToActivityLine(thread.id, target.id);

  expect(summary.activityLineId).toBe("act_target");
  expect(summary.userMessageId).toBe("user-target");
  expect(store.listActivityLines(thread.id).map((line) => line.id)).toEqual(["act_first"]);
  expect(store.listActivityLines(thread.id)[0]?.rewindTarget).toEqual({
    activityLineId: "act_first",
    userMessageId: "user-first",
  });
  expect(store.listThreadRunEvents(thread.id).map((event) => event.id)).toEqual(["evt_first"]);
  expect(store.listFileCheckpoints(thread.id).map((checkpoint) => checkpoint.userMessageId)).toEqual([
    "user-first",
  ]);
  expect(store.getPendingPlan(thread.id)).toBeUndefined();
  expect(store.listCoderTodos(thread.id)).toEqual([]);
  expect(store.getThreadMetrics(thread.id)).toBeUndefined();
  expect(store.getAppliedDiff(thread.id)).toBeUndefined();
  expect(store.listCompactionArchives(thread.id)).toEqual([]);
  expect(store.listRunAttempts(thread.id)).toEqual([]);
  expect(store.listAgentInstances(thread.id)).toEqual([]);
  expect(store.listUsageLedgerEvents(thread.id)).toEqual([]);
  expect(store.listSubagentSessions(thread.id)).toEqual([]);
  expect(store.listSubagentMetrics(thread.id)).toEqual([]);
});

test.skipIf(!sqliteAvailable)(
  "rewindThreadToActivityLine supports SDK-derived virtual activity ids",
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-rewind-sdk-thread-"));
    const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
    const thread: ThreadSummary = {
      id: "thr_rewind_sdk",
      title: "Rewind SDK",
      prompt: "first prompt",
      workspacePath: "/tmp/project",
      status: "idle",
      message: "ok",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    store.saveThread(thread);

    store.appendThreadRunEvent({
      id: "evt_first",
      threadId: thread.id,
      sequence: 1,
      eventType: "thread.status",
      scope: "main",
      role: "user",
      streamState: "none",
      message: "first",
      observedAt: "2024-01-01T00:00:01.000Z",
    });
    expect(store.bindLatestUserRunEventToSdkMessage(thread.id, "user-first")?.rewindTarget).toEqual({
      activityLineId: "sdk:user-first",
      userMessageId: "user-first",
    });

    store.appendThreadRunEvent({
      id: "evt_target",
      threadId: thread.id,
      sequence: 2,
      eventType: "thread.status",
      scope: "main",
      role: "user",
      streamState: "none",
      message: "target",
      observedAt: "2999-01-01T00:00:02.000Z",
    });
    store.bindLatestUserRunEventToSdkMessage(thread.id, "user-target");
    store.appendThreadRunEvent({
      id: "evt_future",
      threadId: thread.id,
      sequence: 3,
      eventType: "thread.status",
      scope: "main",
      streamState: "none",
      message: "future",
      observedAt: "3000-01-01T00:00:03.000Z",
    });

    const summary = store.rewindThreadToActivityLine(thread.id, "sdk:user-target");

    expect(summary).toMatchObject({
      activityLineId: "sdk:user-target",
      userMessageId: "user-target",
      cutoffRunSequence: 2,
      removedActivityCount: 0,
      removedRunEventCount: 2,
    });
    expect(store.listThreadRunEvents(thread.id).map((event) => event.id)).toEqual(["evt_first"]);
    expect(store.listThreadRunEvents(thread.id)[0]?.streamKey).toBe("sdk:user-first");
    expect(store.listFileCheckpoints(thread.id).map((checkpoint) => checkpoint.userMessageId)).toEqual([
      "user-first",
    ]);
    expect(store.listActivityLines(thread.id)).toEqual([]);
  },
);

test.skipIf(!sqliteAvailable)(
  "rekeys thread run events when provider request id replaces local placeholder",
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-run-event-rekey-"));
    const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
    const thread: ThreadSummary = {
      id: "thr_rekey",
      title: "Rekey",
      prompt: "hello",
      workspacePath: "/tmp/project",
      status: "running",
      message: "ok",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.saveThread(thread);

    store.appendThreadRunEvent({
      id: "evt_start",
      threadId: thread.id,
      eventType: "request.started",
      scope: "main",
      streamState: "final",
      message: "Requesting model…",
      observedAt: "2026-01-01T00:00:01.000Z",
      role: "planner",
      requestId: "req_local_placeholder",
    });
    store.appendThreadRunEvent({
      id: "evt_delta",
      threadId: thread.id,
      eventType: "message.delta",
      scope: "main",
      streamState: "partial",
      message: "Hello",
      observedAt: "2026-01-01T00:00:02.000Z",
      role: "planner",
      requestId: "req_local_placeholder",
    });

    expect(store.rekeyThreadRunRequestId(thread.id, "req_local_placeholder", "msgreq_provider_123")).toBe(2);
    expect(store.listThreadRunEvents(thread.id).map((event) => event.requestId)).toEqual([
      "msgreq_provider_123",
      "msgreq_provider_123",
    ]);
  },
);
