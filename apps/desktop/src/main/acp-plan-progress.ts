import { createHash } from "node:crypto";
import type { CoderTodoItem, CoderTodoStatus } from "../shared/ipc";
import { normalizeTaskTitle } from "./coder-tasks.js";

export type AcpPlanEntryStatus = "pending" | "in_progress" | "completed";

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

export function mapAcpPlanEntryStatus(value: unknown): AcpPlanEntryStatus {
  if (typeof value !== "string") {
    return "pending";
  }
  switch (value.trim().toLowerCase()) {
    case "in_progress":
    case "inprogress":
    case "running":
      return "in_progress";
    case "completed":
    case "complete":
    case "done":
      return "completed";
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
  }
}
