import { stableHash } from "@eco/shared";
import {
  CONVERSATION_RUNTIME_EVENT_FAILURE_ORIGIN,
  CONVERSATION_RUNTIME_EVENT_FAILURE_ROLE,
  CONVERSATION_RUNTIME_EVENT_FAILURE_TITLE,
} from "../shared/conversation-runtime-event-failure";
import type { ThreadRunEventInput } from "../shared/thread-run-events";

export function reportConversationRuntimeEventFailure(input: {
  event: ThreadRunEventInput;
  error: unknown;
  appendEvent(event: ThreadRunEventInput): void;
  onProjectionUpdated(threadId: string): void;
  logError(message: string): void;
}): void {
  const detail = input.error instanceof Error ? input.error.message : String(input.error);
  const message = `记录 ${input.event.eventType} 事件失败：${detail}`;
  input.logError(`[eco] conversation runtime event failed: ${input.event.id}: ${detail}`);

  try {
    input.appendEvent({
      threadId: input.event.threadId,
      id: `runtime_event_failure_${stableHash(`${input.event.threadId}:${input.event.id}:${message}`)}`,
      eventType: "api.error",
      scope: "main",
      role: CONVERSATION_RUNTIME_EVENT_FAILURE_ROLE,
      streamState: "finalized",
      message,
      observedAt: input.event.observedAt,
      metadata: {
        activityOrigin: CONVERSATION_RUNTIME_EVENT_FAILURE_ORIGIN,
        apiError: { title: CONVERSATION_RUNTIME_EVENT_FAILURE_TITLE, message },
        failedEventId: input.event.id,
        failedEventType: input.event.eventType,
      },
    });
  } catch (reportError) {
    const reportDetail = reportError instanceof Error ? reportError.message : String(reportError);
    input.logError(`[eco] could not show conversation error in Feed: ${reportDetail}`);
    return;
  }
  try {
    input.onProjectionUpdated(input.event.threadId);
  } catch (projectionError) {
    const detail = projectionError instanceof Error ? projectionError.message : String(projectionError);
    input.logError(`[eco] could not refresh conversation error in Feed: ${detail}`);
  }
}
