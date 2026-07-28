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
  const tracker = createSdkTaskTracker("thr_1", store, (_threadId, todos) => {
    emitted.push(todos);
  });
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

test("hook handlers accept SDK snake_case TaskCreate and TaskUpdate input", () => {
  const { store, hooks } = createTracker();

  hooks.onPreToolUse("TaskCreate", {
    task_subject: "Wire progress list",
    task_description: "Render SDK task progress",
    active_form: "Wiring progress list",
  });

  hooks.onPreToolUse("TaskUpdate", {
    task_id: "task_3",
    task_subject: "Wire progress list",
    status: "in_progress",
    active_form: "Rendering progress list",
  });

  const todos = store.getTodos();
  expect(todos).toHaveLength(1);
  expect(todos[0]).toMatchObject({
    title: "Wire progress list",
    status: "running",
    detail: "Rendering progress list",
  });
});

test("TaskUpdate completed is reflected without waiting for another SDK hook", () => {
  const { store, hooks } = createTracker();

  hooks.onTaskCreated({ taskId: "task_1", subject: "Implement panel" });
  hooks.onPreToolUse("TaskUpdate", { taskId: "task_1", status: "completed" });

  expect(store.getTodos()[0]?.status).toBe("completed");
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

  hooks.onSubagentStart({ agentId: "agent_1", agentType: "coder", todoId: "thr_1:task:0" });
  expect(store.getTodos()[0]?.status).toBe("running");

  hooks.onSubagentStop({ agentId: "agent_1", agentType: "coder" });
  expect(store.getTodos()[0]?.status).toBe("completed");
});

test("SubagentStart does not mark the first pending todo without a structured link", () => {
  const { store, hooks } = createTracker([
    {
      id: "thr_1:task:0",
      threadId: "thr_1",
      title: "First pending",
      detail: "First pending",
      status: "pending",
      position: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);

  hooks.onSubagentStart({ agentId: "agent_1", agentType: "coder" });

  expect(store.getTodos()[0]?.status).toBe("pending");
});

test("SubagentStart resolves todo through matching SDK task id", () => {
  const { store, hooks } = createTracker();

  hooks.onTaskCreated({ taskId: "agent_1", subject: "Implement panel" });
  hooks.onSubagentStart({ agentId: "agent_1", agentType: "coder" });

  expect(store.getTodos()[0]).toMatchObject({
    title: "Implement panel",
    status: "running",
  });
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

test("task_notification completes the exact linked SDK task and preserves summary", () => {
  const snapshots: CoderTodoItem[][] = [];
  const tracker = createSdkTaskTracker(
    "thr_notification",
    {
      listTodos: () => [],
      replaceTodos: (todos) => snapshots.push(todos),
    },
    () => {},
  );
  const hooks = tracker.createHookHandlers();
  hooks.onTaskCreated({
    taskId: "task_notify",
    subject: "Inspect attribution",
    description: "Inspect attribution",
  });

  tracker.handleTaskProgress({
    sdkKind: "task_notification",
    task_id: "task_notify",
    tool_use_id: "call_notify",
    status: "completed",
    summary: "Attribution verified",
    usage: { total_tokens: 400, tool_uses: 2, duration_ms: 3000 },
  });

  expect(snapshots.at(-1)?.[0]).toMatchObject({
    status: "completed",
    detail: "Attribution verified",
  });
});
