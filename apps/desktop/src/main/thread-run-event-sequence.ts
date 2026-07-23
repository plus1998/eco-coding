import type { ThreadRunEvent } from "../shared/ipc";

export function shouldAdvanceThreadRunEventSequence(
  event: Pick<ThreadRunEvent, "id" | "eventType">,
): boolean {
  return (
    event.id.startsWith("tre:stream:") &&
    (event.eventType === "message.delta" || event.eventType === "thinking.delta")
  );
}
