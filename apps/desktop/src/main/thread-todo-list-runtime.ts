import type { CoderTodoItem, ThreadActivityLine } from "../shared/ipc";
import { extractCoderTasksFromActivity, mergeCoderTodoItems } from "./coder-tasks";

export interface ThreadTodoListRuntimeServices {
  listTodos(threadId: string): CoderTodoItem[];
  listActivity(threadId: string): ThreadActivityLine[];
  replaceTodos(threadId: string, todos: CoderTodoItem[]): void;
}

export function loadThreadTodoList(input: {
  threadId: string;
  services: ThreadTodoListRuntimeServices;
}): CoderTodoItem[] {
  const { threadId, services } = input;
  const stored = services.listTodos(threadId);
  if (stored.length > 0) {
    return stored;
  }

  const drafts = extractCoderTasksFromActivity(services.listActivity(threadId));
  if (drafts.length === 0) {
    return stored;
  }

  const todos = mergeCoderTodoItems(threadId, drafts, stored);
  services.replaceTodos(threadId, todos);
  return todos;
}
