import type { ThreadRunEvent } from "../shared/ipc";
import type { ThreadRunProjectionTimelineItem } from "../shared/thread-run-projection";
import { isSkeletonUserPromptItem } from "../shared/thread-run-projection-skeleton";

/**
 * Load-path safety nets: cases where a persisted Feed skeleton may be structurally wrong
 * and must be rebuilt from the event log instead of being trusted.
 *
 * These are deliberately *narrow* and *cheap*: each one must be false for a freshly
 * rebuilt skeleton, otherwise every projection emit would rebuild again (a rebuild storm).
 * They are not the primary correctness mechanism any more — the incremental patch is meant
 * to equal a full rebuild by construction (see thread-feed-timeline-items.ts) — they only
 * cover content classes that a rebuild produces but the patch cannot invent.
 */

/**
 * Agent-scoped assistant rows whose agent instance is unknown (e.g. the subagent record was
 * pruned) are promoted to the main timeline by `buildThreadRunProjection`. A skeleton built
 * before that promotion lacks them, and only a rebuild can add them.
 */
export function shouldRebuildFeedSkeletonForOrphanAgentEvents(input: {
  events: readonly ThreadRunEvent[];
  timeline: readonly ThreadRunProjectionTimelineItem[];
  knownAgentIds: readonly string[];
}): boolean {
  const knownAgentIds = new Set(input.knownAgentIds);
  let orphanAssistant = false;
  for (const event of input.events) {
    if (event.scope !== "agent") {
      continue;
    }
    const agentId = event.agentId?.trim();
    if (!agentId || knownAgentIds.has(agentId)) {
      continue;
    }
    if (isAssistantBodyEventType(event.eventType)) {
      orphanAssistant = true;
      break;
    }
  }
  if (!orphanAssistant) {
    return false;
  }
  // A rebuilt skeleton already contains the promoted row, so this cannot fire twice.
  return !input.timeline.some(
    (item) => item.scope !== "agent" && isAssistantBodyEventType(item.eventType),
  );
}

function isAssistantBodyEventType(eventType: string): boolean {
  return (
    eventType === "message.final" ||
    eventType === "message.delta" ||
    eventType === "thinking.final" ||
    eventType === "thinking.delta" ||
    eventType === "tool.started" ||
    eventType === "tool.completed"
  );
}

/**
 * An empty main timeline is poison only when the skeleton was built *without reading any
 * event* (`sourceEventCount === 0`) while the log does contain feed-visible rows — e.g. the
 * `FULL_PROJECTION_EVENT_CACHE_MAX` slice wiped the projection cache and the skeleton was
 * persisted from an empty event list.
 *
 * Both extra conditions matter, because the detector runs on every load and a rebuild only
 * reproduces what the selection keeps:
 *  - no feed-visible event (all rows agent-scoped) => an empty main timeline is correct;
 *  - events were read (`sourceEventCount > 0`) but the selection kept none (finished
 *    attempt without a final) => a rebuild would be empty too, so rebuilding every emit
 *    would be a rebuild storm.
 */
export function shouldRebuildFeedSkeletonForEmptyTimeline(input: {
  timeline: readonly ThreadRunProjectionTimelineItem[];
  sourceEventCount: number;
  hasFeedVisibleEvent: boolean;
}, maxEventSequence: number): boolean {
  if (input.timeline.length > 0 || !input.hasFeedVisibleEvent) {
    return false;
  }
  return maxEventSequence > 0 && input.sourceEventCount === 0;
}

/**
 * Older Feed trims capped user prompts at 1_200 chars with textTruncated and no hydrate
 * path. Force rebuild so long prompts reappear after the keep-full fix.
 */
export function shouldRebuildFeedSkeletonForTruncatedUserPrompts(
  timeline: readonly ThreadRunProjectionTimelineItem[],
): boolean {
  return timeline.some(
    (item) => isSkeletonUserPromptItem(item) && item.metadata?.textTruncated === true,
  );
}
