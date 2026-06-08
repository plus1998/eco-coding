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

test.skipIf(!sqliteAvailable)("persists and loads thread runtime config", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-conversation-runtime-"));
  const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
  const runtimeConfig = buildThreadRuntimeConfigFromDefaults({
    settings,
    workflowDefaults: { orchestrationMode: "manual" },
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
    orchestrationMode: "autonomous",
    routeProfileId: "profile-a",
  });
  expect(store.getThread("thr_test")?.runtimeConfig?.orchestrationMode).toBe("autonomous");
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
