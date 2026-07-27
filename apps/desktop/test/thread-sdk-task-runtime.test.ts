import { expect, test } from "bun:test";
import type { CoderTodoItem } from "../src/shared/ipc";
import {
  createThreadSdkTaskRuntime,
  isSdkTodoProgressPayload,
  type ThreadSdkTaskRuntimeStore,
} from "../src/main/thread-sdk-task-runtime";

function todo(input: Partial<CoderTodoItem> = {}): CoderTodoItem {
  return {
    id: "thr_1:task:0",
    threadId: "thr_1",
    title: "Implement panel",
    detail: "Implement panel",
    status: "pending",
    position: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...input,
  };
}

function memoryStore(
  initial: CoderTodoItem[] = [],
): ThreadSdkTaskRuntimeStore & { getTodos(): CoderTodoItem[] } {
  let todos = initial;
  return {
    listTodos: () => todos,
    replaceTodos: (_threadId, next) => {
      todos = next;
    },
    getTodos: () => todos,
  };
}

test("createThreadSdkTaskRuntime wires task tracker hooks through thread store and emitter", () => {
  const store = memoryStore();
  const emitted: CoderTodoItem[][] = [];
  const runtime = createThreadSdkTaskRuntime({
    threadId: "thr_1",
    store,
    emitTodoList: (_threadId, todos) => emitted.push(todos),
  });

  runtime.taskRunHooks.hookContextExtras.taskTracker?.onPreToolUse("TaskCreate", {
    subject: "Spawn coders",
    description: "Delegate parallel coder agents",
  });

  expect(store.getTodos()[0]).toMatchObject({
    threadId: "thr_1",
    title: "Spawn coders",
    status: "pending",
  });
  expect(emitted).toHaveLength(1);
  expect(runtime.taskRunHooks.hookContextExtras.getStopTodoStatus?.()).toBe("completed");
  expect(runtime.taskRunHooks.getCompletionState()).toMatchObject({
    hasSubstantiveToolUse: false,
    openTasks: [{ title: "Spawn coders", status: "pending" }],
  });
});

test("thread SDK task runtime handles todo.updated progress events only", () => {
  const store = memoryStore([todo()]);
  const runtime = createThreadSdkTaskRuntime({
    threadId: "thr_1",
    store,
    emitTodoList: () => undefined,
  });

  expect(runtime.handleEvent({ type: "tool.started", payload: { sdkKind: "task_started" } })).toBe(false);
  expect(runtime.handleEvent({ type: "todo.updated", payload: {} })).toBe(false);
  expect(
    runtime.handleEvent({
      type: "todo.updated",
      payload: {
        sdkKind: "task_started",
        task_id: "subagent_1",
        description: "Implement panel",
        subagent_type: "coder",
      },
    }),
  ).toBe(true);

  expect(store.getTodos()[0]?.status).toBe("running");
});

test("isSdkTodoProgressPayload requires structured SDK todo payload marker", () => {
  expect(isSdkTodoProgressPayload({ sdkKind: "task_started" })).toBe(true);
  expect(isSdkTodoProgressPayload(null)).toBe(false);
  expect(isSdkTodoProgressPayload("todo.updated")).toBe(false);
});
