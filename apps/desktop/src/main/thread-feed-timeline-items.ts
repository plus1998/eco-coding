import type { ThreadRunEvent } from "../shared/ipc";
import type { ThreadRunProjectionTimelineItem } from "../shared/thread-run-projection";
import { compareFeedSkeletonTimelineItems } from "../shared/thread-run-projection-skeleton";
import { isMetricsOnlyThreadRunEvent } from "./thread-run-event-normalizer";
import {
  sdkMessageBlockIdentity,
  settlesSdkMessageBlock,
  streamIdentityOf,
} from "./thread-run-message-blocks";
import { eventToTimelineItem } from "./thread-run-projection";
import { trimTimelineItemForFeed } from "./thread-run-projection-feed";

/**
 * Persisted run events that belong on the main Feed timeline: everything the projection
 * puts on `snapshot.timeline` for scope main/both, minus agent-scoped rows (they live on
 * agent cards) and metrics-only live types (which are never persisted as run events).
 *
 * The incremental skeleton patch tracks exactly this set, so the items it accumulates are
 * a superset of anything `selectSkeletonTimelineItems` can keep. That is what makes
 * "incremental patch == full rebuild" hold without a destructive collapse step.
 */
export function isFeedMainTimelineEvent(event: ThreadRunEvent): boolean {
  if (isMetricsOnlyThreadRunEvent(event)) {
    return false;
  }
  return event.scope !== "agent";
}

export interface FeedTimelineStageState {
  items: readonly ThreadRunProjectionTimelineItem[];
  /** SDK message blocks already settled; later events with the same identity are dropped. */
  finalizedSdkBlocks: readonly string[];
}

/**
 * Fold one run event into the tracked main-timeline items. The result equals what a full
 * `buildThreadRunProjection` would emit for the same event prefix (for main scope), which
 * is the invariant the Feed skeleton relies on: `select(staged) == select(rebuilt)`.
 *
 * Returns the input state unchanged when the event contributes nothing.
 */
export function stageFeedTimelineEvent(
  state: FeedTimelineStageState,
  event: ThreadRunEvent,
): FeedTimelineStageState {
  if (!isFeedMainTimelineEvent(event)) {
    return state;
  }
  const streamIdentity = streamIdentityOf(event);
  const sdkIdentity = sdkMessageBlockIdentity(event);
  if (sdkIdentity && state.finalizedSdkBlocks.includes(sdkIdentity)) {
    // The projection drops this event. A dropped *delta* still supersedes the tracked
    // delta of its stream: the store already replaced it before the projection ran, so
    // the stale text must not survive here either.
    if (!streamIdentity) {
      return state;
    }
    const superseded = state.items.filter((existing) => streamIdentityOf(existing) !== streamIdentity);
    return superseded.length === state.items.length
      ? state
      : { items: superseded, finalizedSdkBlocks: state.finalizedSdkBlocks };
  }
  const item = trimTimelineItemForFeed(eventToTimelineItem(event));
  const items = state.items.filter((existing) => {
    if (existing.id === item.id) {
      return false;
    }
    return !(streamIdentity && streamIdentityOf(existing) === streamIdentity);
  });
  items.push(item);
  items.sort(compareFeedSkeletonTimelineItems);

  if (!sdkIdentity || !settlesSdkMessageBlock(event)) {
    return { items, finalizedSdkBlocks: state.finalizedSdkBlocks };
  }
  return { items, finalizedSdkBlocks: [...state.finalizedSdkBlocks, sdkIdentity] };
}
