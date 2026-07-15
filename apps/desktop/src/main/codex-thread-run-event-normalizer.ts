import type { ThreadRunEventInput, ThreadRunEventType } from "../shared/thread-run-events";

const CODEX_TURN_EVENT_TYPES: Partial<Record<ThreadRunEventType, ThreadRunEventType>> = {
  "run.attempt.started": "request.started",
  "run.attempt.completed": "request.completed",
  "run.attempt.failed": "request.failed",
  "run.attempt.cancelled": "request.cancelled",
};

export function normalizeCodexThreadRunEventForProjection(event: ThreadRunEventInput): ThreadRunEventInput {
  const turnId = typeof event.metadata?.turnId === "string" ? event.metadata.turnId.trim() : "";
  const eventType = CODEX_TURN_EVENT_TYPES[event.eventType] ?? event.eventType;
  const message =
    event.eventType === "run.attempt.started"
      ? "Requesting model…"
      : event.eventType === "run.attempt.completed"
        ? "Request completed"
        : event.message;

  return {
    ...event,
    eventType,
    message,
    ...(event.requestId?.trim()
      ? { requestId: event.requestId.trim() }
      : turnId
        ? { requestId: turnId }
        : {}),
  };
}
