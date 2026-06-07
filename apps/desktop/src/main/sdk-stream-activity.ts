import { mergeStreamText, type AgentEvent } from "@eco/runtime";
import {
  formatAgentEventDisplay,
  formatAgentEventLine,
  isEcoStreamFinalize,
  isEcoStreamPlaceholder,
  isUpstreamStatusActivityMessage,
} from "@eco/runtime/sdk";
import { activityStreamKey } from "./activity-agent-id.js";

type AgentEventLike = Pick<AgentEvent, "type" | "payload" | "role" | "agentId">;

export interface SdkToolActivityRecord {
  toolName: string;
  toolUseId?: string;
  hadDetail: boolean;
  at: number;
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

  noteSdkToolActivity(threadId: string, payload: unknown): void {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const record = payload as Record<string, unknown>;
    if (record.type !== "tool_use" || typeof record.tool_name !== "string") {
      return;
    }
    const toolName = record.tool_name;
    const detail =
      record.input !== undefined &&
      record.input !== null &&
      (typeof record.input !== "object" || Object.keys(record.input as object).length > 0);
    const entry: SdkToolActivityRecord = {
      toolName,
      ...(typeof record.tool_use_id === "string" && { toolUseId: record.tool_use_id }),
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

  shouldSuppressOtelToolLine(threadId: string, message: string): boolean {
    const parsed = parseOtelToolLine(message);
    if (!parsed) {
      return false;
    }
    const recent = this.recentSdkTools.get(threadId) ?? [];
    const cutoff = Date.now() - OTEL_TOOL_DEDUP_MS;
    const sdkMatch = [...recent]
      .reverse()
      .find((item) => item.at >= cutoff && item.toolName === parsed.toolName);
    if (!sdkMatch) {
      return false;
    }
    if (!parsed.detail) {
      return true;
    }
    if (!sdkMatch.hadDetail) {
      return false;
    }
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
      this.noteSdkToolActivity(threadId, event.payload);
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
      emit(threadId, event.type, display.message, String(display.role), false, activityAgentId);
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
    emit(threadId, event.type, message, role, stream, activityAgentId);
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

function parseOtelToolLine(message: string): { toolName: string; detail?: string } | undefined {
  const match = message.trim().match(/^Tool:\s*(.+?)(?:\s*·\s*(.+))?$/);
  const rawToolName = match?.[1]?.trim();
  if (!rawToolName) {
    return undefined;
  }
  const toolName = stripOtelDurationSuffix(rawToolName);
  if (!toolName) {
    return undefined;
  }
  const rawDetail = match?.[2]?.trim();
  const detail = rawDetail ? stripOtelDurationSuffix(rawDetail) : undefined;
  return {
    toolName,
    ...(detail && { detail }),
  };
}

function stripOtelDurationSuffix(value: string): string {
  return value.replace(/\s+\(\d+(?:\.\d+)?s\)$/i, "").trim();
}
