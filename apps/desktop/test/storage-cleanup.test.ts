import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodexFileCheckpointStore } from "../src/main/codex-file-checkpoints";
import { clearCodexHomeCaches, clearLogs, runStorageCleanup } from "../src/main/storage-cleanup";
import { createConversationStore } from "../src/main/conversation-store";
import type { ThreadSummary } from "../src/shared/ipc";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

let tempDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-storage-cleanup-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

test("clearLogs deletes only upstream-*.log and not other files", async () => {
  const logsDir = path.join(tempDir, "logs");
  await fs.mkdir(logsDir, { recursive: true });
  await fs.writeFile(path.join(logsDir, "upstream-2026-01-01.log"), "log-one");
  await fs.writeFile(path.join(logsDir, "upstream-2026-01-02.log"), "log-two");
  await fs.writeFile(path.join(logsDir, "readme.txt"), "keep-me");

  const result = await clearLogs(logsDir);
  expect(result.ok).toBe(true);
  expect(result.deletedCount).toBe(2);
  expect(result.freedBytes).toBe("log-one".length + "log-two".length);
  expect(await fs.readdir(logsDir)).toEqual(["readme.txt"]);
});

test("clearLogs respects olderThanDays using mtime", async () => {
  const logsDir = path.join(tempDir, "logs-age");
  await fs.mkdir(logsDir, { recursive: true });
  const oldPath = path.join(logsDir, "upstream-2020-01-01.log");
  const newPath = path.join(logsDir, "upstream-2026-08-01.log");
  await fs.writeFile(oldPath, "old");
  await fs.writeFile(newPath, "new");
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  await fs.utimes(oldPath, tenDaysAgo, tenDaysAgo);

  const result = await clearLogs(logsDir, 3);
  expect(result.deletedCount).toBe(1);
  expect(await fs.readdir(logsDir)).toEqual(["upstream-2026-08-01.log"]);
});

test("CodexFileCheckpointStore.deleteThread removes disk tree", async () => {
  const root = path.join(tempDir, "checkpoints");
  const store = new CodexFileCheckpointStore(root);
  const threadId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  await fs.mkdir(path.join(root, threadId, "items", "item1"), { recursive: true });
  await fs.writeFile(path.join(root, threadId, "items", "item1", "manifest.json"), "{}");
  await store.deleteThread(threadId);
  await expect(fs.access(path.join(root, threadId))).rejects.toMatchObject({ code: "ENOENT" });
});

test("deleteOrphans keeps active thread directories only", async () => {
  const root = path.join(tempDir, "checkpoints-orphans");
  const store = new CodexFileCheckpointStore(root);
  const active = "11111111-1111-1111-1111-111111111111";
  const orphan = "22222222-2222-2222-2222-222222222222";
  await fs.mkdir(path.join(root, active, "items"), { recursive: true });
  await fs.mkdir(path.join(root, orphan, "items"), { recursive: true });
  await fs.writeFile(path.join(root, orphan, "items", "blob"), "gone");

  const removed = await store.deleteOrphans([active]);
  expect(removed).toEqual([orphan]);
  expect(await fs.readdir(root)).toEqual([active]);
});

test("clearCodexHomeCaches only removes whitelisted dirs", async () => {
  const codexHome = path.join(tempDir, "codex");
  await fs.mkdir(path.join(codexHome, "eco-pending-spawns"), { recursive: true });
  await fs.mkdir(path.join(codexHome, "agents"), { recursive: true });
  await fs.writeFile(path.join(codexHome, "config.toml"), "keep");
  await fs.writeFile(path.join(codexHome, "eco-pending-spawns", "x.json"), "{}");
  await fs.writeFile(path.join(codexHome, "agents", "a.md"), "agent");

  const result = await clearCodexHomeCaches(codexHome);
  expect(result.ok).toBe(true);
  expect(result.deletedCount).toBe(1);
  expect(await fs.readdir(codexHome)).toEqual(expect.arrayContaining(["agents", "config.toml"]));
  await expect(fs.access(path.join(codexHome, "eco-pending-spawns"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

test("clearClaudeSessions orphansOnly removes Eco worktree projects only", async () => {
  const projectsDir = path.join(tempDir, "claude-projects");
  const historyDir = path.join(tempDir, "claude-history");
  const ecoOrphan = "-Users-me-repo--eco-worktrees-thr-gone";
  const ecoActive = "-Users-me-repo--eco-worktrees-thr-live";
  const cliProject = "-Users-me-other";
  for (const name of [ecoOrphan, ecoActive, cliProject]) {
    await fs.mkdir(path.join(projectsDir, name), { recursive: true });
    await fs.writeFile(path.join(projectsDir, name, "sess.jsonl"), "data");
  }
  await fs.mkdir(historyDir, { recursive: true });
  await fs.writeFile(path.join(historyDir, "keep"), "history");

  const store = {
    listThreads: () => [
      {
        id: "t1",
        workspacePath: "/Users/me/repo/.eco/worktrees/thr-live",
        status: "idle" as const,
      },
    ],
    getSdkSession: () => ({
      sessionId: "live-session",
      cwd: "/Users/me/repo/.eco/worktrees/thr-live",
    }),
  };

  const result = await runStorageCleanup(
    {
      userDataDir: tempDir,
      databasePath: path.join(tempDir, "x.sqlite"),
      conversationStore: store as never,
      codexFileCheckpointStore: new CodexFileCheckpointStore(path.join(tempDir, "cp")),
      deleteThreadWithExternalState: async () => {},
      hasActiveThreadRuns: () => false,
      claudeProjectsDir: projectsDir,
      claudeFileHistoryDir: historyDir,
    },
    { action: "clearClaudeSessions", options: { orphansOnly: true } },
  );

  expect(result.ok).toBe(true);
  expect(result.deletedCount).toBe(1);
  const remaining = (await fs.readdir(projectsDir)).sort();
  expect(remaining).toEqual([cliProject, ecoActive].sort());
  // File history untouched on orphan pass
  expect(await fs.readFile(path.join(historyDir, "keep"), "utf8")).toBe("history");
});

test.skipIf(!sqliteAvailable)(
  "runStorageCleanup clearCodexCheckpoints orphansOnly uses conversation list",
  async () => {
    const userDataDir = path.join(tempDir, "userdata");
    const checkpointsDir = path.join(userDataDir, "codex-file-checkpoints");
    const store = await createConversationStore(path.join(userDataDir, "eco-coding.sqlite"));
    const checkpointStore = new CodexFileCheckpointStore(checkpointsDir);

    const active: ThreadSummary = {
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      title: "Active",
      prompt: "p",
      workspacePath: "/tmp",
      status: "idle",
      message: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.saveThread(active);

    await fs.mkdir(path.join(checkpointsDir, active.id, "items"), { recursive: true });
    await fs.mkdir(path.join(checkpointsDir, "orphan-dir", "items"), { recursive: true });
    await fs.writeFile(path.join(checkpointsDir, "orphan-dir", "items", "x"), "blob");

    const result = await runStorageCleanup(
      {
        userDataDir,
        databasePath: path.join(userDataDir, "eco-coding.sqlite"),
        conversationStore: store,
        codexFileCheckpointStore: checkpointStore,
        deleteThreadWithExternalState: async () => {},
        hasActiveThreadRuns: () => false,
      },
      { action: "clearCodexCheckpoints", options: { orphansOnly: true } },
    );

    expect(result.ok).toBe(true);
    expect(result.deletedCount).toBe(1);
    expect(await fs.readdir(checkpointsDir)).toEqual([active.id]);
  },
);

test.skipIf(!sqliteAvailable)("clearAllConversations skips running threads", async () => {
  const userDataDir = path.join(tempDir, "userdata-clear");
  const checkpointsDir = path.join(userDataDir, "codex-file-checkpoints");
  const store = await createConversationStore(path.join(userDataDir, "eco-coding.sqlite"));
  const checkpointStore = new CodexFileCheckpointStore(checkpointsDir);

  const idle: ThreadSummary = {
    id: "idle-thread-id-0001",
    title: "Idle",
    prompt: "p",
    workspacePath: "/tmp",
    status: "idle",
    message: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const running: ThreadSummary = {
    id: "running-thread-id-01",
    title: "Run",
    prompt: "p",
    workspacePath: "/tmp",
    status: "running",
    message: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.saveThread(idle);
  store.saveThread(running);

  const deleted: string[] = [];
  const result = await runStorageCleanup(
    {
      userDataDir,
      databasePath: path.join(userDataDir, "eco-coding.sqlite"),
      conversationStore: store,
      codexFileCheckpointStore: checkpointStore,
      deleteThreadWithExternalState: async (threadId) => {
        deleted.push(threadId);
        store.deleteThread(threadId);
      },
      hasActiveThreadRuns: () => true,
    },
    { action: "clearAllConversations" },
  );

  expect(deleted).toEqual(["idle-thread-id-0001"]);
  expect(result.skippedThreadIds).toEqual(["running-thread-id-01"]);
  expect(result.ok).toBe(false);
  expect(store.listThreads().map((thread) => thread.id)).toEqual(["running-thread-id-01"]);
});

test.skipIf(!sqliteAvailable)("vacuumDatabase refuses while threads are active", async () => {
  const userDataDir = path.join(tempDir, "userdata-vac");
  const store = await createConversationStore(path.join(userDataDir, "eco-coding.sqlite"));
  const checkpointStore = new CodexFileCheckpointStore(path.join(userDataDir, "cp"));
  const result = await runStorageCleanup(
    {
      userDataDir,
      databasePath: path.join(userDataDir, "eco-coding.sqlite"),
      conversationStore: store,
      codexFileCheckpointStore: checkpointStore,
      deleteThreadWithExternalState: async () => {},
      hasActiveThreadRuns: () => true,
    },
    { action: "vacuumDatabase" },
  );
  expect(result.ok).toBe(false);
  expect(result.errors?.[0]).toMatch(/running or queued/i);
});
