import { createHash } from "node:crypto";
import type { CoderTodoItem, CoderTodoStatus } from "../shared/ipc";
import { normalizeTaskTitle } from "./coder-tasks.js";

export type AcpPlanEntryStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface AcpPlanEntry {
  content: string;
  status: AcpPlanEntryStatus;
  priority?: string;
}

export interface AcpPlanProgressServices {
  listTodos(threadId: string): CoderTodoItem[];
  replaceTodos(threadId: string, todos: CoderTodoItem[]): void;
  emitTodoList(threadId: string, todos: CoderTodoItem[]): void;
}

/** True when `todo.updated` carries Cursor ACP `sessionUpdate: "plan"` entries. */
export function isAcpPlanTodoPayload(payload: unknown): payload is {
  liveType: "acp.plan";
  entries: unknown[];
} {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    (payload as { liveType?: unknown }).liveType === "acp.plan" &&
    Array.isArray((payload as { entries?: unknown }).entries)
  );
}

/** True when `todo.updated` carries Cursor ACP `cursor/update_todos`. */
export function isAcpUpdateTodosPayload(payload: unknown): payload is {
  liveType: "acp.update_todos";
  todos: unknown[];
  merge?: boolean;
} {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    (payload as { liveType?: unknown }).liveType === "acp.update_todos" &&
    Array.isArray((payload as { todos?: unknown }).todos)
  );
}

export function parseAcpPlanEntries(entries: unknown): AcpPlanEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  const parsed: AcpPlanEntry[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const content =
      typeof record.content === "string"
        ? record.content.trim()
        : typeof record.step === "string"
          ? record.step.trim()
          : "";
    if (!content) {
      continue;
    }
    const status = mapAcpPlanEntryStatus(record.status);
    const priority = typeof record.priority === "string" ? record.priority.trim() : "";
    parsed.push({
      content,
      status,
      ...(priority ? { priority } : {}),
    });
  }
  return parsed;
}

export function applyAcpPlanProgress(input: {
  threadId: string;
  entries: unknown;
  services: AcpPlanProgressServices;
  now?: string;
}): CoderTodoItem[] {
  const plan = parseAcpPlanEntries(input.entries);
  const todos = coderTodosFromAcpPlan(
    input.threadId,
    plan,
    input.services.listTodos(input.threadId),
    input.now,
  );
  input.services.replaceTodos(input.threadId, todos);
  input.services.emitTodoList(input.threadId, todos);
  return todos;
}

export function applyAcpUpdateTodos(input: {
  threadId: string;
  todos: unknown;
  merge?: boolean;
  services: AcpPlanProgressServices;
  now?: string;
}): CoderTodoItem[] {
  const parsed = parseAcpCursorTodos(input.todos);
  const existing = input.services.listTodos(input.threadId);
  const todos = input.merge
    ? mergeAcpCursorTodos(input.threadId, parsed, existing, input.now)
    : coderTodosFromAcpCursorTodos(input.threadId, parsed, existing, input.now);
  input.services.replaceTodos(input.threadId, todos);
  input.services.emitTodoList(input.threadId, todos);
  return todos;
}

export type AcpCursorTodo = {
  id: string;
  content: string;
  status: AcpPlanEntryStatus;
};

export function parseAcpCursorTodos(todos: unknown): AcpCursorTodo[] {
  if (!Array.isArray(todos)) {
    return [];
  }
  const parsed: AcpCursorTodo[] = [];
  for (const [index, entry] of todos.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const content =
      typeof record.content === "string"
        ? record.content.trim()
        : typeof record.title === "string"
          ? record.title.trim()
          : "";
    if (!content) {
      continue;
    }
    const id =
      typeof record.id === "string" && record.id.trim() ? record.id.trim() : String(index);
    parsed.push({
      id,
      content,
      status: mapAcpPlanEntryStatus(record.status),
    });
  }
  return parsed;
}

export function coderTodosFromAcpPlan(
  threadId: string,
  plan: readonly AcpPlanEntry[],
  existing: readonly CoderTodoItem[] = [],
  now = new Date().toISOString(),
): CoderTodoItem[] {
  const existingByTitle = new Map<string, CoderTodoItem[]>();
  for (const item of existing) {
    const normalizedTitle = normalizeTaskTitle(item.title);
    const matches = existingByTitle.get(normalizedTitle) ?? [];
    matches.push(item);
    existingByTitle.set(normalizedTitle, matches);
  }
  const occurrencesByTitle = new Map<string, number>();

  return plan.map((item, position) => {
    const title = item.content.trim();
    const normalizedTitle = normalizeTaskTitle(title);
    const occurrence = occurrencesByTitle.get(normalizedTitle) ?? 0;
    occurrencesByTitle.set(normalizedTitle, occurrence + 1);
    const previous = existingByTitle.get(normalizedTitle)?.shift();
    const detail = item.priority ? `${title} (${item.priority})` : title;
    return {
      id: previous?.id ?? acpPlanTodoId(threadId, normalizedTitle, occurrence),
      threadId,
      title,
      detail,
      status: mapAcpPlanStatusToCoder(item.status),
      position,
      updatedAt: now,
    };
  });
}

function acpPlanTodoId(threadId: string, normalizedTitle: string, occurrence: number): string {
  const digest = createHash("sha256").update(normalizedTitle, "utf8").digest("hex").slice(0, 16);
  return `${threadId}:acp-plan:${digest}:${occurrence}`;
}

function acpCursorTodoId(threadId: string, cursorId: string): string {
  return `${threadId}:acp-todo:${cursorId}`;
}

function readAcpCursorTodoId(todo: CoderTodoItem, threadId: string): string | undefined {
  const prefix = `${threadId}:acp-todo:`;
  if (todo.id.startsWith(prefix)) {
    return todo.id.slice(prefix.length);
  }
  return undefined;
}

export function coderTodosFromAcpCursorTodos(
  threadId: string,
  items: readonly AcpCursorTodo[],
  existing: readonly CoderTodoItem[] = [],
  now = new Date().toISOString(),
): CoderTodoItem[] {
  const existingByCursorId = new Map<string, CoderTodoItem>();
  const existingByTitle = new Map<string, CoderTodoItem[]>();
  for (const item of existing) {
    const cursorId = readAcpCursorTodoId(item, threadId);
    if (cursorId) {
      existingByCursorId.set(cursorId, item);
    }
    const normalizedTitle = normalizeTaskTitle(item.title);
    const matches = existingByTitle.get(normalizedTitle) ?? [];
    matches.push(item);
    existingByTitle.set(normalizedTitle, matches);
  }

  return items.map((item, position) => {
    const previous =
      existingByCursorId.get(item.id) ?? existingByTitle.get(normalizeTaskTitle(item.content))?.shift();
    return {
      id: previous?.id ?? acpCursorTodoId(threadId, item.id),
      threadId,
      title: item.content,
      detail: item.content,
      status: mapAcpPlanStatusToCoder(item.status),
      position,
      updatedAt: now,
    };
  });
}

export function mergeAcpCursorTodos(
  threadId: string,
  items: readonly AcpCursorTodo[],
  existing: readonly CoderTodoItem[] = [],
  now = new Date().toISOString(),
): CoderTodoItem[] {
  if (items.length === 0) {
    return [...existing];
  }
  const updated = coderTodosFromAcpCursorTodos(threadId, items, existing, now);
  const updatedIds = new Set(updated.map((item) => item.id));
  const leftover = existing.filter((item) => !updatedIds.has(item.id));
  return [
    ...updated,
    ...leftover.map((item, index) => ({
      ...item,
      position: updated.length + index,
      updatedAt: now,
    })),
  ];
}

export function mapAcpPlanEntryStatus(value: unknown): AcpPlanEntryStatus {
  if (typeof value !== "string") {
    return "pending";
  }
  switch (value.trim().toLowerCase()) {
    case "in_progress":
    case "inprogress":
    case "running":
    case "todo_status_in_progress":
      return "in_progress";
    case "completed":
    case "complete":
    case "done":
    case "todo_status_completed":
      return "completed";
    case "cancelled":
    case "canceled":
    case "todo_status_cancelled":
    case "todo_status_canceled":
      return "cancelled";
    case "pending":
    default:
      return "pending";
  }
}

export function mapAcpPlanStatusToCoder(status: AcpPlanEntryStatus): CoderTodoStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "in_progress":
      return "running";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
  }
}
