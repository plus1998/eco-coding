import type { ThreadRunEventInput } from "../shared/ipc";
import { formatToolOutputTruncationMessage } from "../shared/tool-output-limit";

export interface ToolOutputRunEventWriter {
  getThread(threadId: string): unknown;
  appendThreadRunEvent(event: ThreadRunEventInput): void;
  scheduleProjectionUpdated(threadId: string): void;
  emitThreadEvent(threadId: string, type: string, message: string): void;
  resolveCurrentRunAttemptId(threadId: string): string | undefined;
  writeStderr(message: string): void;
}

export function emitToolOutputTruncated(
  writer: ToolOutputRunEventWriter,
  threadId: string,
  input: {
    toolName: string;
    originalChars: number;
    keptChars: number;
    toolUseId?: string;
  },
): void {
  if (!writer.getThread(threadId)) {
    return;
  }
  const message = formatToolOutputTruncationMessage(input);
  const now = new Date().toISOString();
  const unique = input.toolUseId?.trim() || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const runAttemptId = writer.resolveCurrentRunAttemptId(threadId);
  const metadata: Record<string, unknown> = {
    liveType: "context.tool_output_truncated",
    toolOutput: {
      toolName: input.toolName,
      originalChars: input.originalChars,
      keptChars: input.keptChars,
      ...(input.toolUseId?.trim() && { toolUseId: input.toolUseId.trim() }),
    },
  };
  try {
    writer.appendThreadRunEvent({
      id: `tre:${threadId}:tool-output-truncated:${unique}`,
      threadId,
      eventType: "context.tool_output_truncated",
      scope: "main",
      streamState: "none",
      message,
      observedAt: now,
      ...(runAttemptId && { runAttemptId }),
      metadata,
    });
    writer.scheduleProjectionUpdated(threadId);
    writer.emitThreadEvent(threadId, "context.tool_output_truncated", message);
  } catch (error) {
    writer.writeStderr(`[eco] tool output truncation event write failed: ${String(error)}\n`);
  }
}
