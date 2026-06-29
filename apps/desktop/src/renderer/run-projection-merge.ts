import type {
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../shared/ipc";
import {
  isRecordedUserPromptLiveEvent,
  isThreadFollowUpActivityMessage,
} from "../shared/thread-follow-up-events";
import { isThinkingTextContinuation } from "./thread-run-projection-view";

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

function isStreamTimelineItem(item: ThreadRunProjectionTimelineItem): boolean {
  return (
    item.eventType === "thinking.delta" ||
    item.eventType === "thinking.final" ||
    item.eventType === "message.delta" ||
    item.eventType === "message.final"
  );
}

function projectionLiveType(item: ThreadRunProjectionTimelineItem): string | undefined {
  const liveType = item.metadata?.liveType;
  return typeof liveType === "string" ? liveType : undefined;
}

function isProjectionUserPromptItem(item: ThreadRunProjectionTimelineItem): boolean {
  if (!isRecordedUserPromptLiveEvent(projectionLiveType(item))) {
    return false;
  }
  return item.text.trim().length > 0 && !isThreadFollowUpActivityMessage(item.text);
}

function hasUserPromptBetween(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  current: ThreadRunProjectionTimelineItem,
  incoming: ThreadRunProjectionTimelineItem,
): boolean {
  if (compareTimelineItems(current, incoming) >= 0) {
    return false;
  }
  return timeline.some(
    (item) =>
      isProjectionUserPromptItem(item) &&
      compareTimelineItems(current, item) < 0 &&
      compareTimelineItems(item, incoming) < 0,
  );
}

function preserveStreamTimelineText(
  current: ThreadRunProjectionTimelineItem,
  incoming: ThreadRunProjectionTimelineItem,
  timeline: readonly ThreadRunProjectionTimelineItem[],
): string {
  if (shouldResetThinkingStreamMergeForMerge(current, incoming, timeline)) {
    return incoming.text;
  }
  if (!incoming.text.trim()) {
    return current.text;
  }
  if (!current.text.trim()) {
    return incoming.text;
  }
  return incoming.text.length >= current.text.length ? incoming.text : current.text;
}

function shouldResetThinkingStreamMergeForMerge(
  current: ThreadRunProjectionTimelineItem,
  incoming: ThreadRunProjectionTimelineItem,
  timeline: readonly ThreadRunProjectionTimelineItem[],
): boolean {
  const isThinking =
    current.eventType === "thinking.delta" ||
    current.eventType === "thinking.final" ||
    incoming.eventType === "thinking.delta" ||
    incoming.eventType === "thinking.final";
  if (!isThinking) {
    return false;
  }
  const currentRequestId = current.requestId?.trim();
  const incomingRequestId = incoming.requestId?.trim();
  if (currentRequestId && incomingRequestId && currentRequestId !== incomingRequestId) {
    return true;
  }
  if (hasUserPromptBetween(timeline, current, incoming)) {
    return true;
  }
  if (current.eventType === "thinking.final" && current.id !== incoming.id) {
    return true;
  }
  if (current.id !== incoming.id && !isThinkingTextContinuation(current.text, incoming.text)) {
    return true;
  }
  return false;
}

function mergeStreamTimelineItem(
  current: ThreadRunProjectionTimelineItem,
  incoming: ThreadRunProjectionTimelineItem,
  timeline: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem {
  if (!isStreamTimelineItem(current) || !isStreamTimelineItem(incoming)) {
    return incoming;
  }
  const text = preserveStreamTimelineText(current, incoming, timeline);
  if (text === incoming.text) {
    return incoming;
  }
  return { ...incoming, text };
}

function mergeProjectionTimelines(
  current: readonly ThreadRunProjectionTimelineItem[],
  incoming: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem[] {
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const merged = current.map((item) => {
    const update = incomingById.get(item.id);
    return update ? mergeStreamTimelineItem(item, update, incoming) : item;
  });
  const knownIds = new Set(merged.map((item) => item.id));
  for (const item of incoming) {
    if (!knownIds.has(item.id)) {
      merged.push(item);
      knownIds.add(item.id);
    }
  }
  merged.sort(compareTimelineItems);
  return merged;
}

function mergeTrimmedIncomingProjection(
  current: ThreadRunProjectionSnapshot,
  incoming: ThreadRunProjectionSnapshot,
): ThreadRunProjectionSnapshot {
  return {
    ...incoming,
    timeline: mergeProjectionTimelines(current.timeline, incoming.timeline),
    sourceEventCount: Math.max(current.sourceEventCount, incoming.sourceEventCount),
  };
}

function mergeIncomingProjection(
  current: ThreadRunProjectionSnapshot,
  incoming: ThreadRunProjectionSnapshot,
): ThreadRunProjectionSnapshot {
  return {
    ...incoming,
    timeline: mergeProjectionTimelines(current.timeline, incoming.timeline),
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
    return mergeIncomingProjection(current, incoming);
  }

  if (incoming.sourceEventCount === current.sourceEventCount) {
    if (incoming.timeline.length > current.timeline.length) {
      return mergeIncomingProjection(current, incoming);
    }
    if (incoming.timeline.length < current.timeline.length) {
      return current;
    }
    if (incoming.thread.generatedAt >= current.thread.generatedAt) {
      return mergeIncomingProjection(current, incoming);
    }
    return current;
  }

  // sourceEventCount decreased — likely due to context compaction.
  // Always merge so that post-compaction timeline items are not lost.
  if (incoming.timeline.length > current.timeline.length) {
    return mergeTrimmedIncomingProjection(current, incoming);
  }
  if (preserveHistory) {
    return mergeTrimmedIncomingProjection(current, incoming);
  }
  return mergeTrimmedIncomingProjection(current, incoming);
}
