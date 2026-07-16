import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

function thread(id = "thr_followup"): ThreadSummary {
  return {
    id,
    title: "Follow-up",
    prompt: "start",
    workspacePath: "/tmp/project",
    status: "running",
    message: "working",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

async function createStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-follow-up-store-"));
  const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
  store.saveThread(thread());
  return store;
}

test.skipIf(!sqliteAvailable)("persists and orders queued follow-ups by priority", async () => {
  const store = await createStore();

  const normal = store.enqueueThreadFollowUp({
    threadId: "thr_followup",
    prompt: "普通后续",
    attachments: [{ mediaType: "image/png", data: "abc" }],
    sourceRunAttemptId: "attempt_1",
    queuedDuringPhase: "execution",
  });
  const escalated = store.enqueueThreadFollowUp({
    threadId: "thr_followup",
    prompt: "立即处理",
    priority: "escalated",
    deliveryMode: "interrupt_resume",
  });

  const listed = store.listThreadFollowUps("thr_followup");
  expect(listed.map((item) => item.id)).toEqual([escalated.id, normal.id]);
  expect(listed[0]).toMatchObject({
    prompt: "立即处理",
    priority: "escalated",
    deliveryMode: "interrupt_resume",
    status: "queued",
  });
  expect(listed[1]?.attachments?.[0]?.mediaType).toBe("image/png");
  expect(listed[1]).toMatchObject({
    sourceRunAttemptId: "attempt_1",
    queuedDuringPhase: "execution",
  });
});

test.skipIf(!sqliteAvailable)("loads pending follow-ups from an existing database", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-follow-up-reopen-"));
  const dbPath = path.join(dir, "eco-coding.sqlite");
  const store = await createConversationStore(dbPath);
  store.saveThread(thread("thr_reopen"));
  const saved = store.enqueueThreadFollowUp({
    threadId: "thr_reopen",
    prompt: "重启后继续",
  });

  const reopened = await createConversationStore(dbPath);
  expect(reopened.listThreadFollowUps("thr_reopen")).toMatchObject([
    {
      id: saved.id,
      prompt: "重启后继续",
      status: "queued",
    },
  ]);
});

test.skipIf(!sqliteAvailable)("escalates latest follow-up and supersedes older escalated items", async () => {
  const store = await createStore();
  const olderEscalated = store.enqueueThreadFollowUp({
    threadId: "thr_followup",
    prompt: "旧的立即处理",
    priority: "escalated",
    deliveryMode: "interrupt_resume",
  });
  const normal = store.enqueueThreadFollowUp({
    threadId: "thr_followup",
    prompt: "新的立即处理",
  });

  const escalated = store.escalateThreadFollowUp("thr_followup", normal.id);
  expect(escalated).toMatchObject({
    id: normal.id,
    priority: "escalated",
    deliveryMode: "interrupt_resume",
    status: "queued",
  });
  expect(store.getThreadFollowUp("thr_followup", olderEscalated.id)?.status).toBe("superseded");
});

test.skipIf(!sqliteAvailable)("cancels only queued follow-ups", async () => {
  const store = await createStore();
  const queued = store.enqueueThreadFollowUp({ threadId: "thr_followup", prompt: "稍后处理" });
  const cancelled = store.cancelThreadFollowUp("thr_followup", queued.id);
  expect(cancelled?.status).toBe("cancelled");

  const delivered = store.enqueueThreadFollowUp({ threadId: "thr_followup", prompt: "已交付" });
  store.updateThreadFollowUpStatus("thr_followup", delivered.id, { status: "delivered" });
  expect(store.cancelThreadFollowUp("thr_followup", delivered.id)).toBeUndefined();
});

test.skipIf(!sqliteAvailable)("updates queued follow-up prompt and attachments", async () => {
  const store = await createStore();
  const queued = store.enqueueThreadFollowUp({
    threadId: "thr_followup",
    prompt: "原始引导",
    attachments: [{ mediaType: "image/png", data: "abc" }],
  });

  const updated = store.updateThreadFollowUp("thr_followup", queued.id, {
    prompt: "修改后的引导",
    attachments: [{ mediaType: "image/jpeg", data: "def" }],
  });

  expect(updated).toMatchObject({
    id: queued.id,
    prompt: "修改后的引导",
    status: "queued",
  });
  expect(updated?.attachments?.[0]?.mediaType).toBe("image/jpeg");
  expect(store.updateThreadFollowUp("thr_followup", queued.id, { prompt: "" })).toBeUndefined();
});

test.skipIf(!sqliteAvailable)("claims queued follow-ups for later delivery", async () => {
  const store = await createStore();
  const first = store.enqueueThreadFollowUp({ threadId: "thr_followup", prompt: "第一条" });
  const second = store.enqueueThreadFollowUp({ threadId: "thr_followup", prompt: "第二条" });

  const claimed = store.claimQueuedThreadFollowUps("thr_followup", {
    deliveryMode: "resume",
    targetRunAttemptId: "attempt_1",
    deliveryBoundary: "safe_boundary",
  });

  expect(claimed).toHaveLength(1);
  expect(claimed[0]).toMatchObject({
    id: first.id,
    status: "delivered",
    deliveryMode: "resume",
    targetRunAttemptId: "attempt_1",
    deliveryBoundary: "safe_boundary",
  });
  expect(claimed[0]?.deliveredAt).toBeTruthy();
  expect(store.getThreadFollowUp("thr_followup", second.id)?.status).toBe("queued");
});

test.skipIf(!sqliteAvailable)("claims one queued follow-up by default", async () => {
  const store = await createStore();
  const first = store.enqueueThreadFollowUp({ threadId: "thr_followup", prompt: "第一条" });
  const second = store.enqueueThreadFollowUp({ threadId: "thr_followup", prompt: "第二条" });

  const claimed = store.claimQueuedThreadFollowUps("thr_followup", {
    deliveryMode: "resume",
    deliveryBoundary: "safe_boundary",
  });

  expect(claimed.map((item) => item.id)).toEqual([first.id]);
  expect(store.getThreadFollowUp("thr_followup", second.id)?.status).toBe("queued");
});

test.skipIf(!sqliteAvailable)("claims only escalated follow-ups when priority is requested", async () => {
  const store = await createStore();
  const normal = store.enqueueThreadFollowUp({ threadId: "thr_followup", prompt: "普通排队" });
  const escalated = store.enqueueThreadFollowUp({
    threadId: "thr_followup",
    prompt: "立即处理",
    priority: "escalated",
    deliveryMode: "interrupt_resume",
  });

  const claimed = store.claimQueuedThreadFollowUps("thr_followup", {
    priority: "escalated",
    deliveryMode: "resume",
  });

  expect(claimed.map((item) => item.id)).toEqual([escalated.id]);
  expect(store.getThreadFollowUp("thr_followup", normal.id)?.status).toBe("queued");
});

test.skipIf(!sqliteAvailable)("deleteThread removes pending follow-ups", async () => {
  const store = await createStore();
  store.enqueueThreadFollowUp({ threadId: "thr_followup", prompt: "待清理" });

  expect(store.deleteThread("thr_followup")).toBe(true);
  expect(store.listThreadFollowUps("thr_followup")).toEqual([]);
});
