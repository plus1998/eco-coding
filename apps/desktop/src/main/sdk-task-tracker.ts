import type { SdkTodoUpdatedPayload } from "@eco/runtime";
import type { CoderTodoItem, CoderTodoStatus } from "../shared/ipc";
import {
  completeRunningCoderTodos,
  normalizeTaskTitle,
  todoListSignature,
  updateCoderTodoStatus,
} from "./coder-tasks.js";
import { coderTodosFromTodoWrite, parseTodoWriteToolInput } from "./todo-write.js";

type AgentEventLike = { type: string; payload: unknown };

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
  observeEvent: (event: AgentEventLike) => void;
  completeRunning: (status: Extract<CoderTodoStatus, "completed" | "blocked" | "cancelled">) => void;
} {
  let todos = store.listTodos();
  let signature = todoListSignature(todos);
  let positionCounter = todos.reduce((max, todo) => Math.max(max, todo.position + 1), 0);
  const sdkTaskIds = new Map<string, string>();
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
    const next = coderTodosFromTodoWrite(threadId, items, todos);
    positionCounter = next.length;
    persist(next);
  };

  const applyTaskCreateTool = (input: Record<string, unknown>) => {
    progressFromSdk = true;
    const subject = typeof input.subject === "string" ? input.subject.trim() : "";
    if (!subject) {
      return;
    }
    const activeForm =
      typeof input.activeForm === "string" && input.activeForm.trim() ? input.activeForm.trim() : undefined;
    const description =
      typeof input.description === "string" && input.description.trim() ? input.description.trim() : subject;
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
    const sdkTaskId = typeof input.taskId === "string" ? input.taskId : "";
    if (!sdkTaskId) {
      return;
    }
    let todoId = todoIdForSdkTask(sdkTaskId);
    if (!todoId) {
      todoId = `${threadId}:sdk-task:${sdkTaskId}`;
      linkSdkTask(sdkTaskId, todoId);
    }

    const now = new Date().toISOString();
    const status = mapSdkTaskStatus(typeof input.status === "string" ? input.status : undefined);
    const subject = typeof input.subject === "string" ? input.subject.trim() : "";
    const activeForm =
      typeof input.activeForm === "string" && input.activeForm.trim() ? input.activeForm.trim() : undefined;
    const description =
      typeof input.description === "string" && input.description.trim() ? input.description.trim() : undefined;

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
          ...(status ? { status } : {}),
          updatedAt: now,
        };
      }),
    );
  };

  const applyTaskStarted = (payload: SdkTodoUpdatedPayload) => {
    if (payload.skip_transcript) {
      return;
    }
    progressFromSdk = true;
    const title = payload.description?.trim() || "Task";
    const detail = payload.prompt?.trim() || payload.description?.trim() || title;
    const todoId = `${threadId}:sdk-task:${payload.task_id}`;
    linkSdkTask(payload.task_id, todoId);

    if (payload.subagent_type) {
      const match = findTodoByTitle(todos, title);
      if (match) {
        linkSdkTask(payload.task_id, match.id);
        persist(updateCoderTodoStatus(todos, match.id, "running"));
      }
      return;
    }

    const existing = todos.find((todo) => todo.id === todoId);
    const now = new Date().toISOString();
    if (existing) {
      persist(
        todos.map((todo) =>
          todo.id === todoId
            ? {
                ...todo,
                title,
                detail,
                updatedAt: now,
              }
            : todo,
        ),
      );
      return;
    }

    persist([
      ...todos,
      {
        id: todoId,
        threadId,
        title,
        detail,
        status: "pending",
        position: positionCounter++,
        updatedAt: now,
      },
    ]);
  };

  const applyTaskUpdated = (payload: SdkTodoUpdatedPayload) => {
    progressFromSdk = true;
    const todoId = todoIdForSdkTask(payload.task_id) ?? `${threadId}:sdk-task:${payload.task_id}`;
    linkSdkTask(payload.task_id, todoId);
    const patch = payload.patch;
    if (!patch) {
      return;
    }

    const status = mapSdkTaskStatus(patch.status);
    const now = new Date().toISOString();
    const existing = todos.find((todo) => todo.id === todoId);
    if (!existing) {
      if (patch.status === "deleted") {
        return;
      }
      persist([
        ...todos,
        {
          id: todoId,
          threadId,
          title: patch.description?.trim() || "Task",
          detail: patch.description?.trim() || "Task",
          status: status ?? "pending",
          position: positionCounter++,
          updatedAt: now,
        },
      ]);
      return;
    }

    if (patch.status === "deleted") {
      persist(todos.filter((todo) => todo.id !== todoId));
      sdkTaskIds.delete(payload.task_id);
      return;
    }

    persist(
      todos.map((todo) => {
        if (todo.id !== todoId) {
          return todo;
        }
        return {
          ...todo,
          ...(patch.description ? { detail: patch.description, title: patch.description } : {}),
          ...(status ? { status } : {}),
          updatedAt: now,
        };
      }),
    );
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

  const applySdkTodoUpdated = (payload: SdkTodoUpdatedPayload) => {
    if (payload.sdkKind === "task_started") {
      applyTaskStarted(payload);
      return;
    }
    if (payload.sdkKind === "task_updated") {
      applyTaskUpdated(payload);
      return;
    }
    if (payload.sdkKind === "task_progress") {
      applyTaskProgress(payload);
    }
  };

  return {
    observeEvent(event) {
      if (event.type === "todo.updated" && isRecord(event.payload)) {
        applySdkTodoUpdated(event.payload as SdkTodoUpdatedPayload);
        return;
      }

      if (event.type !== "tool.started" || !isRecord(event.payload)) {
        return;
      }

      const toolName = event.payload.tool_name;
      const input = event.payload.input;
      if (!isRecord(input)) {
        return;
      }

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
    completeRunning(status) {
      if (!progressFromSdk && todos.length === 0) {
        return;
      }
      persist(completeRunningCoderTodos(todos, status));
    },
  };
}
