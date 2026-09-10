import { isRecordedUserPromptLiveEvent, isThreadFollowUpActivityMessage } from "./thread-follow-up-events";
import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionAttempt,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "./thread-run-projection";

export function compareFeedSkeletonTimelineItems(
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

export function isLiveFeedSkeletonAgent(
  agent: Pick<ThreadRunProjectionAgent, "status">,
): boolean {
  return agent.status === "active" || agent.status === "launching";
}

export function isAgentScopedFeedTimelineItem(
  item: Pick<ThreadRunProjectionTimelineItem, "scope">,
): boolean {
  return item.scope === "agent";
}

export function excludeAgentScopedFeedTimelineItems(
  timeline: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem[] {
  if (!timeline.some((item) => isAgentScopedFeedTimelineItem(item))) {
    return timeline as ThreadRunProjectionTimelineItem[];
  }
  return timeline.filter((item) => !isAgentScopedFeedTimelineItem(item));
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

/**
 * Minimal shape needed to resolve which attempt an item belongs to. Both timeline
 * items and raw run events can be resolved through {@link createFeedSkeletonAttemptResolver}.
 */
export type FeedSkeletonAttemptResolvable = {
  at: string;
  runAttemptId?: string | undefined;
};

function resolveItemAttempt(
  item: FeedSkeletonAttemptResolvable,
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

/**
 * Canonical attempt resolver for Feed skeleton decisions (segment keys, selection and
 * incremental patches). `attempts` is sorted once so callers can resolve in loops.
 *
 * Events may lack `runAttemptId`; the time-window fallback is what makes
 * `selectSkeletonTimelineItems` treat such rows as part of the surrounding attempt, so
 * every consumer must resolve through this factory instead of matching the explicit id.
 */
export function createFeedSkeletonAttemptResolver(
  attempts: readonly ThreadRunProjectionAttempt[],
): (item: FeedSkeletonAttemptResolvable) => ThreadRunProjectionAttempt | undefined {
  const sortedAttempts = [...attempts].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  return (item) => resolveItemAttempt(item, sortedAttempts);
}

/**
 * Tests whether an item resolves to an attempt that is still running. Resolves the attempts
 * once so callers can filter whole timelines without rebuilding the resolver per item.
 */
export function createFeedSkeletonRunningAttemptMatcher(
  attempts: readonly ThreadRunProjectionAttempt[],
): (item: FeedSkeletonAttemptResolvable) => boolean {
  const runningAttemptIds = new Set(
    attempts.filter((attempt) => attempt.status === "running").map((attempt) => attempt.attemptId),
  );
  if (runningAttemptIds.size === 0) {
    return () => false;
  }
  const resolveAttempt = createFeedSkeletonAttemptResolver(attempts);
  return (item) => {
    const attempt = resolveAttempt(item);
    return attempt !== undefined && runningAttemptIds.has(attempt.attemptId);
  };
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

/**
 * The only Feed timeline rule: what the user sees is a pure function of the tracked items
 * and the current attempt states. Running attempts keep their whole trail; finished
 * segments keep a single final (the last narrative body, else the failure row). Write
 * paths must never prune items themselves — that decision lives here alone.
 */
export function selectSkeletonTimelineItems(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  attempts: readonly ThreadRunProjectionAttempt[],
): ThreadRunProjectionTimelineItem[] {
  const mainTimeline = excludeAgentScopedFeedTimelineItems(timeline);
  const resolveAttempt = createFeedSkeletonAttemptResolver(attempts);
  const runningAttemptIds = new Set(
    attempts.filter((attempt) => attempt.status === "running").map((attempt) => attempt.attemptId),
  );
  const userItems = mainTimeline.filter(isSkeletonUserPromptItem);
  const boundaries: UserPromptBoundary[] = userItems
    .map((item) => ({ sequence: item.sequence, at: item.at }))
    .sort((left, right) => left.sequence - right.sequence);
  const kept = new Map<string, ThreadRunProjectionTimelineItem>();
  for (const item of userItems) {
    kept.set(item.id, item);
  }

  const segments = new Map<string, ThreadRunProjectionTimelineItem[]>();
  for (const item of mainTimeline) {
    if (isSkeletonUserPromptItem(item)) {
      continue;
    }
    const attempt = resolveAttempt(item);
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

  return [...kept.values()].sort(compareFeedSkeletonTimelineItems);
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
      timeline: isLiveFeedSkeletonAgent(agent) ? agent.timeline : [],
    })),
  };
}
