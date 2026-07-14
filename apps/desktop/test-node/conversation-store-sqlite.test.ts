import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createConversationStore } from "../src/main/conversation-store";
import type { ThreadSummary } from "../src/shared/ipc";

async function createTestDirectory(t: test.TestContext, prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

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

  const inspection = new DatabaseSync(databasePath);
  const row = inspection
    .prepare("SELECT title, sdk_session_id, sdk_cwd FROM threads WHERE id = ?")
    .get(thread.id) as { title: string; sdk_session_id: string; sdk_cwd: string } | undefined;
  assert.equal(row?.title, thread.title);
  assert.equal(row?.sdk_session_id, "sdk_session_node");
  assert.equal(row?.sdk_cwd, thread.workspacePath);
  inspection.close();
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
  legacy.close();

  await createConversationStore(databasePath);

  const migrated = new DatabaseSync(databasePath);
  const columns = migrated.prepare("PRAGMA table_info(thread_activity)").all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === "sdk_user_message_id"));
  const indexes = migrated.prepare("PRAGMA index_list(thread_activity)").all() as Array<{ name: string }>;
  assert.ok(indexes.some((index) => index.name === "idx_thread_activity_thread_sdk_user_message"));
  migrated.close();
});
