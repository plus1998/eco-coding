import { mergeStreamText, type AgentEvent, type OtelActivityLine } from "@eco/runtime";
import {
  formatAgentEventDisplay,
  formatAgentEventLine,
  isEcoStreamFinalize,
  isEcoStreamPlaceholder,
  isUpstreamStatusActivityMessage,
} from "@eco/runtime/sdk";
import type { ThreadRunToolMetadata } from "../shared/ipc";
import { activityStreamKey } from "./activity-agent-id.js";

type AgentEventLike = Pick<AgentEvent, "type" | "payload" | "role" | "agentId">;

export interface SdkToolActivityRecord {
  toolName: string;
  toolUseId?: string;
  detailKey?: string;
  role?: string;
  agentId?: string;
  hadDetail: boolean;
  at: number;
  matchedAt?: number;
}

const STREAM_THROTTLE_MS = 50;
const OTEL_TOOL_DEDUP_MS = 60_000;

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
  extras?: { tool?: ThreadRunToolMetadata },
) => void;

export class SdkStreamActivityBridge {
  private readonly recentSdkTools = new Map<string, SdkToolActivityRecord[]>();
  private readonly pendingDeltas = new Map<string, PendingStreamDelta>();
  private readonly lastStreamLine = new Map<string, { role: string; message: string; agentId?: string }>();

  resetThread(threadId: string): void {
    this.recentSdkTools.delete(threadId);
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

  noteSdkToolActivity(threadId: string, payload: unknown, agentId?: string, role?: string): void {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const record = payload as Record<string, unknown>;
    if (record.type !== "tool_use" || typeof record.tool_name !== "string") {
      return;
    }
    const toolName = record.tool_name;
    const detailKey = resolveSdkToolDetailKey(toolName, record.input);
    const detail =
      record.input !== undefined &&
      record.input !== null &&
      (typeof record.input !== "object" || Object.keys(record.input as object).length > 0);
    const entry: SdkToolActivityRecord = {
      toolName,
      ...(typeof record.tool_use_id === "string" && { toolUseId: record.tool_use_id }),
      ...(detailKey && { detailKey }),
      ...(role && { role }),
      ...(agentId && { agentId }),
      hadDetail: Boolean(detail),
      at: Date.now(),
    };
    const list = this.recentSdkTools.get(threadId) ?? [];
    list.push(entry);
    const cutoff = Date.now() - OTEL_TOOL_DEDUP_MS;
    this.recentSdkTools.set(
      threadId,
      list.filter((item) => item.at >= cutoff).slice(-40),
    );
  }

  shouldSuppressOtelToolLine(threadId: string, line: string | Pick<OtelActivityLine, "message" | "toolName" | "toolDetail" | "toolUseId" | "durationMs" | "role">): boolean {
    const parsed = parseOtelToolLine(line);
    if (!parsed) {
      return false;
    }
    const recent = this.recentSdkTools.get(threadId) ?? [];
    const cutoff = Date.now() - OTEL_TOOL_DEDUP_MS;
    const candidates = [...recent]
      .reverse()
      .filter((item) => item.at >= cutoff && !item.matchedAt && item.toolName === parsed.toolName);
    const sdkMatch =
      matchByToolUseId(candidates, parsed) ??
      matchByDetailKey(candidates, parsed) ??
      matchSummaryOnly(candidates, parsed);
    if (!sdkMatch) {
      return false;
    }
    sdkMatch.matchedAt = Date.now();
    return true;
  }

  handleEvent(
    threadId: string,
    event: AgentEventLike,
    emit: SdkActivityEmit,
    emitUsage?: (threadId: string, event: AgentEventLike) => void,
    options?: { activityAgentId?: string },
  ): void {
    const activityAgentId = options?.activityAgentId;

    if (event.type === "usage.recorded") {
      emitUsage?.(threadId, event);
      return;
    }

    if (event.type === "tool.started") {
      this.noteSdkToolActivity(threadId, event.payload, activityAgentId, String(event.role));
    }

    if (event.type === "agent.started") {
      const statusMessage = formatAgentEventLine(event);
      if (!isUpstreamStatusActivityMessage(statusMessage)) {
        return;
      }
      const display = formatAgentEventDisplay(event);
      if (!display?.message) {
        return;
      }
      this.flushPending(threadId, emit);
      emit(threadId, resolveSdkStatusLiveType(display.message), display.message, String(display.role), false, activityAgentId);
      return;
    }

    const allowed =
      event.type === "message.delta" ||
      event.type === "todo.updated" ||
      event.type === "tool.started" ||
      event.type === "tool.completed";
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
    const streamKey = activityStreamKey(threadId, activityAgentId, role);

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
      this.lastStreamLine.set(streamKey, { role, message: "", ...(activityAgentId && { agentId: activityAgentId }) });
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
      this.scheduleThrottledDelta(threadId, streamKey, event.type, accumulated, role, stream, activityAgentId, emit);
      return;
    }

    const emitExtras = resolveSdkActivityToolMetadata(event, message);

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
    emit(threadId, event.type, message, role, stream, activityAgentId, emitExtras ? { tool: emitExtras } : undefined);
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

function resolveSdkActivityToolMetadata(
  event: AgentEventLike,
  message: string,
): ThreadRunToolMetadata | undefined {
  if (event.type === "tool.started") {
    return resolveSdkToolUseMetadata(event.payload, message) ?? resolveSdkToolProgressMetadata(event.payload);
  }
  if (event.type === "todo.updated") {
    return resolveSdkTaskProgressToolMetadata(event.payload, message);
  }
  return undefined;
}

function resolveSdkStatusLiveType(message: string): string {
  return /^Requesting model/i.test(message.trim()) ? "request.started" : "agent.started";
}

function resolveSdkToolUseMetadata(payload: unknown, message: string): ThreadRunToolMetadata | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (record.type !== "tool_use" || typeof record.tool_name !== "string" || !record.tool_name.trim()) {
    return undefined;
  }
  const name = record.tool_name.trim();
  const detail = resolveSdkToolDisplayDetail(name, record.input) ?? parseToolDisplayDetail(message);
  const toolUseId = readString(record.tool_use_id);
  return {
    name,
    ...(detail && { detail }),
    ...(toolUseId && { toolUseId }),
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
  const elapsedSeconds = typeof record.elapsed_time_seconds === "number" ? record.elapsed_time_seconds : undefined;
  const toolUseId = readString(record.tool_use_id);
  return {
    name,
    ...(toolUseId && { toolUseId }),
    ...(elapsedSeconds !== undefined && Number.isFinite(elapsedSeconds) && { durationMs: elapsedSeconds * 1000 }),
  };
}

function resolveSdkTaskProgressToolMetadata(payload: unknown, message: string): ThreadRunToolMetadata | undefined {
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
  const detail = readString(record.description) ?? parseToolDisplayDetail(message);
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
  if (toolName === "Agent") {
    return normalizeSubagentToolDisplayLabel(
      readString(record.subagent_type) ?? readString(record.agent_type),
    );
  }
  return (
    readString(record.full_command) ??
    readString(record.bash_command) ??
    readString(record.command) ??
    readString(record.file_path) ??
    readString(record.path) ??
    readString(record.pattern) ??
    readString(record.query) ??
    readString(record.url)
  );
}

function parseToolDisplayDetail(message: string): string | undefined {
  const match = message.trim().match(/^Tool:\s*.+?\s*·\s*(.+)$/);
  return readString(match?.[1]);
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

interface ParsedOtelToolLine {
  toolName: string;
  detailKey?: string;
  toolUseId?: string;
  durationMs?: number;
}

function parseOtelToolLine(
  line: string | Pick<OtelActivityLine, "message" | "toolName" | "toolDetail" | "toolUseId" | "durationMs" | "role">,
): ParsedOtelToolLine | undefined {
  if (typeof line !== "string" && line.toolName?.trim()) {
    const detailKey = normalizeToolDetailKey(line.toolDetail);
    return {
      toolName: line.toolName.trim(),
      ...(detailKey && { detailKey }),
      ...(line.toolUseId?.trim() && { toolUseId: line.toolUseId.trim() }),
      ...(line.durationMs !== undefined && { durationMs: line.durationMs }),
    };
  }
  const message = typeof line === "string" ? line : line.message;
  const match = message.trim().match(/^Tool:\s*(.+?)(?:\s*·\s*(.+))?$/);
  const rawToolName = match?.[1]?.trim();
  if (!rawToolName) {
    return undefined;
  }
  const toolName = stripOtelDurationSuffix(rawToolName);
  if (!toolName) {
    return undefined;
  }
  const durationMs = parseDurationSuffixMs(message);
  const rawDetail = match?.[2]?.trim();
  const detailKey = normalizeToolDetailKey(rawDetail ? stripOtelDurationSuffix(rawDetail) : undefined);
  return {
    toolName,
    ...(detailKey && { detailKey }),
    ...(durationMs !== undefined && { durationMs }),
  };
}

function stripOtelDurationSuffix(value: string): string {
  return value.replace(/\s+\(\d+(?:\.\d+)?s\)$/i, "").trim();
}

function parseDurationSuffixMs(value: string): number | undefined {
  const match = value.match(/\((\d+(?:\.\d+)?)s\)\s*$/i);
  if (!match?.[1]) {
    return undefined;
  }
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

function matchByToolUseId(
  candidates: SdkToolActivityRecord[],
  parsed: ParsedOtelToolLine,
): SdkToolActivityRecord | undefined {
  if (!parsed.toolUseId) {
    return undefined;
  }
  return candidates.find((item) => item.toolUseId === parsed.toolUseId);
}

function matchByDetailKey(
  candidates: SdkToolActivityRecord[],
  parsed: ParsedOtelToolLine,
): SdkToolActivityRecord | undefined {
  if (!parsed.detailKey) {
    return undefined;
  }
  return candidates.find((item) => item.detailKey === parsed.detailKey);
}

function matchSummaryOnly(
  candidates: SdkToolActivityRecord[],
  parsed: ParsedOtelToolLine,
): SdkToolActivityRecord | undefined {
  if (parsed.detailKey) {
    return undefined;
  }
  return candidates[0];
}

function resolveSdkToolDetailKey(toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (toolName === "Agent") {
    return normalizeToolDetailKey(
      readString(record.subagent_type) ?? readString(record.agent_type),
    );
  }
  return normalizeToolDetailKey(
    readString(record.full_command) ??
      readString(record.bash_command) ??
      readString(record.command) ??
      readString(record.file_path) ??
      readString(record.path) ??
      readString(record.pattern) ??
      readString(record.query) ??
      readString(record.url),
  );
}

function normalizeToolDetailKey(value: string | undefined): string | undefined {
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
  return (roleLabels[normalized] ?? normalized).toLowerCase();
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
