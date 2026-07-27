import type { SdkTodoUpdatedPayload } from "@eco/runtime/sdk";
import type { CoderTodoItem } from "../shared/ipc";
import { createSdkTaskRunHooks, type SdkTaskRunHooks } from "./sdk-task-run-hooks";
import { createSdkTaskTracker } from "./sdk-task-tracker";

export interface ThreadSdkTaskRuntimeStore {
  listTodos(threadId: string): CoderTodoItem[];
  replaceTodos(threadId: string, todos: CoderTodoItem[]): void;
}

export interface ThreadSdkTaskRuntimeEvent {
  type: string;
  payload: unknown;
}

export interface ThreadSdkTaskRuntime {
  taskRunHooks: SdkTaskRunHooks;
  handleEvent(event: ThreadSdkTaskRuntimeEvent): boolean;
}

export function isSdkTodoProgressPayload(payload: unknown): payload is SdkTodoUpdatedPayload {
  return typeof payload === "object" && payload !== null && "sdkKind" in payload;
}

export function createThreadSdkTaskRuntime(input: {
  threadId: string;
  store: ThreadSdkTaskRuntimeStore;
  emitTodoList(threadId: string, todos: CoderTodoItem[]): void;
}): ThreadSdkTaskRuntime {
  const { threadId, store } = input;
  const todoTracker = createSdkTaskTracker(
    threadId,
    {
      listTodos: () => store.listTodos(threadId),
      replaceTodos: (todos) => store.replaceTodos(threadId, todos),
    },
    input.emitTodoList,
  );
  const taskRunHooks = createSdkTaskRunHooks({
    createHookHandlers: (getStopStatus) => todoTracker.createHookHandlers(getStopStatus),
    getCompletionState: todoTracker.getCompletionState,
  });

  return {
    taskRunHooks,
    handleEvent(event) {
      if (event.type !== "todo.updated" || !isSdkTodoProgressPayload(event.payload)) {
        return false;
      }
      todoTracker.handleTaskProgress(event.payload);
      return true;
    },
  };
}
