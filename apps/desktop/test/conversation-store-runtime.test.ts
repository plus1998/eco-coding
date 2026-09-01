import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConversationStore, parseCompactHandoffRecentMessages } from "../src/main/conversation-store";
import type { ModelSettingsSnapshot, ThreadSummary } from "../src/shared/ipc";
import { buildThreadRuntimeConfigFromDefaults } from "../src/shared/thread-runtime-config";

test("parseCompactHandoffRecentMessages accepts structured and legacy records", () => {
  expect(
    parseCompactHandoffRecentMessages(
      JSON.stringify(["legacy user", { id: "msg_2", role: "assistant", message: "structured assistant" }]),
      "thr_parse",
    ),
  ).toEqual([
    { role: "user", message: "legacy user" },
    { id: "msg_2", role: "assistant", message: "structured assistant" },
  ]);
});

test("parseCompactHandoffRecentMessages rejects corrupted records", () => {
  expect(() => parseCompactHandoffRecentMessages("not-json", "thr_bad_json")).toThrow("JSON 损坏");
  expect(() =>
    parseCompactHandoffRecentMessages(JSON.stringify([{ role: "assistant" }]), "thr_bad_entry"),
  ).toThrow("条目结构无效");
});

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
  mainAgentConfigs: [], mainAgentPrompts: [], subagentOrchestrations: [],
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
  });
  expect(store.getThread("thr_test")?.runtimeConfig?.sessionMode).toBe("agent");
});

test.skipIf(!sqliteAvailable)("persists the approved deferred ExitPlanMode tool id", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-pending-plan-exit-id-"));
  const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
  const thread: ThreadSummary = {
    id: "thr_plan",
    title: "Plan",
    prompt: "ship it",
    workspacePath: "/tmp/project",
    status: "awaiting_plan",
    message: "waiting",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.saveThread(thread);
  store.savePendingPlan({
    threadId: thread.id,
    userPrompt: thread.prompt,
    analysis: "analysis",
    plan: "plan",
    workspacePath: thread.workspacePath,
    worktreePath: thread.workspacePath,
    routesJson: "[]",
    deferredExitPlanToolUseId: "tool_exit_approved",
  });

  expect(store.getPendingPlan(thread.id)?.deferredExitPlanToolUseId).toBe("tool_exit_approved");
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

test.skipIf(!sqliteAvailable)(
  "atomically commits compact handoff and clears main/subagent sessions",
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-compact-handoff-atomic-"));
    const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
    const thread: ThreadSummary = {
      id: "thr_handoff_atomic",
      title: "Handoff",
      prompt: "hello",
      workspacePath: "/tmp/project",
      status: "idle",
      message: "ok",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.saveThread(thread);
    store.saveSdkSession(thread.id, "sess_source", "/tmp/project");
    store.upsertSubagentSessionActive({
      threadId: thread.id,
      role: "coder",
      agentId: "agent_1",
      phase: "execution",
    });

    const handoff = store.commitCompactHandoffAndClearSession(thread.id, {
      sourceSessionId: "sess_source",
      sourceStartMessageId: "msg_start",
      sourceEndMessageId: "msg_end",
      summary: "summary text",
      recentMessages: [
        { id: "u1", role: "user", message: "recent-1" },
        { id: "a1", role: "assistant", message: "recent-2" },
      ],
      preTokensEstimate: 10_000,
      preTokensSource: "sdk_context_usage",
      postTokensEstimate: 2_000,
      postTokensSource: "local_heuristic",
      compressionRatio: 0.2,
      schemaVersion: 2,
    });

    expect(handoff).toMatchObject({
      threadId: thread.id,
      schemaVersion: 2,
      generation: 1,
      sourceSessionId: "sess_source",
      preTokensEstimate: 10_000,
      preTokensSource: "sdk_context_usage",
      postTokensEstimate: 2_000,
      postTokensSource: "local_heuristic",
      compressionRatio: 0.2,
    });
    expect(handoff.summaryId).toStartWith("csm_");
    expect(store.getSdkSession(thread.id)).toBeUndefined();
    expect(store.listSubagentSessions(thread.id)).toEqual([]);
    expect(store.getCompactHandoff(thread.id)?.recentMessages).toEqual([
      { id: "u1", role: "user", message: "recent-1" },
      { id: "a1", role: "assistant", message: "recent-2" },
    ]);
  },
);

test.skipIf(!sqliteAvailable)("rolls back compact handoff when the source session changed", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-compact-handoff-race-"));
  const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
  const thread: ThreadSummary = {
    id: "thr_handoff_race",
    title: "Handoff race",
    prompt: "hello",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "ok",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.saveThread(thread);
  store.saveSdkSession(thread.id, "sess_current", "/tmp/project");
  store.upsertSubagentSessionActive({
    threadId: thread.id,
    role: "coder",
    agentId: "agent_current",
    phase: "execution",
  });

  expect(() =>
    store.commitCompactHandoffAndClearSession(thread.id, {
      sourceSessionId: "sess_stale",
      sourceStartMessageId: "msg_start",
      sourceEndMessageId: "msg_end",
      summary: "stale summary",
      recentMessages: [{ role: "user", message: "recent" }],
      preTokensEstimate: 10_000,
      preTokensSource: "sdk_context_usage",
      postTokensEstimate: 2_000,
      postTokensSource: "local_heuristic",
      compressionRatio: 0.2,
    }),
  ).toThrow("源 SDK session 已变化");
  expect(store.getSdkSession(thread.id)?.sessionId).toBe("sess_current");
  expect(store.listSubagentSessions(thread.id)).toHaveLength(1);
  expect(store.getLatestCompactSummary(thread.id)).toBeUndefined();
});

test.skipIf(!sqliteAvailable)(
  "consumes a pending handoff without deleting rolling summary state",
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-compact-handoff-consume-"));
    const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
    const thread: ThreadSummary = {
      id: "thr_handoff_consume",
      title: "Handoff consume",
      prompt: "hello",
      workspacePath: "/tmp/project",
      status: "idle",
      message: "ok",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.saveThread(thread);
    store.saveSdkSession(thread.id, "sess_source", "/tmp/project");
    store.commitCompactHandoffAndClearSession(thread.id, {
      sourceSessionId: "sess_source",
      sourceStartMessageId: "msg_start",
      sourceEndMessageId: "msg_end",
      summary: "summary text",
      recentMessages: [{ role: "user", message: "recent" }],
      preTokensEstimate: 10_000,
      preTokensSource: "sdk_context_usage",
      postTokensEstimate: 2_000,
      postTokensSource: "local_heuristic",
      compressionRatio: 0.2,
    });

    expect(store.getCompactHandoff(thread.id)).toBeDefined();
    expect(store.captureSdkSessionAndConsumeCompactHandoff(thread.id, "sess_target", "/tmp/project")).toBe(
      true,
    );
    expect(store.getSdkSession(thread.id)).toEqual({
      sessionId: "sess_target",
      cwd: "/tmp/project",
    });
    expect(store.getCompactHandoff(thread.id)).toBeUndefined();
    expect(store.markCompactHandoffConsumed(thread.id, "sess_other")).toBe(false);
    expect(store.getLatestCompactSummary(thread.id)).toMatchObject({
      generation: 1,
      sourceSessionId: "sess_source",
      targetSessionId: "sess_target",
    });
    expect(store.getLatestCompactSummary(thread.id)?.consumedAt).toBeTruthy();
  },
);

test.skipIf(!sqliteAvailable)(
  "rejects reinstalling the compacted source session and keeps the handoff pending",
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-compact-handoff-source-reuse-"));
    const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
    const thread: ThreadSummary = {
      id: "thr_handoff_source_reuse",
      title: "Handoff source reuse",
      prompt: "hello",
      workspacePath: "/tmp/project",
      status: "idle",
      message: "ok",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.saveThread(thread);
    store.saveSdkSession(thread.id, "sess_source", "/tmp/project");
    store.commitCompactHandoffAndClearSession(thread.id, {
      sourceSessionId: "sess_source",
      sourceStartMessageId: "msg_start",
      sourceEndMessageId: "msg_end",
      summary: "summary text",
      recentMessages: [{ role: "user", message: "recent" }],
      preTokensEstimate: 10_000,
      preTokensSource: "sdk_context_usage",
      postTokensEstimate: 2_000,
      postTokensSource: "local_heuristic",
      compressionRatio: 0.2,
    });

    expect(() =>
      store.captureSdkSessionAndConsumeCompactHandoff(thread.id, "sess_source", "/tmp/project"),
    ).toThrow("新 SDK session 与源 session 相同");
    expect(store.getSdkSession(thread.id)).toBeUndefined();
    const pending = store.getCompactHandoff(thread.id);
    expect(pending?.sourceSessionId).toBe("sess_source");
    expect(pending?.targetSessionId).toBeUndefined();
    expect(pending?.consumedAt).toBeUndefined();
  },
);

test.skipIf(!sqliteAvailable)(
  "increments compact summary generation across replacement sessions",
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-compact-handoff-generation-"));
    const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
    const thread: ThreadSummary = {
      id: "thr_handoff_generation",
      title: "Handoff generation",
      prompt: "hello",
      workspacePath: "/tmp/project",
      status: "idle",
      message: "ok",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.saveThread(thread);
    store.saveSdkSession(thread.id, "sess_1", "/tmp/project");
    const first = store.commitCompactHandoffAndClearSession(thread.id, {
      sourceSessionId: "sess_1",
      sourceStartMessageId: "msg_start",
      sourceEndMessageId: "msg_end",
      summary: "generation one",
      recentMessages: [{ role: "user", message: "recent one" }],
      preTokensEstimate: 10_000,
      preTokensSource: "sdk_context_usage",
      postTokensEstimate: 2_000,
      postTokensSource: "local_heuristic",
      compressionRatio: 0.2,
    });
    store.captureSdkSessionAndConsumeCompactHandoff(thread.id, "sess_2", "/tmp/project");
    const second = store.commitCompactHandoffAndClearSession(thread.id, {
      sourceSessionId: "sess_2",
      sourceStartMessageId: "msg_start",
      sourceEndMessageId: "msg_end",
      summary: "generation two",
      recentMessages: [{ role: "user", message: "recent two" }],
      preTokensEstimate: 12_000,
      preTokensSource: "sdk_context_usage",
      postTokensEstimate: 3_000,
      postTokensSource: "local_heuristic",
      compressionRatio: 0.25,
    });

    expect(first.generation).toBe(1);
    expect(second.generation).toBe(2);
    expect(second.summaryId).not.toBe(first.summaryId);
    expect(store.getCompactHandoff(thread.id)?.summary).toBe("generation two");
  },
);

test.skipIf(!sqliteAvailable)("migrates legacy compact handoff metadata deterministically", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-compact-handoff-legacy-"));
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
    CREATE TABLE thread_compact_handoff (
      thread_id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      recent_user_messages_json TEXT NOT NULL,
      post_tokens_estimate INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO thread_compact_handoff (
       thread_id, summary, recent_user_messages_json, post_tokens_estimate, created_at
     ) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    "thr_handoff_legacy",
    "legacy summary",
    JSON.stringify(["old user 1", "old user 2"]),
    10,
    new Date().toISOString(),
  );
  db.close();

  const store = await createConversationStore(dbPath);
  expect(store.getCompactHandoff("thr_handoff_legacy")).toMatchObject({
    summaryId: "legacy-thr_handoff_legacy",
    schemaVersion: 1,
    generation: 1,
    recentMessages: [
      { role: "user", message: "old user 1" },
      { role: "user", message: "old user 2" },
    ],
    preTokensEstimate: 10,
    preTokensSource: "local_heuristic",
    postTokensEstimate: 10,
    postTokensSource: "local_heuristic",
    compressionRatio: 1,
  });
});

test.skipIf(!sqliteAvailable)(
  "rejects corrupted compact handoff version, token source, and metrics",
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-compact-handoff-corrupt-"));
    const dbPath = path.join(dir, "eco-coding.sqlite");
    const store = await createConversationStore(dbPath);
    const thread: ThreadSummary = {
      id: "thr_handoff_corrupt",
      title: "Handoff corrupt",
      prompt: "hello",
      workspacePath: "/tmp/project",
      status: "idle",
      message: "ok",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.saveThread(thread);
    store.saveCompactHandoff(thread.id, {
      summary: "summary",
      recentMessages: [{ role: "user", message: "recent" }],
      preTokensEstimate: 100,
      postTokensEstimate: 50,
      compressionRatio: 0.5,
    });

    const sqlite = await import("node:sqlite");
    const db = new sqlite.DatabaseSync(dbPath);
    db.prepare("UPDATE thread_compact_handoff SET pre_tokens_source = 'unknown' WHERE thread_id = ?").run(
      thread.id,
    );
    expect(() => store.getLatestCompactSummary(thread.id)).toThrow("token 来源无效");
    db.prepare(
      "UPDATE thread_compact_handoff SET pre_tokens_source = 'local_heuristic', generation = 0 WHERE thread_id = ?",
    ).run(thread.id);
    expect(() => store.getLatestCompactSummary(thread.id)).toThrow("版本信息无效");
    db.prepare(
      "UPDATE thread_compact_handoff SET generation = 1, compression_ratio = 0.9 WHERE thread_id = ?",
    ).run(thread.id);
    expect(() => store.getLatestCompactSummary(thread.id)).toThrow("压缩比例与 token 估算不一致");
    db.close();
  },
);

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

test.skipIf(!sqliteAvailable)("discardThreadTurnFromActivityLine drops the user turn but keeps earlier history and todos", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-discard-unstarted-"));
  const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
  const thread: ThreadSummary = {
    id: "thr_discard",
    title: "Discard",
    prompt: "first prompt",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "ok",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
  store.saveThread(thread);

  const first = store.appendActivityLine(thread.id, { id: "user:first", role: "user", message: "first" });
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
  store.saveUserMessageRecord({
    threadId: thread.id,
    activityLineId: first.id,
    text: "first",
  });
  store.replaceCoderTodos(thread.id, [
    {
      id: "todo_keep",
      threadId: thread.id,
      title: "keep",
      detail: "",
      status: "pending",
      position: 0,
      updatedAt: new Date().toISOString(),
    },
  ]);

  const target = store.appendActivityLine(thread.id, { id: "user:target", role: "user", message: "target" });
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
  store.saveUserMessageRecord({
    threadId: thread.id,
    activityLineId: target.id,
    text: "target",
  });
  store.appendThreadRunEvent({
    id: "evt_exhaust",
    threadId: thread.id,
    sequence: 3,
    eventType: "message.final",
    scope: "main",
    streamState: "none",
    message: "Error: RetriableError: [resource_exhausted] Error",
    observedAt: "2024-01-01T00:00:03.000Z",
  });

  const summary = store.discardThreadTurnFromActivityLine(thread.id, target.id);

  expect(summary.activityLineId).toBe("user:target");
  expect(store.listActivityLines(thread.id).map((line) => line.id)).toEqual(["user:first"]);
  expect(store.listThreadRunEvents(thread.id).map((event) => event.id)).toEqual(["evt_first"]);
  expect(store.listUserMessageRecords(thread.id).map((record) => record.activityLineId)).toEqual(["user:first"]);
  expect(store.listCoderTodos(thread.id).map((todo) => todo.id)).toEqual(["todo_keep"]);
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

test.skipIf(!sqliteAvailable)("derives hostUiFeatures for acp cursor and claude threads", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-host-ui-features-"));
  const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
  const now = new Date().toISOString();
  store.saveThread({
    id: "thr_cursor",
    title: "Cursor",
    prompt: "hi",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "",
    createdAt: now,
    updatedAt: now,
    coreKind: "acp",
    acpAgentId: "cursor",
  });
  store.saveThread({
    id: "thr_claude",
    title: "Claude",
    prompt: "hi",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "",
    createdAt: now,
    updatedAt: now,
    coreKind: "claude",
  });
  expect(store.getThread("thr_cursor")?.hostUiFeatures).toEqual({
    contextUsage: "hide",
    billing: "hide",
  });
  expect(store.getThread("thr_claude")?.hostUiFeatures).toEqual({
    contextUsage: "show",
    billing: "show",
  });
});

test.skipIf(!sqliteAvailable)("surfaces ACP core session id on thread summaries", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-acp-session-summary-"));
  const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
  const now = new Date().toISOString();
  store.saveThread({
    id: "thr_acp_session",
    title: "ACP",
    prompt: "hi",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "",
    createdAt: now,
    updatedAt: now,
    coreKind: "acp",
    acpAgentId: "cursor",
  });
  expect(store.getThread("thr_acp_session")?.externalSessionId).toBeUndefined();

  store.saveThreadCoreSession({
    threadId: "thr_acp_session",
    coreKind: "acp",
    externalSessionId: "  cursor-acp-sess-1  ",
    cwd: "/tmp/project",
  });
  expect(store.getThread("thr_acp_session")?.externalSessionId).toBe("cursor-acp-sess-1");
  expect(store.listThreads().find((thread) => thread.id === "thr_acp_session")?.externalSessionId).toBe(
    "cursor-acp-sess-1",
  );
});

test.skipIf(!sqliteAvailable)(
  "getUserMessageForEdit recovers Codex image prompts before SDK bind",
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-codex-image-retry-"));
    const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
    const now = new Date().toISOString();
    const threadId = "thr_codex_image_retry";
    store.saveThread({
      id: threadId,
      title: "Codex image retry",
      prompt: "inspect screenshot",
      workspacePath: "/tmp/project",
      status: "failed",
      message: "failed",
      createdAt: now,
      updatedAt: now,
      coreKind: "codex",
      coreLockedAt: now,
    });

    store.saveUserMessageRecord({
      threadId,
      activityLineId: "codex-pending:img-1",
      text: "请根据截图修复样式",
      provider: "codex",
      attachments: [{ mediaType: "image/png", data: "full-image-payload" }],
    });
    store.appendThreadRunEvent({
      id: "live_codex_prompt",
      threadId,
      sequence: 1,
      eventType: "thread.status",
      scope: "main",
      role: "user",
      streamState: "none",
      message: "请根据截图修复样式",
      observedAt: "2026-08-11T00:00:01.000Z",
      metadata: {
        liveType: "thread.user_prompt",
        promptImagePreviews: [{ id: "preview-1", mediaType: "image/jpeg", data: "preview-payload" }],
      },
    });

    const byPendingId = store.getUserMessageForEdit(threadId, "codex-pending:img-1");
    expect(byPendingId?.attachments).toEqual([{ mediaType: "image/png", data: "full-image-payload" }]);

    const byRunEventId = store.getUserMessageForEdit(threadId, "live_codex_prompt");
    expect(byRunEventId?.attachments).toEqual([{ mediaType: "image/png", data: "full-image-payload" }]);
  },
);

test.skipIf(!sqliteAvailable)(
  "getUserMessageForEdit falls back to prompt previews when Codex pending attachments are missing",
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-codex-image-preview-fallback-"));
    const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
    const now = new Date().toISOString();
    const threadId = "thr_codex_preview_only";
    store.saveThread({
      id: threadId,
      title: "Codex preview only",
      prompt: "inspect screenshot",
      workspacePath: "/tmp/project",
      status: "failed",
      message: "failed",
      createdAt: now,
      updatedAt: now,
      coreKind: "codex",
      coreLockedAt: now,
    });
    store.appendThreadRunEvent({
      id: "live_codex_preview_only",
      threadId,
      sequence: 1,
      eventType: "thread.status",
      scope: "main",
      role: "user",
      streamState: "none",
      message: "只看预览图",
      observedAt: "2026-08-11T00:00:01.000Z",
      metadata: {
        liveType: "thread.user_prompt",
        promptImagePreviews: [{ id: "preview-1", mediaType: "image/jpeg", data: "preview-payload" }],
      },
    });

    const record = store.getUserMessageForEdit(threadId, "live_codex_preview_only");
    expect(record?.attachments).toEqual([{ mediaType: "image/jpeg", data: "preview-payload" }]);
  },
);
