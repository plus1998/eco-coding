import {
  mergeStreamText,
  resolveSkillDisplayName,
  type AgentEvent,
} from "@eco/runtime";
import { formatAgentEventDisplay, isEcoStreamFinalize, isEcoStreamPlaceholder } from "@eco/runtime/sdk";
import {
  enrichFileChangeFromToolOutput,
  isFileChangeToolName,
  resolveFileChangeFromToolInput,
} from "../shared/file-change.js";
import type { ThreadRunToolMetadata } from "../shared/ipc";
import { activityStreamKey } from "./activity-agent-id.js";

type AgentEventLike = Pick<AgentEvent, "type" | "payload" | "role" | "agentId">;

interface PendingStreamDelta {
  role: string;
  message: string;
  stream: boolean;
  agentId?: string;
  timer: ReturnType<typeof setTimeout> | null;
}

export type SdkActivityEmit = (
  threadId: string,
  type: string,
  message: string,
  role: string,
  stream: boolean,
  agentId?: string,
  extras?: { tool?: ThreadRunToolMetadata; metadata?: Record<string, unknown> },
) => void;

const STREAM_THROTTLE_MS = 50;

export class SdkStreamActivityBridge {
  private readonly pendingDeltas = new Map<string, PendingStreamDelta>();
  private readonly lastStreamLine = new Map<string, { role: string; message: string; agentId?: string }>();

  resetThread(threadId: string): void {
    for (const key of [...this.lastStreamLine.keys()]) {
      if (key.startsWith(`${threadId}:`)) {
        this.lastStreamLine.delete(key);
      }
    }
    for (const key of [...this.pendingDeltas.keys()]) {
      if (key.startsWith(`${threadId}:`)) {
        const pending = this.pendingDeltas.get(key);
        if (pending?.timer) {
          clearTimeout(pending.timer);
        }
        this.pendingDeltas.delete(key);
      }
    }
  }

  handleEvent(
    threadId: string,
    event: AgentEventLike,
    emit: SdkActivityEmit,
    emitUsage?: (threadId: string, event: AgentEventLike) => void,
    options?: { activityAgentId?: string; parentToolUseId?: string },
  ): void {
    const activityAgentId = options?.activityAgentId;

    if (event.type === "usage.recorded") {
      emitUsage?.(threadId, event);
      return;
    }

    if (event.type === "tool.started") {
      if (isSdkToolInputPlaceholder(event.payload)) {
        return;
      }
    }

    if (event.type === "agent.started") {
      const status = resolveSdkAgentStatusActivity(event.payload);
      if (!status) {
        return;
      }
      const display = formatAgentEventDisplay(event);
      if (!display) {
        return;
      }
      this.flushPending(threadId, emit);
      emit(threadId, status.type, status.message, String(display.role), false, activityAgentId);
      return;
    }

    const allowed =
      event.type === "message.delta" ||
      event.type === "todo.updated" ||
      event.type === "tool.started" ||
      event.type === "tool.completed" ||
      event.type === "tool.failed";
    if (!allowed) {
      return;
    }

    const display = formatAgentEventDisplay(event);
    if (!display && !(event.payload && isEcoStreamFinalize(event.payload))) {
      return;
    }

    const role = String(display?.role ?? event.role);
    const stream = display?.stream ?? false;
    const message = display?.message ?? "";
    const streamKey = activityStreamKey(threadId, activityAgentId, role, options?.parentToolUseId);

    if (event.payload && isEcoStreamFinalize(event.payload)) {
      this.flushPending(threadId, emit);
      const last = this.lastStreamLine.get(streamKey);
      const finalizedMessage = last?.message.trim() ? last.message : message;
      emit(
        threadId,
        event.type,
        finalizedMessage,
        last?.role ?? role,
        false,
        last?.agentId ?? activityAgentId,
      );
      this.lastStreamLine.delete(streamKey);
      return;
    }

    if (event.payload && isEcoStreamPlaceholder(event.payload)) {
      this.flushPending(threadId, emit);
      this.lastStreamLine.set(streamKey, {
        role,
        message: "",
        ...(activityAgentId && { agentId: activityAgentId }),
      });
      emit(threadId, event.type, message, role, true, activityAgentId);
      return;
    }

    if (event.type === "message.delta" && stream) {
      const previous = this.lastStreamLine.get(streamKey)?.message ?? "";
      const accumulated = mergeStreamText(previous, message);
      this.lastStreamLine.set(streamKey, {
        role,
        message: accumulated,
        ...(activityAgentId && { agentId: activityAgentId }),
      });
      this.scheduleThrottledDelta(
        threadId,
        streamKey,
        event.type,
        accumulated,
        role,
        stream,
        activityAgentId,
        emit,
      );
      return;
    }

    const emitExtras = resolveSdkActivityToolMetadata(event);

    this.flushPending(threadId, emit);
    if (stream) {
      this.lastStreamLine.set(streamKey, {
        role,
        message,
        ...(activityAgentId && { agentId: activityAgentId }),
      });
    } else {
      this.lastStreamLine.delete(streamKey);
    }
    emit(
      threadId,
      event.type,
      message,
      role,
      stream,
      activityAgentId,
      emitExtras ? { tool: emitExtras } : undefined,
    );
  }

  private scheduleThrottledDelta(
    threadId: string,
    streamKey: string,
    type: string,
    message: string,
    role: string,
    stream: boolean,
    agentId: string | undefined,
    emit: SdkActivityEmit,
  ): void {
    const pendingExisting = this.pendingDeltas.get(streamKey);
    if (pendingExisting?.timer) {
      clearTimeout(pendingExisting.timer);
    }
    const pending: PendingStreamDelta = {
      role,
      message,
      stream,
      ...(agentId && { agentId }),
      timer: setTimeout(() => {
        this.pendingDeltas.delete(streamKey);
        emit(threadId, type, message, role, stream, agentId);
      }, STREAM_THROTTLE_MS),
    };
    this.pendingDeltas.set(streamKey, pending);
  }

  private flushPending(threadId: string, emit: SdkActivityEmit): void {
    for (const [streamKey, pending] of [...this.pendingDeltas.entries()]) {
      if (!streamKey.startsWith(`${threadId}:`)) {
        continue;
      }
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      this.pendingDeltas.delete(streamKey);
      this.lastStreamLine.set(streamKey, {
        role: pending.role,
        message: pending.message,
        ...(pending.agentId && { agentId: pending.agentId }),
      });
      emit(threadId, "message.delta", pending.message, pending.role, pending.stream, pending.agentId);
    }
  }
}

function resolveSdkActivityToolMetadata(event: AgentEventLike): ThreadRunToolMetadata | undefined {
  if (event.type === "tool.started") {
    return resolveSdkToolUseMetadata(event.payload) ?? resolveSdkToolProgressMetadata(event.payload);
  }
  if (event.type === "tool.completed") {
    return resolveSdkToolSummaryMetadata(event.payload);
  }
  if (event.type === "tool.failed") {
    return resolveSdkToolPermissionDeniedMetadata(event.payload);
  }
  if (event.type === "todo.updated") {
    return resolveSdkTaskProgressToolMetadata(event.payload);
  }
  return undefined;
}

function resolveSdkToolSummaryMetadata(payload: unknown): ThreadRunToolMetadata | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (record.type !== "tool_use_summary") {
    return undefined;
  }
  const name = readString(record.tool_name) ?? "Bash";
  const command =
    readString(record.command) ??
    readString(record.full_command) ??
    readString(record.bash_command);
  const output =
    readString(record.output) ??
    readString(record.stdout) ??
    readString(record.result) ??
    readString(record.content);
  const toolUseId = readString(record.tool_use_id);
  const description =
    name === "Bash"
      ? readString(record.description) ?? readBashDescriptionFromToolInput(record.input)
      : undefined;
  const fileChangeFromInput = isFileChangeToolName(name)
    ? resolveFileChangeFromToolInput(name, record.input)
    : undefined;
  const fileChange = enrichFileChangeFromToolOutput(
    fileChangeFromInput,
    output ?? record.result ?? record.content,
  );
  return {
    name,
    ...(command && { detail: command }),
    ...(output && { output }),
    ...(toolUseId && { toolUseId }),
    ...(description && { description }),
    ...(fileChange && { fileChange }),
    status: "completed",
  };
}

function resolveSdkToolPermissionDeniedMetadata(payload: unknown): ThreadRunToolMetadata | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (record.type !== "tool_permission_denied" || typeof record.tool_name !== "string") {
    return undefined;
  }
  return {
    name: record.tool_name,
    ...(typeof record.message === "string" && { detail: record.message }),
    ...(typeof record.tool_use_id === "string" && { toolUseId: record.tool_use_id }),
    status: "failed",
  };
}

function isSdkToolInputPlaceholder(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  if (record.type !== "tool_use" || record.streaming !== true || record.input_complete === true) {
    return false;
  }
  const input = record.input;
  return !input || (typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 0);
}

function resolveSdkAgentStatusActivity(payload: unknown): { type: string; message: string } | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (record.type !== "system") {
    return undefined;
  }
  if (record.subtype === "status") {
    if (record.status === "requesting") {
      return { type: "request.started", message: "Requesting model…" };
    }
    if (record.status === "compacting") {
      return { type: "agent.started", message: "Compacting context…" };
    }
  }
  if (record.subtype === "compact_boundary") {
    return { type: "agent.started", message: "Compacting context…" };
  }
  if (record.subtype === "api_retry") {
    const attempt = typeof record.attempt === "number" ? record.attempt : "?";
    const maxRetries = typeof record.max_retries === "number" ? record.max_retries : "?";
    return { type: "request.retry_scheduled", message: `API retry ${attempt}/${maxRetries}…` };
  }
  return undefined;
}

function readBashDescriptionFromToolInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const value = (input as Record<string, unknown>).description;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveSdkToolUseMetadata(payload: unknown): ThreadRunToolMetadata | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (record.type !== "tool_use" || typeof record.tool_name !== "string" || !record.tool_name.trim()) {
    return undefined;
  }
  const name = record.tool_name.trim();
  const detail = resolveSdkToolDisplayDetail(name, record.input);
  const toolUseId = readString(record.tool_use_id);
  const description = name === "Bash" ? readBashDescriptionFromToolInput(record.input) : undefined;
  const fileChange = isFileChangeToolName(name)
    ? resolveFileChangeFromToolInput(name, record.input)
    : undefined;
  return {
    name,
    ...(detail && { detail }),
    ...(toolUseId && { toolUseId }),
    ...(description && { description }),
    ...(fileChange && { fileChange }),
  };
}

function resolveSdkToolProgressMetadata(payload: unknown): ThreadRunToolMetadata | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (record.type !== "tool_progress") {
    return undefined;
  }
  const name = readString(record.tool_name);
  if (!name) {
    return undefined;
  }
  const elapsedSeconds =
    typeof record.elapsed_time_seconds === "number" ? record.elapsed_time_seconds : undefined;
  const toolUseId = readString(record.tool_use_id);
  return {
    name,
    ...(toolUseId && { toolUseId }),
    ...(elapsedSeconds !== undefined &&
      Number.isFinite(elapsedSeconds) && { durationMs: elapsedSeconds * 1000 }),
  };
}

function resolveSdkTaskProgressToolMetadata(payload: unknown): ThreadRunToolMetadata | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (record.sdkKind !== "task_progress") {
    return undefined;
  }
  const name = readString(record.last_tool_name);
  if (!name) {
    return undefined;
  }
  const detail = readString(record.description);
  return {
    name,
    ...(detail && { detail }),
  };
}

function resolveSdkToolDisplayDetail(toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (toolName === "AskUserQuestion") {
    const questions = Array.isArray(record.questions) ? record.questions : undefined;
    const first = questions?.[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const question = readString((first as Record<string, unknown>).question);
      if (question) {
        const short = question.length > 48 ? `${question.slice(0, 45)}…` : question;
        return questions.length > 1 ? `澄清 ${questions.length} 个问题 · ${short}` : short;
      }
    }
    return questions && questions.length > 1 ? `澄清 ${questions.length} 个问题` : "澄清问题";
  }
  const skillName = resolveSdkSkillDisplayName(toolName, record);
  if (skillName) {
    return `${skillName} 技能`;
  }
  if (toolName === "Agent") {
    const label = normalizeSubagentToolDisplayLabel(
      readString(record.subagent_type) ?? readString(record.agent_type),
    );
    if (!label) {
      return undefined;
    }
    const taskPrompt = readString(record.prompt);
    if (!taskPrompt) {
      return label;
    }
    const summary = taskPrompt.length > 60 ? `${taskPrompt.slice(0, 57)}…` : taskPrompt;
    return `${label} · ${summary}`;
  }
  const filePath = readString(record.file_path) ?? readString(record.path);
  const command =
    readString(record.full_command) ?? readString(record.bash_command) ?? readString(record.command);
  return (
    (filePath ? pathBasename(filePath) : undefined) ??
    command ??
    readString(record.pattern) ??
    readString(record.query) ??
    readString(record.url)
  );
}

function normalizeSubagentToolDisplayLabel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const normalized = trimmed.startsWith("eco_") ? trimmed.slice(4) : trimmed;
  const roleLabels: Record<string, string> = {
    explore: "探索",
    architect: "架构",
    coder: "编码",
    reviewer: "审查",
    tester: "测试",
  };
  return roleLabels[normalized] ?? normalized;
}

function resolveSdkSkillDisplayName(toolName: string, record: Record<string, unknown>): string | undefined {
  const resolved = resolveSkillDisplayName(toolName, record);
  if (resolved) {
    return resolved;
  }
  const candidate =
    readString(record.skill_name) ??
    readString(record.skill) ??
    readString(record.name) ??
    readString(record.display_name);
  if (!candidate) {
    return undefined;
  }
  if (/skill/i.test(toolName) || /skill/i.test(candidate)) {
    return candidate.replace(/\s*技能\s*$/u, "").trim();
  }
  return undefined;
}

function pathBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || filePath;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
