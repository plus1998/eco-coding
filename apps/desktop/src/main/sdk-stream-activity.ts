import {
  formatAgentEventDisplay,
  isEcoStreamFinalize,
  isEcoStreamPlaceholder,
  mergeStreamText,
  type AgentEvent,
} from "@eco/runtime";

type AgentEventLike = Pick<AgentEvent, "type" | "payload" | "role">;

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
  timer: ReturnType<typeof setTimeout> | null;
}

export class SdkStreamActivityBridge {
  private readonly recentSdkTools = new Map<string, SdkToolActivityRecord[]>();
  private readonly pendingDeltas = new Map<string, PendingStreamDelta>();
  private readonly lastStreamLine = new Map<string, { role: string; message: string }>();

  resetThread(threadId: string): void {
    this.recentSdkTools.delete(threadId);
    this.lastStreamLine.delete(threadId);
    const pending = this.pendingDeltas.get(threadId);
    if (pending?.timer) {
      clearTimeout(pending.timer);
    }
    this.pendingDeltas.delete(threadId);
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
    const match = message.match(/^Tool:\s*([^·]+)(?:\s*·\s*(.+))?/);
    if (!match) {
      return false;
    }
    const toolName = match[1]?.trim();
    const detail = match[2]?.trim();
    if (!toolName) {
      return false;
    }
    const recent = this.recentSdkTools.get(threadId) ?? [];
    const cutoff = Date.now() - OTEL_TOOL_DEDUP_MS;
    const sdkMatch = [...recent]
      .reverse()
      .find((item) => item.at >= cutoff && item.toolName === toolName);
    if (!sdkMatch) {
      return false;
    }
    if (detail && !sdkMatch.hadDetail) {
      return false;
    }
    if (!detail && !sdkMatch.hadDetail) {
      return true;
    }
    if (detail && sdkMatch.hadDetail) {
      return true;
    }
    return false;
  }

  handleEvent(
    threadId: string,
    event: AgentEventLike,
    emit: (threadId: string, type: string, message: string, role: string, stream: boolean) => void,
    emitUsage?: (threadId: string, event: AgentEventLike) => void,
  ): void {
    if (event.type === "usage.recorded") {
      emitUsage?.(threadId, event);
      return;
    }

    if (event.type === "tool.started") {
      this.noteSdkToolActivity(threadId, event.payload);
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

    if (event.payload && isEcoStreamFinalize(event.payload)) {
      this.flushPending(threadId, emit);
      const last = this.lastStreamLine.get(threadId);
      emit(threadId, event.type, last?.message ?? message, last?.role ?? role, false);
      this.lastStreamLine.delete(threadId);
      return;
    }

    if (event.payload && isEcoStreamPlaceholder(event.payload)) {
      this.flushPending(threadId, emit);
      this.lastStreamLine.set(threadId, { role, message: "" });
      emit(threadId, event.type, message, role, true);
      return;
    }

    if (event.type === "message.delta" && stream) {
      const pendingMsg = this.pendingDeltas.get(threadId)?.message;
      const merged = pendingMsg ? mergeStreamText(pendingMsg, message) : message;
      this.lastStreamLine.set(threadId, {
        role,
        message: mergeStreamText(this.lastStreamLine.get(threadId)?.message ?? "", merged),
      });
      this.scheduleThrottledDelta(threadId, event.type, message, role, stream, emit);
      return;
    }

    this.flushPending(threadId, emit);
    if (stream) {
      this.lastStreamLine.set(threadId, { role, message });
    } else {
      this.lastStreamLine.delete(threadId);
    }
    emit(threadId, event.type, message, role, stream);
  }

  private scheduleThrottledDelta(
    threadId: string,
    type: string,
    message: string,
    role: string,
    stream: boolean,
    emit: (threadId: string, type: string, message: string, role: string, stream: boolean) => void,
  ): void {
    const existing = this.pendingDeltas.get(threadId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    const mergedMessage = existing ? mergeStreamText(existing.message, message) : message;
    const pending: PendingStreamDelta = {
      role,
      message: mergedMessage,
      stream,
      timer: setTimeout(() => {
        this.pendingDeltas.delete(threadId);
        emit(threadId, type, mergedMessage, role, stream);
      }, STREAM_THROTTLE_MS),
    };
    this.pendingDeltas.set(threadId, pending);
  }

  private flushPending(
    threadId: string,
    emit: (threadId: string, type: string, message: string, role: string, stream: boolean) => void,
  ): void {
    const pending = this.pendingDeltas.get(threadId);
    if (!pending) {
      return;
    }
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    this.pendingDeltas.delete(threadId);
    this.lastStreamLine.set(threadId, { role: pending.role, message: pending.message });
    emit(threadId, "message.delta", pending.message, pending.role, pending.stream);
  }
}
