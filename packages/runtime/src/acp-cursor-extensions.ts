function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Cursor sometimes prefixes extension methods with `_` (agent-shell #386).
 * Docs: `cursor/update_todos`; live captures also used `_cursor/update_todos`.
 */
export function isCursorMethod(method: string, canonical: string): boolean {
  return method === canonical || method === `_${canonical}`;
}

export type AcpTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type AcpTodoItem = {
  id: string;
  content: string;
  status: AcpTodoStatus;
};

export type AcpUpdateTodosRequest = {
  toolCallId: string;
  todos: AcpTodoItem[];
  merge: boolean;
};

export type AcpUpdateTodosOutcome =
  | { outcome: "accepted"; todos: AcpTodoItem[] }
  | { outcome: "rejected"; reason?: string }
  | { outcome: "cancelled" };

export type AcpUpdateTodosHandler = (
  request: AcpUpdateTodosRequest,
) => Promise<AcpUpdateTodosOutcome> | AcpUpdateTodosOutcome;

export type AcpGenerateImageRequest = {
  toolCallId: string;
  description?: string;
  filePath?: string;
  referenceImagePaths?: string[];
  [key: string]: unknown;
};

export type AcpGenerateImageOutcome =
  | { outcome: "generated"; filePath: string; imageData?: string }
  | { outcome: "rejected"; reason?: string }
  | { outcome: "cancelled" };

export type AcpGenerateImageHandler = (
  request: AcpGenerateImageRequest,
) => Promise<AcpGenerateImageOutcome> | AcpGenerateImageOutcome;

/** Cursor built-in subagent types from `cursor/task` docs. */
export type AcpCursorSubagentType =
  | "unspecified"
  | "computer_use"
  | "explore"
  | "video_review"
  | "browser_use"
  | "shell"
  | "vm_setup_helper"
  | { custom: string };

export type AcpTaskRequest = {
  toolCallId: string;
  description?: string;
  prompt?: string;
  title?: string;
  subagentType?: AcpCursorSubagentType;
  model?: string;
  /** Cursor subagent id — resume / attribute when present. */
  agentId?: string;
  /** When set, this update is treated as an already-finished task. */
  durationMs?: number;
  [key: string]: unknown;
};

export type AcpTaskOutcome =
  | { outcome: "completed"; agentId?: string; durationMs?: number }
  | { outcome: "rejected"; reason?: string }
  | { outcome: "cancelled" };

export type AcpTaskHandler = (request: AcpTaskRequest) => Promise<AcpTaskOutcome> | AcpTaskOutcome;

export function formatAcpCursorSubagentType(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (isRecord(value) && typeof value.custom === "string" && value.custom.trim()) {
    return value.custom.trim();
  }
  return "Agent";
}

export function parseAcpTaskRequest(params: unknown): AcpTaskRequest | undefined {
  if (!isRecord(params) || typeof params.toolCallId !== "string" || !params.toolCallId.trim()) {
    return undefined;
  }
  const durationMs =
    typeof params.durationMs === "number" && Number.isFinite(params.durationMs)
      ? params.durationMs
      : undefined;
  const subagentType = parseAcpCursorSubagentType(params.subagentType);
  return {
    ...params,
    toolCallId: params.toolCallId.trim(),
    ...(typeof params.title === "string" ? { title: params.title } : {}),
    ...(typeof params.description === "string" ? { description: params.description } : {}),
    ...(typeof params.prompt === "string" ? { prompt: params.prompt } : {}),
    ...(subagentType !== undefined ? { subagentType } : {}),
    ...(typeof params.model === "string" ? { model: params.model } : {}),
    ...(typeof params.agentId === "string" && params.agentId.trim()
      ? { agentId: params.agentId.trim() }
      : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

function parseAcpCursorSubagentType(value: unknown): AcpCursorSubagentType | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim() as AcpCursorSubagentType;
  }
  if (isRecord(value) && typeof value.custom === "string" && value.custom.trim()) {
    return { custom: value.custom.trim() };
  }
  return undefined;
}

export function normalizeAcpTodoStatus(value: unknown): AcpTodoStatus {
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
    default:
      return "pending";
  }
}

/** Parse `cursor/update_todos` params. Requires a `todos` array; missing field is not a wipe. */
export function parseAcpUpdateTodosRequest(params: unknown): AcpUpdateTodosRequest | undefined {
  if (!isRecord(params) || !Array.isArray(params.todos)) {
    return undefined;
  }
  const toolCallId = typeof params.toolCallId === "string" ? params.toolCallId.trim() : "";
  const todos: AcpTodoItem[] = [];
  for (const [index, entry] of params.todos.entries()) {
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
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : String(index);
    todos.push({
      id,
      content,
      status: normalizeAcpTodoStatus(record.status),
    });
  }
  return {
    toolCallId,
    todos,
    merge: params.merge === true,
  };
}

export function parseAcpGenerateImageRequest(params: unknown): AcpGenerateImageRequest | undefined {
  if (!isRecord(params) || typeof params.toolCallId !== "string" || !params.toolCallId.trim()) {
    return undefined;
  }
  const referenceImagePaths = Array.isArray(params.referenceImagePaths)
    ? params.referenceImagePaths.filter((value): value is string => typeof value === "string")
    : undefined;
  return {
    ...params,
    toolCallId: params.toolCallId.trim(),
    ...(typeof params.description === "string" ? { description: params.description } : {}),
    ...(typeof params.filePath === "string" ? { filePath: params.filePath } : {}),
    ...(referenceImagePaths ? { referenceImagePaths } : {}),
  };
}
