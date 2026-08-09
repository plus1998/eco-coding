import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyCodexTurnPlanProgress,
  coderTodosFromCodexTurnPlan,
  mapCodexTurnPlanStatus,
} from "../src/main/codex-turn-plan-progress";
import { createConversationStore } from "../src/main/conversation-store";
import type { CoderTodoItem, ThreadSummary } from "../src/shared/ipc";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

test("Codex turn plan maps native statuses and preserves ids by normalized step text", () => {
  const first = coderTodosFromCodexTurnPlan(
    "thr_1",
    [
      { step: "Inspect protocol", status: "completed" },
      { step: "Wire progress", status: "inProgress" },
    ],
    [],
    "2026-08-09T00:00:00.000Z",
  );
  const second = coderTodosFromCodexTurnPlan(
    "thr_1",
    [
      { step: " wire   progress ", status: "completed" },
      { step: "Run tests", status: "pending" },
    ],
    first,
    "2026-08-09T00:01:00.000Z",
  );

  expect(mapCodexTurnPlanStatus("pending")).toBe("pending");
  expect(mapCodexTurnPlanStatus("inProgress")).toBe("running");
  expect(mapCodexTurnPlanStatus("completed")).toBe("completed");
  expect(first[1]?.status).toBe("running");
  expect(second).toHaveLength(2);
  expect(second[0]?.id).toBe(first[1]?.id);
  expect(second[0]).toMatchObject({
    title: "wire   progress",
    status: "completed",
    position: 0,
    updatedAt: "2026-08-09T00:01:00.000Z",
  });
  expect(second[1]?.id).not.toBe(first[1]?.id);

  const duplicates = coderTodosFromCodexTurnPlan(
    "thr_1",
    [
      { step: "Repeat task", status: "pending" },
      { step: "Repeat task", status: "inProgress" },
    ],
    [],
    "2026-08-09T00:02:00.000Z",
  );
  const advancedDuplicates = coderTodosFromCodexTurnPlan(
    "thr_1",
    [
      { step: " repeat   task ", status: "completed" },
      { step: "Repeat task", status: "completed" },
    ],
    duplicates,
    "2026-08-09T00:03:00.000Z",
  );
  expect(new Set(duplicates.map((todo) => todo.id)).size).toBe(2);
  expect(advancedDuplicates.map((todo) => todo.id)).toEqual(duplicates.map((todo) => todo.id));
});

test("Codex turn plan applies an authoritative replacement and emits the persisted snapshot", () => {
  let stored: CoderTodoItem[] = [
    {
      id: "old",
      threadId: "thr_1",
      title: "Old task",
      detail: "Old task",
      status: "running",
      position: 0,
      updatedAt: "2026-08-08T00:00:00.000Z",
    },
  ];
  const emitted: CoderTodoItem[][] = [];
  const services = {
    listTodos: () => stored,
    replaceTodos: (_threadId: string, todos: CoderTodoItem[]) => {
      stored = todos;
    },
    emitTodoList: (_threadId: string, todos: CoderTodoItem[]) => emitted.push(todos),
  };

  applyCodexTurnPlanProgress({
    threadId: "thr_1",
    plan: [{ step: "New task", status: "inProgress" }],
    services,
    now: "2026-08-09T00:00:00.000Z",
  });

  expect(stored).toEqual(emitted[0]);
  expect(stored).toMatchObject([
    {
      title: "New task",
      status: "running",
      position: 0,
    },
  ]);

  applyCodexTurnPlanProgress({
    threadId: "thr_1",
    plan: [],
    services,
    now: "2026-08-09T00:01:00.000Z",
  });

  expect(stored).toEqual([]);
  expect(emitted.at(-1)).toEqual([]);
});

test.skipIf(!sqliteAvailable)("Codex turn plan snapshots persist in the existing todo store", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-codex-plan-progress-"));
  const dbPath = path.join(dir, "eco.sqlite");
  const store = await createConversationStore(dbPath);
  const now = "2026-08-09T00:00:00.000Z";
  const thread: ThreadSummary = {
    id: "thr_persisted_plan",
    title: "Persisted plan",
    prompt: "Implement plan progress",
    workspacePath: dir,
    status: "running",
    message: "Working",
    createdAt: now,
    updatedAt: now,
  };
  store.saveThread(thread);

  const emitted: CoderTodoItem[][] = [];
  applyCodexTurnPlanProgress({
    threadId: thread.id,
    plan: [{ step: "Persist progress", status: "inProgress" }],
    services: {
      listTodos: (threadId) => store.listCoderTodos(threadId),
      replaceTodos: (threadId, todos) => store.replaceCoderTodos(threadId, todos),
      emitTodoList: (_threadId, todos) => emitted.push(todos),
    },
    now,
  });

  expect(store.listCoderTodos(thread.id)).toEqual(emitted[0]);
  const reopened = await createConversationStore(dbPath);
  expect(reopened.listCoderTodos(thread.id)).toMatchObject([
    { title: "Persist progress", status: "running", position: 0 },
  ]);
});
