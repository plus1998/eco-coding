import { createHash } from "node:crypto";
import type { CodexTurnPlanStep, CodexTurnPlanStepStatus } from "@eco/runtime";
import type { CoderTodoItem, CoderTodoStatus } from "../shared/ipc";
import { normalizeTaskTitle } from "./coder-tasks.js";

export interface CodexTurnPlanProgressServices {
  listTodos(threadId: string): CoderTodoItem[];
  replaceTodos(threadId: string, todos: CoderTodoItem[]): void;
  emitTodoList(threadId: string, todos: CoderTodoItem[]): void;
}

export function applyCodexTurnPlanProgress(input: {
  threadId: string;
  plan: readonly CodexTurnPlanStep[];
  services: CodexTurnPlanProgressServices;
  now?: string;
}): CoderTodoItem[] {
  const todos = coderTodosFromCodexTurnPlan(
    input.threadId,
    input.plan,
    input.services.listTodos(input.threadId),
    input.now,
  );
  input.services.replaceTodos(input.threadId, todos);
  input.services.emitTodoList(input.threadId, todos);
  return todos;
}

export function coderTodosFromCodexTurnPlan(
  threadId: string,
  plan: readonly CodexTurnPlanStep[],
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
    const title = item.step.trim();
    const normalizedTitle = normalizeTaskTitle(title);
    const occurrence = occurrencesByTitle.get(normalizedTitle) ?? 0;
    occurrencesByTitle.set(normalizedTitle, occurrence + 1);
    const previous = existingByTitle.get(normalizedTitle)?.shift();
    return {
      id: previous?.id ?? codexPlanTodoId(threadId, normalizedTitle, occurrence),
      threadId,
      title,
      detail: title,
      status: mapCodexTurnPlanStatus(item.status),
      position,
      updatedAt: now,
    };
  });
}

function codexPlanTodoId(threadId: string, normalizedTitle: string, occurrence: number): string {
  const digest = createHash("sha256").update(normalizedTitle, "utf8").digest("hex").slice(0, 16);
  return `${threadId}:codex-plan:${digest}:${occurrence}`;
}

export function mapCodexTurnPlanStatus(status: CodexTurnPlanStepStatus): CoderTodoStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "inProgress":
      return "running";
    case "completed":
      return "completed";
  }
}
