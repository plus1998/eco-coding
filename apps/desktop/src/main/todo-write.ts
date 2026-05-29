import type { CoderTodoItem, CoderTodoStatus } from "../shared/ipc";
import { normalizeTaskTitle } from "./coder-tasks.js";

/** One item from Claude Code `TodoWrite` (Codex `update_plan` equivalent). */
export interface TodoWriteItem {
  content: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
}

export function parseTodoWriteToolInput(input: Record<string, unknown>): TodoWriteItem[] {
  const raw = input.todos;
  if (!Array.isArray(raw)) {
    return [];
  }

  const items: TodoWriteItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const content = typeof record.content === "string" ? record.content.trim() : "";
    if (!content) {
      continue;
    }
    const status = normalizeTodoWriteStatus(record.status);
    const activeForm =
      typeof record.activeForm === "string" && record.activeForm.trim()
        ? record.activeForm.trim()
        : undefined;
    items.push({ content, ...(activeForm && { activeForm }), status });
  }
  return items;
}

function normalizeTodoWriteStatus(value: unknown): TodoWriteItem["status"] {
  if (value === "in_progress" || value === "completed" || value === "pending") {
    return value;
  }
  return "pending";
}

export function mapTodoWriteStatusToCoder(status: TodoWriteItem["status"]): CoderTodoStatus {
  if (status === "in_progress") {
    return "running";
  }
  if (status === "completed") {
    return "completed";
  }
  return "pending";
}

/**
 * Replaces the progress list from a TodoWrite call (full list each time, like Codex update_plan).
 * Matches prior items by normalized title to keep stable ids across updates.
 */
export function coderTodosFromTodoWrite(
  threadId: string,
  items: TodoWriteItem[],
  existing: CoderTodoItem[] = [],
  now = new Date().toISOString(),
): CoderTodoItem[] {
  const existingByTitle = new Map(existing.map((item) => [normalizeTaskTitle(item.title), item]));

  return items.map((item, index) => {
    const title = item.content;
    const previous = existingByTitle.get(normalizeTaskTitle(title));
    const detail = item.activeForm?.trim() || title;
    return {
      id: previous?.id ?? `${threadId}:progress:${index}`,
      threadId,
      title,
      detail,
      status: mapTodoWriteStatusToCoder(item.status),
      position: index,
      updatedAt: now,
    };
  });
}
