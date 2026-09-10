import { expect, test } from "bun:test";
import type { ConversationStore } from "../src/main/conversation-store";
import { createThreadRunEventLivePersister } from "../src/main/thread-run-event-live-persist";
import { ThreadLiveRequestRegistry } from "../src/main/thread-live-request-registry";

function createPersisterHarness() {
  const appended: unknown[] = [];
  const projectionUpdates: Array<{ threadId: string; options?: { streaming?: boolean } }> = [];
  const store = {
    getThread: (threadId: string) => ({ id: threadId, status: "running" }),
    appendThreadRunEvent: (event: unknown) => {
      appended.push(event);
      return event;
    },
  } as unknown as ConversationStore;

  const persister = createThreadRunEventLivePersister({
    store,
    lifecycle: {} as never,
    metricsRegistry: {} as never,
    liveRequestRegistry: new ThreadLiveRequestRegistry(),
    resolveCurrentRunAttemptId: () => "att_1",
    resolveAgentIdByParentToolUseId: () => undefined,
    emitRequestTerminalEvent: () => {},
    onProjectionUpdated: (threadId, options) => {
      projectionUpdates.push({ threadId, ...(options ? { options } : {}) });
    },
  });

  return { persister, appended, projectionUpdates };
}

test("persistFromLiveEvent still schedules projection for omitted thread.completed", () => {
  const { persister, appended, projectionUpdates } = createPersisterHarness();

  persister.persistFromLiveEvent({
    threadId: "thr_1",
    type: "thread.completed",
    displayMessage: "状态已更新",
    role: "system",
    stream: false,
  });

  expect(appended).toEqual([]);
  expect(projectionUpdates).toEqual([{ threadId: "thr_1", options: { streaming: false } }]);
});

test("persistFromLiveEvent still schedules projection for omitted thread.started", () => {
  const { persister, appended, projectionUpdates } = createPersisterHarness();

  persister.persistFromLiveEvent({
    threadId: "thr_1",
    type: "thread.started",
    displayMessage: "状态已更新",
    role: "system",
    stream: false,
  });

  expect(appended).toEqual([]);
  expect(projectionUpdates).toEqual([{ threadId: "thr_1", options: { streaming: false } }]);
});
