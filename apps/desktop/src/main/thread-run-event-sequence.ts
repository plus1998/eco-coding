import type { ThreadRunEvent } from "../shared/ipc";

export function shouldAdvanceThreadRunEventSequence(
  event: Pick<ThreadRunEvent, "id" | "eventType">,
): boolean {
  return event.eventType === "message.delta" || event.eventType === "thinking.delta";
}
