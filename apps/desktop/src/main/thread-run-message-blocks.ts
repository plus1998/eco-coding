import type { ThreadRunEvent } from "../shared/ipc";

/**
 * Identity / de-duplication rules for streamed message blocks.
 *
 * These three rules are shared by every path that turns the run-event log into Feed
 * items — the full projection (`buildThreadRunProjection`), the event cache that feeds it
 * (`listThreadRunEventsForProjection`) and the incremental skeleton patch
 * (`stageFeedTimelineEvent`). They used to exist as private copies in each module, which
 * is how the incremental and full paths drifted apart.
 */

/** Stream deltas for the same stream replace each other in place. */
export function isCollapsibleStreamEvent(event: ThreadRunEvent): boolean {
  return (
    (event.eventType === "message.delta" || event.eventType === "thinking.delta") &&
    Boolean(event.streamKey?.trim())
  );
}

export function sameStreamIdentity(left: ThreadRunEvent, right: ThreadRunEvent): boolean {
  // Keys are trimmed on persist; trimming again keeps this rule identical to the
  // timeline-item identity (`streamIdentityOf`) used by the incremental skeleton patch.
  return (
    left.eventType === right.eventType &&
    left.streamKey?.trim() === right.streamKey?.trim() &&
    left.requestId === right.requestId &&
    left.runAttemptId === right.runAttemptId
  );
}

/** Stream identity of a timeline item (subset of the event shape). */
export function streamIdentityOf(input: {
  eventType: string;
  streamKey?: string | undefined;
  requestId?: string | undefined;
  runAttemptId?: string | undefined;
}): string | undefined {
  if (input.eventType !== "message.delta" && input.eventType !== "thinking.delta") {
    return undefined;
  }
  const streamKey = input.streamKey?.trim();
  if (!streamKey) {
    return undefined;
  }
  return [input.eventType, streamKey, input.requestId?.trim() ?? "", input.runAttemptId?.trim() ?? ""].join(
    "\0",
  );
}

/** Identity of an SDK message block, used to drop replayed duplicates of a settled block. */
export function sdkMessageBlockIdentity(event: ThreadRunEvent): string | undefined {
  if (
    event.eventType !== "message.delta" &&
    event.eventType !== "message.final" &&
    event.eventType !== "thinking.delta" &&
    event.eventType !== "thinking.final"
  ) {
    return undefined;
  }
  const sdkMessageId = event.metadata?.sdkMessageId;
  if (typeof sdkMessageId !== "string" || !sdkMessageId.trim()) {
    return undefined;
  }
  const channel = event.eventType.startsWith("thinking.") ? "thinking" : "message";
  const owner = event.agentId?.trim() || event.parentToolUseId?.trim() || event.role?.trim() || "main";
  return `${owner}:${channel}:${sdkMessageId.trim()}`;
}

/** True when the event closes its SDK message block (nothing later may join it). */
export function settlesSdkMessageBlock(event: ThreadRunEvent): boolean {
  return (
    event.eventType === "message.final" ||
    event.eventType === "thinking.final" ||
    event.streamState === "finalized"
  );
}

/**
 * Applied by `buildThreadRunProjection` before projecting: a block that already settled
 * drops every later event carrying its identity.
 */
export function dedupeSettledSdkMessageBlocks(events: readonly ThreadRunEvent[]): ThreadRunEvent[] {
  const settled = new Set<string>();
  return events.filter((event) => {
    const identity = sdkMessageBlockIdentity(event);
    if (!identity) {
      return true;
    }
    if (settled.has(identity)) {
      return false;
    }
    if (settlesSdkMessageBlock(event)) {
      settled.add(identity);
    }
    return true;
  });
}

/** SDK message blocks already settled by the given event log. */
export function collectSettledSdkMessageBlocks(events: readonly ThreadRunEvent[]): string[] {
  const settled = new Set<string>();
  for (const event of events) {
    const identity = sdkMessageBlockIdentity(event);
    if (identity && settlesSdkMessageBlock(event)) {
      settled.add(identity);
    }
  }
  return [...settled];
}
