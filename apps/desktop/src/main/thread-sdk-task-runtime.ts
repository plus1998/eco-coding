import type { EcoTaskTrackerHooks } from "@eco/runtime";
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
  });

  return {
    taskRunHooks,
    handleEvent(event) {
      if (event.type === "todo.updated" && isSdkTodoProgressPayload(event.payload)) {
        todoTracker.handleTaskProgress(event.payload);
        return true;
      }
      const tracker = taskRunHooks.hookContextExtras.taskTracker;
      if (!tracker) {
        return false;
      }
      if (applyFailedAgentOutputToTracker(tracker, event)) {
        return true;
      }
      return applyFailedAgentToolToTracker(tracker, event);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function applyFailedAgentOutputToTracker(
  tracker: EcoTaskTrackerHooks,
  event: ThreadSdkTaskRuntimeEvent,
): boolean {
  if (event.type !== "agent.completed" || !isRecord(event.payload) || event.payload.type !== "agent_output") {
    return false;
  }
  const failed =
    event.payload.failed === true || event.payload.status === "failed" || event.payload.status === "error";
  if (!failed) {
    return false;
  }
  const agentId =
    (typeof event.payload.agentId === "string" && event.payload.agentId.trim()) ||
    (typeof event.payload.agent_id === "string" && event.payload.agent_id.trim()) ||
    "";
  if (!agentId) {
    return false;
  }
  const agentType =
    (typeof event.payload.agentType === "string" && event.payload.agentType.trim()) ||
    (typeof event.payload.subagent_type === "string" && event.payload.subagent_type.trim()) ||
    "explore";
  const reason =
    (typeof event.payload.error === "string" && event.payload.error.trim()) ||
    (typeof event.payload.message === "string" && event.payload.message.trim()) ||
    undefined;
  tracker.onSubagentStop({
    agentId,
    agentType,
    failed: true,
    ...(reason && { reason }),
  });
  return true;
}

function applyFailedAgentToolToTracker(
  tracker: EcoTaskTrackerHooks,
  event: ThreadSdkTaskRuntimeEvent,
): boolean {
  if (event.type !== "tool.failed" || !isRecord(event.payload)) {
    return false;
  }
  const toolName = typeof event.payload.tool_name === "string" ? event.payload.tool_name.trim() : "";
  if (toolName !== "Task" && toolName !== "Agent") {
    return false;
  }
  const message = typeof event.payload.message === "string" ? event.payload.message.trim() : "";
  if (!/terminated early due to an API error|API Error:\s*\d{3}/i.test(message)) {
    return false;
  }
  const agentId =
    (typeof event.payload.tool_use_id === "string" && event.payload.tool_use_id.trim()) || "unknown-subagent";
  tracker.onSubagentStop({
    agentId,
    agentType: "explore",
    failed: true,
    reason: message,
  });
  return true;
}
