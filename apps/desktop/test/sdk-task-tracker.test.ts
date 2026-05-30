import { expect, test } from "bun:test";
import type { SdkTodoUpdatedPayload } from "@eco/runtime";
import type { CoderTodoItem } from "../src/shared/ipc";
import { createSdkTaskTracker } from "../src/main/sdk-task-tracker";

function createMemoryStore(initial: CoderTodoItem[] = []) {
  let todos = initial;
  return {
    listTodos: () => todos,
    replaceTodos: (next: CoderTodoItem[]) => {
      todos = next;
    },
    getTodos: () => todos,
  };
}

test("createSdkTaskTracker applies SDK task_started and task_updated", () => {
  const store = createMemoryStore();
  const emitted: CoderTodoItem[][] = [];
  const tracker = createSdkTaskTracker(
    "thr_1",
    store,
    (_threadId, todos) => {
      emitted.push(todos);
    },
  );

  tracker.observeEvent({
    type: "todo.updated",
    payload: {
      sdkKind: "task_started",
      task_id: "task_1",
      description: "Run architect",
    } satisfies SdkTodoUpdatedPayload,
  });

  tracker.observeEvent({
    type: "todo.updated",
    payload: {
      sdkKind: "task_updated",
      task_id: "task_1",
      patch: { status: "running" },
    } satisfies SdkTodoUpdatedPayload,
  });

  tracker.observeEvent({
    type: "todo.updated",
    payload: {
      sdkKind: "task_updated",
      task_id: "task_1",
      patch: { status: "completed" },
    } satisfies SdkTodoUpdatedPayload,
  });

  const todos = store.getTodos();
  expect(todos).toHaveLength(1);
  expect(todos[0]?.title).toBe("Run architect");
  expect(todos[0]?.status).toBe("completed");
  expect(emitted.length).toBeGreaterThan(0);
});

test("createSdkTaskTracker handles TaskCreate and TaskUpdate tools", () => {
  const store = createMemoryStore();
  const tracker = createSdkTaskTracker("thr_1", store, () => {});

  tracker.observeEvent({
    type: "tool.started",
    payload: {
      tool_name: "TaskCreate",
      input: {
        subject: "Spawn coders",
        description: "Delegate parallel coder agents",
        activeForm: "Spawning coders",
      },
    },
  });

  tracker.observeEvent({
    type: "tool.started",
    payload: {
      tool_name: "TaskUpdate",
      input: {
        taskId: "task_2",
        status: "in_progress",
        activeForm: "Running coders",
      },
    },
  });

  const todos = store.getTodos();
  expect(todos.some((todo) => todo.title === "Spawn coders")).toBe(true);
  expect(todos.some((todo) => todo.id.endsWith("task_2") && todo.status === "running")).toBe(true);
});

test("createSdkTaskTracker still supports TodoWrite for compatibility", () => {
  const store = createMemoryStore();
  const tracker = createSdkTaskTracker("thr_1", store, () => {});

  tracker.observeEvent({
    type: "tool.started",
    payload: {
      tool_name: "TodoWrite",
      input: {
        todos: [
          { content: "Step A", status: "completed" },
          { content: "Step B", status: "in_progress", activeForm: "Working on Step B" },
        ],
      },
    },
  });

  const todos = store.getTodos();
  expect(todos).toHaveLength(2);
  expect(todos[1]?.status).toBe("running");
  expect(todos[1]?.detail).toBe("Working on Step B");
});

test("subagent task_started marks matching checklist item running", () => {
  const store = createMemoryStore([
    {
      id: "thr_1:sdk-task:task_1",
      threadId: "thr_1",
      title: "Implement panel",
      detail: "Implement panel",
      status: "pending",
      position: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  const tracker = createSdkTaskTracker("thr_1", store, () => {});

  tracker.observeEvent({
    type: "todo.updated",
    payload: {
      sdkKind: "task_started",
      task_id: "subagent_1",
      description: "Implement panel",
      subagent_type: "coder",
    } satisfies SdkTodoUpdatedPayload,
  });

  expect(store.getTodos()[0]?.status).toBe("running");
});
