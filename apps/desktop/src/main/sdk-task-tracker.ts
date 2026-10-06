import type { EcoTaskTrackerHooks } from "@eco/runtime";
import type { SdkTodoUpdatedPayload } from "@eco/runtime/sdk";
import type { CoderTodoItem, CoderTodoStatus } from "../shared/ipc";
import {
  completeRunningCoderTodos,
  normalizeTaskTitle,
  todoListSignature,
  updateCoderTodoStatus,
} from "./coder-tasks.js";
import { coderTodosFromTodoWrite, parseTodoWriteToolInput } from "./todo-write.js";

export interface SdkTaskTrackerStore {
  listTodos(): CoderTodoItem[];
  replaceTodos(todos: CoderTodoItem[]): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapSdkTaskStatus(status: string | undefined): CoderTodoStatus | undefined {
  switch (status) {
    case "pending":
    case "paused":
      return "pending";
    case "running":
    case "in_progress":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "blocked";
    case "killed":
      return "cancelled";
    default:
      return undefined;
  }
}

/** Failure/cancel may overlay a completed todo; a later completed/running must not hide a failure. */
function shouldApplyTodoStatus(from: CoderTodoStatus, to: CoderTodoStatus): boolean {
  if (from === to) {
    return true;
  }
  if (to === "blocked" || to === "cancelled") {
    return true;
  }
  if (from === "blocked" || from === "cancelled") {
    return false;
  }
  return true;
}

function readString(input: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function findTodoByTitle(todos: CoderTodoItem[], title: string): CoderTodoItem | undefined {
  const normalized = normalizeTaskTitle(title);
  if (!normalized) {
    return undefined;
  }
  return todos.find((todo) => {
    const todoTitle = normalizeTaskTitle(todo.title);
    return todoTitle === normalized || normalized.includes(todoTitle) || todoTitle.includes(normalized);
  });
}

function reorderTodos(todos: CoderTodoItem[]): CoderTodoItem[] {
  return todos
    .slice()
    .sort((left, right) => left.position - right.position)
    .map((todo, index) => (todo.position === index ? todo : { ...todo, position: index }));
}

export function createSdkTaskTracker(
  threadId: string,
  store: SdkTaskTrackerStore,
  emitTodoList: (threadId: string, todos: CoderTodoItem[]) => void,
): {
  handleTaskProgress: (payload: SdkTodoUpdatedPayload) => void;
  createHookHandlers: (getStopStatus?: () => "completed" | "blocked" | "cancelled") => EcoTaskTrackerHooks;
} {
  let todos = store.listTodos();
  let signature = todoListSignature(todos);
  let positionCounter = todos.reduce((max, todo) => Math.max(max, todo.position + 1), 0);
  const sdkTaskIds = new Map<string, string>();
  const subagentTodoLinks = new Map<string, string>();
  let progressFromSdk = false;

  const persist = (nextTodos: CoderTodoItem[]) => {
    const ordered = reorderTodos(nextTodos);
    const nextSignature = todoListSignature(ordered);
    if (nextSignature === signature) {
      todos = ordered;
      return;
    }
    todos = ordered;
    signature = nextSignature;
    store.replaceTodos(todos);
    emitTodoList(threadId, todos);
  };

  const linkSdkTask = (sdkTaskId: string, todoId: string) => {
    sdkTaskIds.set(sdkTaskId, todoId);
  };

  const todoIdForSdkTask = (sdkTaskId: string): string | undefined => sdkTaskIds.get(sdkTaskId);

  const applyTodoWrite = (input: Record<string, unknown>) => {
    const items = parseTodoWriteToolInput(input);
    if (items.length === 0) {
      return;
    }
    progressFromSdk = true;
    sdkTaskIds.clear();
    subagentTodoLinks.clear();
    const next = coderTodosFromTodoWrite(threadId, items, todos);
    positionCounter = next.length;
    persist(next);
  };

  const applyTaskCreateTool = (input: Record<string, unknown>) => {
    progressFromSdk = true;
    const subject = readString(input, "subject", "task_subject", "title", "content");
    if (!subject) {
      return;
    }
    const activeForm = readString(input, "activeForm", "active_form") || undefined;
    const description = readString(input, "description", "task_description") || subject;
    const existing = findTodoByTitle(todos, subject);
    if (existing) {
      return;
    }
    const id = `${threadId}:sdk-task:pending:${positionCounter}`;
    const now = new Date().toISOString();
    persist([
      ...todos,
      {
        id,
        threadId,
        title: subject,
        detail: activeForm ?? description,
        status: "pending",
        position: positionCounter++,
        updatedAt: now,
      },
    ]);
  };

  const applyTaskUpdateTool = (input: Record<string, unknown>) => {
    progressFromSdk = true;
    const sdkTaskId = readString(input, "taskId", "task_id", "id");
    if (!sdkTaskId) {
      return;
    }
    const subject = readString(input, "subject", "task_subject", "title", "content");
    let todoId = todoIdForSdkTask(sdkTaskId);
    if (!todoId) {
      todoId = subject ? findTodoByTitle(todos, subject)?.id : undefined;
    }
    if (!todoId) {
      todoId = `${threadId}:sdk-task:${sdkTaskId}`;
    }
    if (todoIdForSdkTask(sdkTaskId) !== todoId) {
      linkSdkTask(sdkTaskId, todoId);
    }

    const now = new Date().toISOString();
    const status = mapSdkTaskStatus(typeof input.status === "string" ? input.status : undefined);
    const activeForm = readString(input, "activeForm", "active_form") || undefined;
    const description = readString(input, "description", "task_description") || undefined;

    if (input.status === "deleted") {
      persist(todos.filter((todo) => todo.id !== todoId));
      sdkTaskIds.delete(sdkTaskId);
      return;
    }

    const existing = todos.find((todo) => todo.id === todoId);
    if (!existing) {
      persist([
        ...todos,
        {
          id: todoId,
          threadId,
          title: subject || "Task",
          detail: activeForm ?? description ?? subject ?? "Task",
          status: status ?? "pending",
          position: positionCounter++,
          updatedAt: now,
        },
      ]);
      return;
    }

    persist(
      todos.map((todo) => {
        if (todo.id !== todoId) {
          return todo;
        }
        return {
          ...todo,
          ...(subject ? { title: subject } : {}),
          ...(activeForm ? { detail: activeForm } : description ? { detail: description } : {}),
          ...(status && shouldApplyTodoStatus(todo.status, status) ? { status } : {}),
          updatedAt: now,
        };
      }),
    );
  };

  const applyTaskCreated = (input: { taskId: string; subject: string; description?: string }) => {
    progressFromSdk = true;
    const subject = input.subject.trim();
    if (!subject) {
      return;
    }
    const todoId = `${threadId}:sdk-task:${input.taskId}`;
    linkSdkTask(input.taskId, todoId);
    const existing = todos.find((todo) => todo.id === todoId) ?? findTodoByTitle(todos, subject);
    if (existing) {
      linkSdkTask(input.taskId, existing.id);
      return;
    }
    const now = new Date().toISOString();
    persist([
      ...todos,
      {
        id: todoId,
        threadId,
        title: subject,
        detail: input.description?.trim() || subject,
        status: "pending",
        position: positionCounter++,
        updatedAt: now,
      },
    ]);
  };

  const applyTaskCompleted = (input: { taskId: string; subject: string }) => {
    progressFromSdk = true;
    const todoId = todoIdForSdkTask(input.taskId) ?? `${threadId}:sdk-task:${input.taskId}`;
    linkSdkTask(input.taskId, todoId);
    const existing = todos.find((todo) => todo.id === todoId);
    if (!existing) {
      const subject = input.subject.trim() || "Task";
      const now = new Date().toISOString();
      persist([
        ...todos,
        {
          id: todoId,
          threadId,
          title: subject,
          detail: subject,
          status: "completed",
          position: positionCounter++,
          updatedAt: now,
        },
      ]);
      return;
    }
    const existingStatus = existing.status;
    if (!shouldApplyTodoStatus(existingStatus, "completed")) {
      return;
    }
    persist(updateCoderTodoStatus(todos, todoId, "completed"));
  };

  const applySubagentStart = (input: { agentId: string; agentType: string; todoId?: string }) => {
    progressFromSdk = true;
    const explicitTodoId = input.todoId?.trim();
    const linkedTodoId =
      (explicitTodoId && todos.some((todo) => todo.id === explicitTodoId) ? explicitTodoId : undefined) ??
      todoIdForSdkTask(input.agentId);
    if (!linkedTodoId) {
      return;
    }
    subagentTodoLinks.set(input.agentId, linkedTodoId);
    persist(updateCoderTodoStatus(todos, linkedTodoId, "running"));
  };

  const applySubagentStop = (input: {
    agentId: string;
    agentType: string;
    failed?: boolean;
    cancelled?: boolean;
    reason?: string;
  }) => {
    progressFromSdk = true;
    const status: CoderTodoStatus = input.failed ? "blocked" : input.cancelled ? "cancelled" : "completed";
    const detail = input.reason?.trim();
    const applyStatus = (todoId: string) => {
      const now = new Date().toISOString();
      persist(
        todos.map((todo) => {
          if (todo.id !== todoId || !shouldApplyTodoStatus(todo.status, status)) {
            return todo;
          }
          return {
            ...todo,
            status,
            ...(detail && { detail }),
            updatedAt: now,
          };
        }),
      );
    };
    const linkedTodoId = subagentTodoLinks.get(input.agentId) ?? todoIdForSdkTask(input.agentId);
    if (linkedTodoId) {
      applyStatus(linkedTodoId);
      subagentTodoLinks.delete(input.agentId);
      return;
    }
    const constructed = `${threadId}:sdk-task:${input.agentId}`;
    if (todos.some((todo) => todo.id === constructed)) {
      applyStatus(constructed);
      return;
    }
    const running = todos.find((todo) => todo.status === "running");
    if (running) {
      applyStatus(running.id);
    }
  };

  const applyTaskProgress = (payload: SdkTodoUpdatedPayload) => {
    if (payload.skip_transcript) {
      return;
    }
    const todoId = todoIdForSdkTask(payload.task_id);
    if (!todoId) {
      return;
    }
    const detail = payload.summary?.trim() || payload.description?.trim();
    if (!detail) {
      return;
    }
    const now = new Date().toISOString();
    persist(
      todos.map((todo) =>
        todo.id === todoId && todo.status === "running"
          ? {
              ...todo,
              detail,
              updatedAt: now,
            }
          : todo,
      ),
    );
  };

  const applyTaskNotification = (payload: SdkTodoUpdatedPayload) => {
    if (!payload.status) {
      return;
    }
    let todoId = todoIdForSdkTask(payload.task_id);
    if (!todoId) {
      const constructed = `${threadId}:sdk-task:${payload.task_id}`;
      if (todos.some((todo) => todo.id === constructed)) {
        todoId = constructed;
        linkSdkTask(payload.task_id, constructed);
      }
    }
    if (!todoId) {
      return;
    }
    progressFromSdk = true;
    const status: CoderTodoStatus =
      payload.status === "completed" ? "completed" : payload.status === "failed" ? "blocked" : "cancelled";
    const detail = payload.summary?.trim();
    const now = new Date().toISOString();
    persist(
      todos.map((todo) => {
        if (todo.id !== todoId || !shouldApplyTodoStatus(todo.status, status)) {
          return todo;
        }
        return {
          ...todo,
          status,
          ...(detail && { detail }),
          updatedAt: now,
        };
      }),
    );
  };

  const applySubagentTaskStarted = (payload: SdkTodoUpdatedPayload) => {
    if (payload.skip_transcript || !payload.subagent_type) {
      return;
    }
    progressFromSdk = true;
    const title = payload.description?.trim() || "Task";
    linkSdkTask(payload.task_id, `${threadId}:sdk-task:${payload.task_id}`);
    const match = findTodoByTitle(todos, title);
    if (match) {
      linkSdkTask(payload.task_id, match.id);
      persist(updateCoderTodoStatus(todos, match.id, "running"));
    }
  };

  const completeRunning = (status: Extract<CoderTodoStatus, "completed" | "blocked" | "cancelled">) => {
    if (!progressFromSdk && todos.length === 0) {
      return;
    }
    persist(completeRunningCoderTodos(todos, status));
  };

  return {
    handleTaskProgress(payload) {
      if (payload.ambient === true) {
        if (payload.sdkKind === "task_notification") {
          applyTaskNotification(payload);
        }
        return;
      }
      if (payload.sdkKind === "task_progress") {
        applyTaskProgress(payload);
        return;
      }
      if (payload.sdkKind === "task_started") {
        applySubagentTaskStarted(payload);
        return;
      }
      if (payload.sdkKind === "task_notification") {
        applyTaskNotification(payload);
      }
    },
    createHookHandlers(getStopStatus) {
      const peekPendingCoderTodoId = (): string | undefined => {
        const pending = todos.find((todo) => todo.status === "pending");
        return pending?.id;
      };

      return {
        peekPendingCoderTodoId,
        onPreToolUse(toolName, input) {
          if (toolName === "TodoWrite") {
            applyTodoWrite(input);
            return;
          }
          if (toolName === "TaskCreate") {
            applyTaskCreateTool(input);
            return;
          }
          if (toolName === "TaskUpdate") {
            applyTaskUpdateTool(input);
          }
        },
        onTaskCreated: applyTaskCreated,
        onTaskCompleted: applyTaskCompleted,
        onSubagentStart: applySubagentStart,
        onSubagentStop: applySubagentStop,
        onStop(status) {
          completeRunning(getStopStatus?.() ?? status);
        },
      };
    },
  };
}
