import { expect, test } from "bun:test";
import type { SdkTodoUpdatedPayload } from "@eco/runtime/sdk";
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

function createTracker(initial: CoderTodoItem[] = []) {
  const store = createMemoryStore(initial);
  const emitted: CoderTodoItem[][] = [];
  const tracker = createSdkTaskTracker(
    "thr_1",
    store,
    (_threadId, todos) => {
      emitted.push(todos);
    },
  );
  const hooks = tracker.createHookHandlers();
  return { store, emitted, tracker, hooks };
}

test("hook handlers apply TaskCreate and TaskUpdate", () => {
  const { store, hooks } = createTracker();

  hooks.onPreToolUse("TaskCreate", {
    subject: "Spawn coders",
    description: "Delegate parallel coder agents",
    activeForm: "Spawning coders",
  });

  hooks.onPreToolUse("TaskUpdate", {
    taskId: "task_2",
    status: "in_progress",
    activeForm: "Running coders",
  });

  const todos = store.getTodos();
  expect(todos.some((todo) => todo.title === "Spawn coders")).toBe(true);
  expect(todos.some((todo) => todo.id.endsWith("task_2") && todo.status === "running")).toBe(true);
});

test("hook handlers still support TodoWrite for compatibility", () => {
  const { store, hooks } = createTracker();

  hooks.onPreToolUse("TodoWrite", {
    todos: [
      { content: "Step A", status: "completed" },
      { content: "Step B", status: "in_progress", activeForm: "Working on Step B" },
    ],
  });

  const todos = store.getTodos();
  expect(todos).toHaveLength(2);
  expect(todos[1]?.status).toBe("running");
  expect(todos[1]?.detail).toBe("Working on Step B");
});

test("TaskCompleted hook marks todo completed", () => {
  const { store, hooks } = createTracker();

  hooks.onTaskCreated({ taskId: "task_1", subject: "Run architect" });
  hooks.onTaskCompleted({ taskId: "task_1", subject: "Run architect" });

  const todos = store.getTodos();
  expect(todos).toHaveLength(1);
  expect(todos[0]?.status).toBe("completed");
});

test("subagent task_started fallback marks matching checklist item running", () => {
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

  tracker.handleTaskProgress({
    sdkKind: "task_started",
    task_id: "subagent_1",
    description: "Implement panel",
    subagent_type: "coder",
  } satisfies SdkTodoUpdatedPayload);

  expect(store.getTodos()[0]?.status).toBe("running");
});

test("SubagentStart and SubagentStop update todo status", () => {
  const { store, hooks } = createTracker([
    {
      id: "thr_1:task:0",
      threadId: "thr_1",
      title: "Implement panel",
      detail: "Implement panel",
      status: "pending",
      position: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);

  hooks.onSubagentStart({ agentId: "agent_1", agentType: "coder" });
  expect(store.getTodos()[0]?.status).toBe("running");

  hooks.onSubagentStop({ agentId: "agent_1", agentType: "coder" });
  expect(store.getTodos()[0]?.status).toBe("completed");
});

test("onStop completes running todos", () => {
  const { store, hooks } = createTracker([
    {
      id: "thr_1:task:0",
      threadId: "thr_1",
      title: "Step",
      detail: "Step",
      status: "running",
      position: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);

  hooks.onStop("completed");
  expect(store.getTodos()[0]?.status).toBe("completed");
});
