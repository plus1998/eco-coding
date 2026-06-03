import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConversationStore } from "../src/main/conversation-store";
import { buildThreadRuntimeConfigFromDefaults } from "../src/shared/thread-runtime-config";
import type { ModelSettingsSnapshot, SubagentEnabledSettings, ThreadSummary } from "../src/shared/ipc";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

const subagentDefaults: SubagentEnabledSettings = {
  explore: true,
  architect: true,
  coder: true,
  reviewer: true,
  tester: true,
};

const settings: ModelSettingsSnapshot = {
  providers: [],
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
    subagentDefaults,
    workflowDefaults: { planModeEnabled: true },
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
    planModeEnabled: false,
    routeProfileId: "profile-a",
  });
  expect(store.getThread("thr_test")?.runtimeConfig?.planModeEnabled).toBe(false);
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
