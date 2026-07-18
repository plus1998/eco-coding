import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createConversationStore } from "../src/main/conversation-store";
import { createProjectSkillsSettingsStore } from "../src/main/project-skills-settings-store";
import type { ThreadSummary } from "../src/shared/ipc";

async function createTestDirectory(t: test.TestContext, prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("Node SQLite remembers Skills independently for each project", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-project-skills-");
  const store = await createProjectSkillsSettingsStore(path.join(directory, "eco-coding.sqlite"));
  const projectA = path.join(directory, "a");
  const projectB = path.join(directory, "b");

  store.save({ workspacePath: projectA, enabledByPath: { "user:a": true } });
  store.save({ workspacePath: projectB, enabledByPath: { "user:a": false } });

  assert.deepEqual(store.get(projectA).enabledByPath, { "user:a": true });
  assert.deepEqual(store.get(projectB).enabledByPath, { "user:a": false });
});

test("Node SQLite persists an Eco thread and Claude session binding", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-sqlite-store-");
  const databasePath = path.join(directory, "eco-coding.sqlite");
  const store = await createConversationStore(databasePath);
  const now = new Date().toISOString();
  const thread: ThreadSummary = {
    id: "thr_node_sqlite",
    title: "Node SQLite",
    prompt: "verify persistence",
    workspacePath: "/tmp/eco-node-sqlite",
    status: "idle",
    message: "ready",
    createdAt: now,
    updatedAt: now,
  };

  store.saveThread(thread);
  store.saveSdkSession(thread.id, "sdk_session_node", thread.workspacePath);

  assert.deepEqual(store.getSdkSession(thread.id), {
    sessionId: "sdk_session_node",
    cwd: thread.workspacePath,
  });
  assert.equal(store.getThread(thread.id)?.title, thread.title);
  assert.equal(store.getThread(thread.id)?.coreKind, "claude");
  assert.ok(store.getThread(thread.id)?.coreLockedAt);
  assert.deepEqual(
    {
      coreKind: store.getThreadCoreSession(thread.id)?.coreKind,
      externalSessionId: store.getThreadCoreSession(thread.id)?.externalSessionId,
      cwd: store.getThreadCoreSession(thread.id)?.cwd,
    },
    {
      coreKind: "claude",
      externalSessionId: "sdk_session_node",
      cwd: thread.workspacePath,
    },
  );

  const inspection = new DatabaseSync(databasePath);
  const row = inspection
    .prepare("SELECT title, core_kind, core_locked_at, sdk_session_id, sdk_cwd FROM threads WHERE id = ?")
    .get(thread.id) as
    | {
        title: string;
        core_kind: string;
        core_locked_at: string;
        sdk_session_id: string;
        sdk_cwd: string;
      }
    | undefined;
  assert.equal(row?.title, thread.title);
  assert.equal(row?.core_kind, "claude");
  assert.ok(row?.core_locked_at);
  assert.equal(row?.sdk_session_id, "sdk_session_node");
  assert.equal(row?.sdk_cwd, thread.workspacePath);
  inspection.close();
});

test("Node SQLite persists composer drafts and clears deleted thread drafts", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-composer-draft-");
  const databasePath = path.join(directory, "eco-coding.sqlite");
  const store = await createConversationStore(databasePath);

  store.saveComposerDraft("landing:/tmp/project", "draft on landing");
  const reloaded = await createConversationStore(databasePath);
  assert.equal(reloaded.getComposerDraft("landing:/tmp/project")?.prompt, "draft on landing");

  const now = new Date().toISOString();
  reloaded.saveThread({
    id: "thr_composer_draft",
    title: "Composer draft",
    prompt: "initial",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "ready",
    createdAt: now,
    updatedAt: now,
  });
  reloaded.saveComposerDraft("thread:thr_composer_draft", "thread draft");
  assert.equal(reloaded.getComposerDraft("thread:thr_composer_draft")?.prompt, "thread draft");

  reloaded.deleteThread("thr_composer_draft");
  assert.equal(reloaded.getComposerDraft("thread:thr_composer_draft"), undefined);

  reloaded.saveComposerDraft("landing:/tmp/project", "");
  assert.equal(reloaded.getComposerDraft("landing:/tmp/project"), undefined);
});

test("Node SQLite persists reordered follow-ups", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-follow-up-reorder-");
  const store = await createConversationStore(path.join(directory, "eco-coding.sqlite"));
  const now = new Date().toISOString();
  store.saveThread({
    id: "thr_followup_reorder",
    title: "Follow-up reorder",
    prompt: "start",
    workspacePath: "/tmp/follow-up-reorder",
    status: "running",
    message: "working",
    createdAt: now,
    updatedAt: now,
  });
  const first = store.enqueueThreadFollowUp({ threadId: "thr_followup_reorder", prompt: "第一条" });
  const second = store.enqueueThreadFollowUp({ threadId: "thr_followup_reorder", prompt: "第二条" });

  const reordered = store.reorderQueuedThreadFollowUps("thr_followup_reorder", [second.id, first.id]);

  assert.deepEqual(reordered.map((item) => item.id), [second.id, first.id]);
  assert.deepEqual(
    store.listThreadFollowUps("thr_followup_reorder", { statuses: ["queued"] }).map((item) => item.id),
    [second.id, first.id],
  );
});

test("Node SQLite claims queued follow-ups one at a time by default", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-follow-up-queue-");
  const store = await createConversationStore(path.join(directory, "eco-coding.sqlite"));
  const now = new Date().toISOString();
  store.saveThread({
    id: "thr_followup_queue",
    title: "Follow-up queue",
    prompt: "start",
    workspacePath: "/tmp/follow-up-queue",
    status: "running",
    message: "working",
    createdAt: now,
    updatedAt: now,
  });
  const first = store.enqueueThreadFollowUp({
    threadId: "thr_followup_queue",
    prompt: "第一条",
  });
  const second = store.enqueueThreadFollowUp({
    threadId: "thr_followup_queue",
    prompt: "第二条",
  });

  const claimed = store.claimQueuedThreadFollowUps("thr_followup_queue", {
    deliveryMode: "resume",
    deliveryBoundary: "safe_boundary",
  });

  assert.deepEqual(claimed.map((item) => item.id), [first.id]);
  assert.equal(store.getThreadFollowUp("thr_followup_queue", first.id)?.status, "delivered");
  assert.equal(store.getThreadFollowUp("thr_followup_queue", second.id)?.status, "queued");
});

test("Node SQLite migrates the legacy thread activity schema", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-sqlite-migration-");
  const databasePath = path.join(directory, "eco-coding.sqlite");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sdk_session_id TEXT,
      sdk_cwd TEXT
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
  legacy
    .prepare(
      `INSERT INTO threads (
         id, title, prompt, workspace_path, status, message, created_at, updated_at,
         sdk_session_id, sdk_cwd
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "thr_legacy_claude",
      "Legacy Claude",
      "legacy prompt",
      "/tmp/legacy-claude",
      "idle",
      "ready",
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "sdk_legacy",
      "/tmp/legacy-claude",
    );
  legacy.close();

  await createConversationStore(databasePath);

  const migrated = new DatabaseSync(databasePath);
  const columns = migrated.prepare("PRAGMA table_info(thread_activity)").all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === "sdk_user_message_id"));
  const indexes = migrated.prepare("PRAGMA index_list(thread_activity)").all() as Array<{ name: string }>;
  assert.ok(indexes.some((index) => index.name === "idx_thread_activity_thread_sdk_user_message"));
  const thread = migrated
    .prepare("SELECT core_kind, core_locked_at FROM threads WHERE id = 'thr_legacy_claude'")
    .get() as { core_kind: string; core_locked_at: string } | undefined;
  assert.equal(thread?.core_kind, "claude");
  assert.equal(thread?.core_locked_at, "2026-01-01T00:00:00.000Z");
  const binding = migrated
    .prepare(
      `SELECT core_kind, external_session_id, cwd
       FROM thread_core_sessions
       WHERE thread_id = 'thr_legacy_claude'`,
    )
    .get() as { core_kind: string; external_session_id: string; cwd: string } | undefined;
  assert.equal(binding?.core_kind, "claude");
  assert.equal(binding?.external_session_id, "sdk_legacy");
  assert.equal(binding?.cwd, "/tmp/legacy-claude");
  migrated.close();
});

test("Node SQLite rejects a Claude session binding for a Codex thread", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-sqlite-core-mismatch-");
  const databasePath = path.join(directory, "eco-coding.sqlite");
  const store = await createConversationStore(databasePath);
  const now = new Date().toISOString();
  store.saveThread({
    id: "thr_codex",
    title: "Codex",
    prompt: "codex prompt",
    workspacePath: "/tmp/codex",
    status: "idle",
    message: "ready",
    createdAt: now,
    updatedAt: now,
    coreKind: "codex",
    coreLockedAt: now,
  });

  assert.throws(
    () => store.saveSdkSession("thr_codex", "sdk_wrong_core", "/tmp/codex"),
    /Thread Core mismatch/,
  );
  assert.equal(store.getSdkSession("thr_codex"), undefined);
  assert.equal(store.getThreadCoreSession("thr_codex"), undefined);

  store.saveThreadCoreSession({
    threadId: "thr_codex",
    coreKind: "codex",
    externalSessionId: "codex_thread_1",
    cwd: "/tmp/codex",
    metadata: { schemaVersion: 1 },
  });
  assert.deepEqual(store.getThreadCoreSession("thr_codex")?.metadata, { schemaVersion: 1 });
  assert.equal(store.getThreadCoreSession("thr_codex")?.externalSessionId, "codex_thread_1");
});

test("Node SQLite leaves ambiguous mixed-product thread ownership unknown", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-sqlite-mixed-migration-");
  const databasePath = path.join(directory, "eco-coding.sqlite");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sdk_session_id TEXT,
      sdk_cwd TEXT
    );
    CREATE TABLE eco_thread_codex_map (
      eco_thread_id TEXT PRIMARY KEY,
      codex_thread_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const insertThread = legacy.prepare(
    `INSERT INTO threads (
       id, title, prompt, workspace_path, status, message, created_at, updated_at,
       sdk_session_id, sdk_cwd
     ) VALUES (?, ?, '', '/tmp/project', 'idle', 'ready', ?, ?, ?, ?)`,
  );
  const createdAt = "2026-02-01T00:00:00.000Z";
  insertThread.run("thr_only_codex", "Codex", createdAt, createdAt, null, null);
  insertThread.run("thr_only_claude", "Claude", createdAt, createdAt, "sdk_claude", "/tmp/project");
  insertThread.run("thr_conflict", "Conflict", createdAt, createdAt, "sdk_conflict", "/tmp/project");
  insertThread.run("thr_unknown", "Unknown", createdAt, createdAt, null, null);
  const insertMap = legacy.prepare(
    `INSERT INTO eco_thread_codex_map (eco_thread_id, codex_thread_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  );
  insertMap.run("thr_only_codex", "codex_only", createdAt, createdAt);
  insertMap.run("thr_conflict", "codex_conflict", createdAt, createdAt);
  legacy.close();

  const store = await createConversationStore(databasePath);

  assert.equal(store.getThread("thr_only_codex")?.coreKind, "codex");
  assert.equal(store.getThread("thr_only_claude")?.coreKind, "claude");
  assert.equal(store.getThread("thr_conflict")?.coreKind, undefined);
  assert.equal(store.getThread("thr_unknown")?.coreKind, undefined);
  assert.throws(
    () =>
      store.saveThreadCoreSession({
        threadId: "thr_conflict",
        coreKind: "codex",
        externalSessionId: "codex_conflict",
        cwd: "/tmp/project",
      }),
    /Thread Core mismatch/,
  );
});

test("Node SQLite keeps the unified Claude binding in sync across compaction", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-sqlite-compact-binding-");
  const databasePath = path.join(directory, "eco-coding.sqlite");
  const store = await createConversationStore(databasePath);
  const now = new Date().toISOString();
  store.saveThread({
    id: "thr_compact_binding",
    title: "Compact binding",
    prompt: "compact",
    workspacePath: "/tmp/compact-binding",
    status: "idle",
    message: "ready",
    createdAt: now,
    updatedAt: now,
    coreKind: "claude",
    coreLockedAt: now,
  });
  store.saveSdkSession("thr_compact_binding", "sdk_source", "/tmp/compact-binding");

  store.commitCompactHandoffAndClearSession("thr_compact_binding", {
    sourceSessionId: "sdk_source",
    sourceStartMessageId: "msg_start",
    sourceEndMessageId: "msg_end",
    summary: "summary",
    recentMessages: [{ role: "user", message: "recent" }],
    preTokensEstimate: 10_000,
    preTokensSource: "sdk_context_usage",
    postTokensEstimate: 2_000,
    postTokensSource: "local_heuristic",
    compressionRatio: 0.2,
  });
  assert.equal(store.getSdkSession("thr_compact_binding"), undefined);
  assert.equal(store.getThreadCoreSession("thr_compact_binding"), undefined);

  assert.equal(
    store.captureSdkSessionAndConsumeCompactHandoff(
      "thr_compact_binding",
      "sdk_target",
      "/tmp/compact-binding",
    ),
    true,
  );
  assert.equal(store.getSdkSession("thr_compact_binding")?.sessionId, "sdk_target");
  assert.equal(store.getThreadCoreSession("thr_compact_binding")?.externalSessionId, "sdk_target");
  assert.equal(store.getCompactHandoff("thr_compact_binding"), undefined);
});
