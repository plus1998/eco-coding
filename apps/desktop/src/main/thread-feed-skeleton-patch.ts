import type { ThreadRunEvent, ThreadRunProjectionAgent } from "../shared/ipc";
import type {
  ThreadRunProjectionAttempt,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../shared/thread-run-projection";
import { isMetricsOnlyThreadRunEvent } from "./thread-run-event-normalizer";
import { trimTimelineItemForFeed } from "./thread-run-projection-feed";
import { eventToTimelineItem } from "./thread-run-projection";
import {
  buildFeedSkeletonSegmentKey,
  compareFeedSkeletonTimelineItems,
  isSkeletonTurnFinalItem,
  isSkeletonUserPromptItem,
  listFeedSkeletonUserBoundaries,
  selectSkeletonTimelineItems,
} from "../shared/thread-run-projection-skeleton";
import type { FeedSkeletonPatchState, ThreadFeedSkeletonRecord } from "./thread-feed-skeleton-store";

export interface FeedSkeletonPatchContext {
  attempts: readonly ThreadRunProjectionAttempt[];
  agents: readonly ThreadRunProjectionAgent[];
  historyRevision: number;
  maxEventSequence: number;
}

const RUN_ATTEMPT_TERMINAL_EVENT_TYPES = new Set([
  "run.attempt.completed",
  "run.attempt.failed",
  "run.attempt.cancelled",
]);

export function createFeedSkeletonPatchState(
  snapshot: ThreadRunProjectionSnapshot,
): FeedSkeletonPatchState {
  return {
    trackedItems: snapshot.timeline.map((item) => ({ ...item })),
  };
}

export function createThreadFeedSkeletonRecord(
  snapshot: ThreadRunProjectionSnapshot,
  context: FeedSkeletonPatchContext,
): ThreadFeedSkeletonRecord {
  return {
    historyRevision: context.historyRevision,
    maxEventSequence: context.maxEventSequence,
    snapshot,
    patchState: createFeedSkeletonPatchState(snapshot),
  };
}

export function shouldTrackEventForFeedSkeletonPatch(
  event: ThreadRunEvent,
  attempts: readonly ThreadRunProjectionAttempt[],
): boolean {
  if (isMetricsOnlyThreadRunEvent(event)) {
    return false;
  }
  if (RUN_ATTEMPT_TERMINAL_EVENT_TYPES.has(event.eventType)) {
    return false;
  }
  if (event.eventType.startsWith("agent.")) {
    return false;
  }
  if (event.eventType.startsWith("run.attempt.")) {
    return false;
  }

  const item = eventToTimelineItem(event);
  if (isSkeletonUserPromptItem(item)) {
    return true;
  }

  const attemptId = event.runAttemptId?.trim();
  const attempt = attemptId
    ? attempts.find((candidate) => candidate.attemptId === attemptId)
    : undefined;
  if (attempt?.status === "running") {
    return true;
  }

  if (event.eventType === "message.final") {
    const role = event.role?.trim();
    if (role === "user" || role === "tool" || role === "thinking") {
      return false;
    }
    return event.message.trim().length > 0;
  }
  if (event.eventType === "api.error" || event.eventType === "tool.failed") {
    return true;
  }
  return false;
}

export function patchThreadFeedSkeletonFromEvent(
  record: ThreadFeedSkeletonRecord,
  event: ThreadRunEvent,
  context: FeedSkeletonPatchContext,
): ThreadFeedSkeletonRecord | null {
  if (!record.patchState) {
    return null;
  }
  if (event.threadId !== record.snapshot.thread.threadId) {
    return null;
  }

  const attempts = [...context.attempts];
  const agents = context.agents.map((agent) => ({ ...agent, timeline: [] }));
  let trackedItems = record.patchState.trackedItems.map((item) => ({ ...item }));
  let structureChanged = false;

  if (shouldTrackEventForFeedSkeletonPatch(event, attempts)) {
    const item = trimTimelineItemForFeed(eventToTimelineItem(event));
    trackedItems = upsertTrackedItem(trackedItems, item);
    if (isSkeletonTurnFinalItem(item)) {
      trackedItems = collapseSegmentProcessItems(trackedItems, item, attempts);
    }
    structureChanged = true;
  } else if (RUN_ATTEMPT_TERMINAL_EVENT_TYPES.has(event.eventType)) {
    trackedItems = reconcileTrackedItemsAfterAttemptChange(trackedItems, attempts);
    structureChanged = true;
  } else if (!isMetricsOnlyThreadRunEvent(event)) {
    return record.maxEventSequence === context.maxEventSequence
      ? record
      : {
          ...record,
          maxEventSequence: context.maxEventSequence,
        };
  }

  if (!structureChanged) {
    return {
      ...record,
      maxEventSequence: context.maxEventSequence,
    };
  }

  const skeletonTimeline = selectSkeletonTimelineItems(trackedItems, attempts).map((item) => ({
    ...item,
  }));
  trackedItems = reconcileTrackedItemsAfterAttemptChange(
    mergeTrackedItemsWithSkeleton(trackedItems, skeletonTimeline),
    attempts,
  );

  const nextSnapshot: ThreadRunProjectionSnapshot = {
    ...record.snapshot,
    thread: {
      ...record.snapshot.thread,
      generatedAt: new Date().toISOString(),
      ...((): { currentAttemptId?: string } => {
        const currentAttemptId =
          attempts.find((attempt) => attempt.status === "running")?.attemptId ??
          attempts.at(-1)?.attemptId;
        return currentAttemptId ? { currentAttemptId } : {};
      })(),
    },
    attempts: [...attempts],
    agents,
    timeline: skeletonTimeline,
    sourceEventCount: Math.max(record.snapshot.sourceEventCount, context.maxEventSequence),
    historyRevision: context.historyRevision,
  };

  return {
    historyRevision: context.historyRevision,
    maxEventSequence: context.maxEventSequence,
    snapshot: nextSnapshot,
    patchState: { trackedItems },
  };
}

export function feedSkeletonTimelineIds(snapshot: ThreadRunProjectionSnapshot): string[] {
  return snapshot.timeline.map((item) => item.id);
}

function upsertTrackedItem(
  items: ThreadRunProjectionTimelineItem[],
  next: ThreadRunProjectionTimelineItem,
): ThreadRunProjectionTimelineItem[] {
  const merged = new Map(items.map((item) => [item.id, item]));
  merged.set(next.id, next);
  return [...merged.values()].sort(compareFeedSkeletonTimelineItems);
}

function collapseSegmentProcessItems(
  items: readonly ThreadRunProjectionTimelineItem[],
  finalItem: ThreadRunProjectionTimelineItem,
  attempts: readonly ThreadRunProjectionAttempt[],
): ThreadRunProjectionTimelineItem[] {
  const boundaries = listFeedSkeletonUserBoundaries(items);
  const segmentKey = buildFeedSkeletonSegmentKey(finalItem, attempts, boundaries);
  const kept = items.filter((item) => {
    if (isSkeletonUserPromptItem(item)) {
      return true;
    }
    if (item.id === finalItem.id) {
      return true;
    }
    return buildFeedSkeletonSegmentKey(item, attempts, boundaries) !== segmentKey;
  });
  return upsertTrackedItem(kept, finalItem);
}

function mergeTrackedItemsWithSkeleton(
  trackedItems: readonly ThreadRunProjectionTimelineItem[],
  skeletonTimeline: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem[] {
  const merged = new Map<string, ThreadRunProjectionTimelineItem>();
  for (const item of trackedItems) {
    merged.set(item.id, item);
  }
  for (const item of skeletonTimeline) {
    merged.set(item.id, item);
  }
  return [...merged.values()].sort(compareFeedSkeletonTimelineItems);
}

function reconcileTrackedItemsAfterAttemptChange(
  items: readonly ThreadRunProjectionTimelineItem[],
  attempts: readonly ThreadRunProjectionAttempt[],
): ThreadRunProjectionTimelineItem[] {
  const runningAttemptIds = new Set(
    attempts.filter((attempt) => attempt.status === "running").map((attempt) => attempt.attemptId),
  );
  const skeletonTimeline = selectSkeletonTimelineItems(items, attempts);
  const skeletonIds = new Set(skeletonTimeline.map((item) => item.id));
  const kept = new Map<string, ThreadRunProjectionTimelineItem>();
  for (const item of items) {
    if (isSkeletonUserPromptItem(item)) {
      kept.set(item.id, item);
      continue;
    }
    if (skeletonIds.has(item.id)) {
      kept.set(item.id, item);
      continue;
    }
    const attemptId = item.runAttemptId?.trim();
    if (attemptId && runningAttemptIds.has(attemptId)) {
      kept.set(item.id, item);
    }
  }
  for (const item of skeletonTimeline) {
    kept.set(item.id, item);
  }
  return [...kept.values()].sort(compareFeedSkeletonTimelineItems);
}
