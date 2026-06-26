import type {
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../shared/ipc";

export interface MergeThreadRunProjectionOptions {
  /** When true, reject trimmed feed updates that would drop older timeline items. */
  preserveHistory?: boolean;
}

function compareTimelineItems(
  left: ThreadRunProjectionTimelineItem,
  right: ThreadRunProjectionTimelineItem,
): number {
  const sequenceDiff = left.sequence - right.sequence;
  if (sequenceDiff !== 0) {
    return sequenceDiff;
  }
  return left.at.localeCompare(right.at);
}

function mergeTrimmedIncomingProjection(
  current: ThreadRunProjectionSnapshot,
  incoming: ThreadRunProjectionSnapshot,
): ThreadRunProjectionSnapshot {
  const incomingById = new Map(incoming.timeline.map((item) => [item.id, item]));
  const mergedTimeline = current.timeline.map((item) => incomingById.get(item.id) ?? item);
  const knownIds = new Set(mergedTimeline.map((item) => item.id));
  for (const item of incoming.timeline) {
    if (!knownIds.has(item.id)) {
      mergedTimeline.push(item);
      knownIds.add(item.id);
    }
  }
  mergedTimeline.sort(compareTimelineItems);
  return {
    ...incoming,
    timeline: mergedTimeline,
    sourceEventCount: Math.max(current.sourceEventCount, incoming.sourceEventCount),
  };
}

export function mergeThreadRunProjectionUpdate(
  current: ThreadRunProjectionSnapshot | undefined,
  incoming: ThreadRunProjectionSnapshot,
  options?: MergeThreadRunProjectionOptions,
): ThreadRunProjectionSnapshot {
  if (!current) {
    return incoming;
  }

  const preserveHistory = options?.preserveHistory === true;

  if (incoming.sourceEventCount > current.sourceEventCount) {
    if (incoming.timeline.length < current.timeline.length) {
      return mergeTrimmedIncomingProjection(current, incoming);
    }
    return incoming;
  }

  if (incoming.sourceEventCount === current.sourceEventCount) {
    if (incoming.timeline.length > current.timeline.length) {
      return incoming;
    }
    if (incoming.timeline.length < current.timeline.length) {
      return current;
    }
    return incoming.thread.generatedAt >= current.thread.generatedAt ? incoming : current;
  }

  if (incoming.timeline.length > current.timeline.length) {
    return incoming;
  }
  if (preserveHistory) {
    return current;
  }
  return current;
}
