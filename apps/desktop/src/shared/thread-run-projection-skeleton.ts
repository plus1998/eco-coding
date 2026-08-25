import {
  isRecordedUserPromptLiveEvent,
  isThreadFollowUpActivityMessage,
} from "./thread-follow-up-events";
import type {
  ThreadRunProjectionAttempt,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "./thread-run-projection";

function compareTimelineItems(
  left: ThreadRunProjectionTimelineItem,
  right: ThreadRunProjectionTimelineItem,
): number {
  const sequenceDiff = left.sequence - right.sequence;
  if (sequenceDiff !== 0) {
    return sequenceDiff;
  }
  const atDiff = left.at.localeCompare(right.at);
  if (atDiff !== 0) {
    return atDiff;
  }
  return left.id.localeCompare(right.id);
}

function projectionLiveType(item: ThreadRunProjectionTimelineItem): string | undefined {
  const liveType = item.metadata?.liveType;
  return typeof liveType === "string" ? liveType : undefined;
}

export function isSkeletonUserPromptItem(item: ThreadRunProjectionTimelineItem): boolean {
  const liveType = projectionLiveType(item);
  const textOk = item.text.trim().length > 0 && !isThreadFollowUpActivityMessage(item.text);
  if (!textOk) {
    return false;
  }
  if (isRecordedUserPromptLiveEvent(liveType)) {
    return true;
  }
  return liveType === "message.user" && item.role === "user" && item.scope !== "agent";
}

function isStreamNarrativeItem(item: ThreadRunProjectionTimelineItem): boolean {
  return (
    item.eventType === "message.delta" ||
    item.eventType === "message.final" ||
    item.eventType === "thinking.delta" ||
    item.eventType === "thinking.final"
  );
}

function isSkeletonNarrativeFinalItem(item: ThreadRunProjectionTimelineItem): boolean {
  if (item.eventType !== "message.final") {
    return false;
  }
  if (item.role === "user" || item.role === "tool" || item.role === "thinking") {
    return false;
  }
  return item.text.trim().length > 0;
}

function isSkeletonFailureFinalItem(item: ThreadRunProjectionTimelineItem): boolean {
  return item.eventType === "api.error" || item.eventType === "tool.failed";
}

export function isSkeletonTurnFinalItem(item: ThreadRunProjectionTimelineItem): boolean {
  return isSkeletonNarrativeFinalItem(item) || isSkeletonFailureFinalItem(item);
}

function resolveItemAttempt(
  item: ThreadRunProjectionTimelineItem,
  attempts: readonly ThreadRunProjectionAttempt[],
): ThreadRunProjectionAttempt | undefined {
  const explicitId = item.runAttemptId?.trim();
  if (explicitId) {
    const explicit = attempts.find((attempt) => attempt.attemptId === explicitId);
    if (explicit) {
      return explicit;
    }
  }
  const at = item.at;
  let candidate: ThreadRunProjectionAttempt | undefined;
  for (const attempt of attempts) {
    if (attempt.startedAt > at) {
      break;
    }
    candidate = attempt;
  }
  return candidate;
}

type UserPromptBoundary = {
  sequence: number;
  at: string;
};

function lastUserBoundaryForItem(
  boundaries: readonly UserPromptBoundary[],
  item: ThreadRunProjectionTimelineItem,
): UserPromptBoundary | undefined {
  let found: UserPromptBoundary | undefined;
  const useObservedAt = isStreamNarrativeItem(item);
  for (const boundary of boundaries) {
    if (useObservedAt) {
      if (boundary.at < item.at) {
        found = boundary;
        continue;
      }
      break;
    }
    if (boundary.sequence < item.sequence) {
      found = boundary;
      continue;
    }
    break;
  }
  return found;
}

function pickSegmentFinal(
  items: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item && isSkeletonNarrativeFinalItem(item)) {
      return item;
    }
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item && isSkeletonFailureFinalItem(item)) {
      return item;
    }
  }
  return undefined;
}

export function selectSkeletonTimelineItems(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  attempts: readonly ThreadRunProjectionAttempt[],
): ThreadRunProjectionTimelineItem[] {
  const sortedAttempts = [...attempts].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const runningAttemptIds = new Set(
    sortedAttempts.filter((attempt) => attempt.status === "running").map((attempt) => attempt.attemptId),
  );
  const userItems = timeline.filter(isSkeletonUserPromptItem);
  const boundaries: UserPromptBoundary[] = userItems
    .map((item) => ({ sequence: item.sequence, at: item.at }))
    .sort((left, right) => left.sequence - right.sequence);
  const kept = new Map<string, ThreadRunProjectionTimelineItem>();
  for (const item of userItems) {
    kept.set(item.id, item);
  }

  const segments = new Map<string, ThreadRunProjectionTimelineItem[]>();
  for (const item of timeline) {
    if (isSkeletonUserPromptItem(item)) {
      continue;
    }
    const attempt = resolveItemAttempt(item, sortedAttempts);
    if (attempt && runningAttemptIds.has(attempt.attemptId)) {
      kept.set(item.id, item);
      continue;
    }
    const afterUserSequence = lastUserBoundaryForItem(boundaries, item)?.sequence ?? 0;
    const key = `${attempt?.attemptId ?? "orphan"}#after:${afterUserSequence}`;
    const bucket = segments.get(key) ?? [];
    bucket.push(item);
    segments.set(key, bucket);
  }

  for (const bucket of segments.values()) {
    const finalItem = pickSegmentFinal(bucket);
    if (finalItem) {
      kept.set(finalItem.id, finalItem);
    }
  }

  return [...kept.values()].sort(compareTimelineItems);
}

export function buildSkeletonFeedProjection(
  snapshot: ThreadRunProjectionSnapshot,
): ThreadRunProjectionSnapshot {
  const timeline = selectSkeletonTimelineItems(snapshot.timeline, snapshot.attempts);
  const { hasEarlier: _ignoredHasEarlier, ...rest } = snapshot;
  return {
    ...rest,
    timeline,
    agents: snapshot.agents.map((agent) => ({
      ...agent,
      timeline: [],
    })),
  };
}
