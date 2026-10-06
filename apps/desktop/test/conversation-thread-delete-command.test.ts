import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createThreadDeleteCommandCoordinator } from "../src/main/conversation-thread-delete-command";
import { createConversationStore } from "../src/main/conversation-store";
import type { ThreadSummary } from "../src/shared/ipc";

test("thread delete coalesces one accepted command and resumes it after status drift", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-thread-delete-coordinator-"));
  const store = await createConversationStore(path.join(dir, "eco.sqlite"));
  const thread: ThreadSummary = {
    id: "thread-delete-coordinator",
    title: "Delete",
    prompt: "hello",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "",
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
  };
  store.saveThread(thread);
  store.conversationV2().ensureConversation(thread.id);
  const command = {
    principalId: "principal",
    threadId: thread.id,
    clientCommandId: "delete-command",
    expectedHistoryRevision: 0,
  };
  store.acceptThreadDeleteCommand(command);
  store.saveThread({ ...thread, status: "running" });

  let releaseCleanup!: () => void;
  const cleanupGate = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  let cleanupCalls = 0;
  let deletedCallbacks = 0;
  const execute = createThreadDeleteCommandCoordinator({
    conversationStore: store,
    cleanupExternalState: async () => {
      cleanupCalls += 1;
      await cleanupGate;
    },
    onDeleted: () => {
      deletedCallbacks += 1;
    },
  });

  const first = execute(command);
  const second = execute(command);
  expect(cleanupCalls).toBe(1);
  releaseCleanup();
  expect(await first).toEqual({ ok: true, alreadyDeleted: false });
  expect(await second).toEqual({ ok: true, alreadyDeleted: false });
  expect(deletedCallbacks).toBe(1);
  expect(await execute(command)).toEqual({ ok: true, alreadyDeleted: true });
});
