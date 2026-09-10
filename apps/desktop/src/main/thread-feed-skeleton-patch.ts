import type { ThreadRunEvent, ThreadRunProjectionAgent } from "../shared/ipc";
import type {
  ThreadRunProjectionAttempt,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../shared/thread-run-projection";
import { FEED_PROJECTION_MAX_AGENT_TIMELINE_ITEMS } from "../shared/thread-run-projection-limits";
import {
  buildFeedSkeletonSegmentKey,
  compareFeedSkeletonTimelineItems,
  excludeAgentScopedFeedTimelineItems,
  isLiveFeedSkeletonAgent,
  isSkeletonTurnFinalItem,
  isSkeletonUserPromptItem,
  listFeedSkeletonUserBoundaries,
  selectSkeletonTimelineItems,
} from "../shared/thread-run-projection-skeleton";
import type { FeedSkeletonPatchState, ThreadFeedSkeletonRecord } from "./thread-feed-skeleton-store";
import { isMetricsOnlyThreadRunEvent } from "./thread-run-event-normalizer";
import { eventToTimelineItem } from "./thread-run-projection";
import { trimTimelineItemForFeed } from "./thread-run-projection-feed";

export interface FeedSkeletonPatchContext {
  attempts: readonly ThreadRunProjectionAttempt[];
  agents: readonly ThreadRunProjectionAgent[];
  historyRevision: number;
  maxEventSequence: number;
}

/** Attempt / request terminal events that must compact Feed skeleton (align with replay). */
export const FEED_SKELETON_TERMINAL_EVENT_TYPES = new Set<string>([
  "run.attempt.completed",
  "run.attempt.failed",
  "run.attempt.cancelled",
  "request.completed",
  "request.failed",
  "request.cancelled",
]);

export function isFeedSkeletonTerminalEventType(eventType: string): boolean {
  return FEED_SKELETON_TERMINAL_EVENT_TYPES.has(eventType);
}

/** True when any attempt moved from running → terminal between snapshot and live context. */
export function hasFeedSkeletonAttemptBecameTerminal(
  snapshotAttempts: readonly ThreadRunProjectionAttempt[],
  liveAttempts: readonly ThreadRunProjectionAttempt[],
): boolean {
  const liveById = new Map(liveAttempts.map((attempt) => [attempt.attemptId, attempt.status]));
  for (const snapshot of snapshotAttempts) {
    if (snapshot.status !== "running") {
      continue;
    }
    const liveStatus = liveById.get(snapshot.attemptId);
    if (liveStatus !== undefined && liveStatus !== "running") {
      return true;
    }
  }
  return false;
}

export function createFeedSkeletonPatchState(snapshot: ThreadRunProjectionSnapshot): FeedSkeletonPatchState {
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
  if (isFeedSkeletonTerminalEventType(event.eventType)) {
    return false;
  }
  if (event.eventType.startsWith("agent.")) {
    return false;
  }
  if (event.eventType.startsWith("run.attempt.")) {
    return false;
  }
  if (event.eventType.startsWith("request.")) {
    return false;
  }
  if (event.scope === "agent") {
    return false;
  }

  const item = eventToTimelineItem(event);
  if (isSkeletonUserPromptItem(item)) {
    return true;
  }

  const attemptId = event.runAttemptId?.trim();
  const attempt = attemptId ? attempts.find((candidate) => candidate.attemptId === attemptId) : undefined;
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

export function shouldPatchAgentTimelineForFeedSkeleton(event: ThreadRunEvent): boolean {
  if (isMetricsOnlyThreadRunEvent(event)) {
    return false;
  }
  if (event.eventType.startsWith("agent.")) {
    return false;
  }
  return event.scope === "agent" && Boolean(event.agentId?.trim());
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
  let agents = mergeSkeletonAgentsForPatch(record.snapshot.agents, context.agents);
  let trackedItems = excludeAgentScopedFeedTimelineItems(
    record.patchState.trackedItems.map((item) => ({ ...item })),
  );
  let structureChanged = trackedItems.length !== record.patchState.trackedItems.length;

  const attemptBecameTerminal = hasFeedSkeletonAttemptBecameTerminal(record.snapshot.attempts, attempts);

  if (shouldTrackEventForFeedSkeletonPatch(event, attempts)) {
    const item = trimTimelineItemForFeed(eventToTimelineItem(event));
    trackedItems = upsertTrackedItem(trackedItems, item);
    if (isSkeletonTurnFinalItem(item) && !isTrackedItemOnRunningAttempt(item, attempts)) {
      // Live turns must keep every process row (selectSkeletonTimelineItems keeps
      // the full running-attempt trail). Collapsing here dropped earlier
      // message.final bodies when the model spoke multiple times between tools
      // (e.g. thr_1789062621587: 7 finals in events, 1 left in Feed skeleton).
      trackedItems = collapseSegmentProcessItems(trackedItems, item, attempts);
    }
    structureChanged = true;
  } else if (isFeedSkeletonTerminalEventType(event.eventType) || attemptBecameTerminal) {
    trackedItems = reconcileTrackedItemsAfterAttemptChange(trackedItems, attempts);
    structureChanged = true;
  } else {
    if (shouldPatchAgentTimelineForFeedSkeleton(event)) {
      const nextAgents = upsertAgentScopedItemOntoSkeletonAgents(agents, event);
      if (nextAgents !== agents) {
        agents = nextAgents;
        structureChanged = true;
      }
    }
    if (!structureChanged && !isMetricsOnlyThreadRunEvent(event)) {
      return record.maxEventSequence === context.maxEventSequence
        ? record
        : {
            ...record,
            maxEventSequence: context.maxEventSequence,
          };
    }
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
          attempts.find((attempt) => attempt.status === "running")?.attemptId ?? attempts.at(-1)?.attemptId;
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

function mergeSkeletonAgentsForPatch(
  snapshotAgents: readonly ThreadRunProjectionAgent[],
  contextAgents: readonly ThreadRunProjectionAgent[],
): ThreadRunProjectionAgent[] {
  const snapshotById = new Map(snapshotAgents.map((agent) => [agent.agentId, agent]));
  const seen = new Set<string>();
  const merged: ThreadRunProjectionAgent[] = [];
  for (const agent of contextAgents) {
    seen.add(agent.agentId);
    const existing = snapshotById.get(agent.agentId);
    if (!isLiveFeedSkeletonAgent(agent)) {
      merged.push({
        ...agent,
        timeline: [],
      });
      continue;
    }
    merged.push({
      ...agent,
      timeline: existing?.timeline ?? agent.timeline,
      ...(existing?.latestActivity
        ? { latestActivity: existing.latestActivity }
        : agent.latestActivity
          ? { latestActivity: agent.latestActivity }
          : {}),
    });
  }
  for (const agent of snapshotAgents) {
    if (seen.has(agent.agentId)) {
      continue;
    }
    merged.push(isLiveFeedSkeletonAgent(agent) ? agent : { ...agent, timeline: [] });
  }
  return merged;
}

function latestSkeletonAgentActivity(
  timeline: readonly ThreadRunProjectionTimelineItem[],
): string | undefined {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const text = timeline[index]?.text.trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

function upsertAgentScopedItemOntoSkeletonAgents(
  agents: readonly ThreadRunProjectionAgent[],
  event: ThreadRunEvent,
): ThreadRunProjectionAgent[] {
  const agentId = event.agentId?.trim();
  if (!agentId) {
    return agents as ThreadRunProjectionAgent[];
  }
  const index = agents.findIndex((agent) => agent.agentId === agentId);
  if (index < 0) {
    return agents as ThreadRunProjectionAgent[];
  }
  const agent = agents[index];
  if (!agent || !isLiveFeedSkeletonAgent(agent)) {
    return agents as ThreadRunProjectionAgent[];
  }
  const item = trimTimelineItemForFeed(eventToTimelineItem(event));
  const timeline = upsertTrackedItem(agent.timeline, item);
  const capped =
    timeline.length > FEED_PROJECTION_MAX_AGENT_TIMELINE_ITEMS
      ? timeline.slice(-FEED_PROJECTION_MAX_AGENT_TIMELINE_ITEMS)
      : timeline;
  const activity = latestSkeletonAgentActivity(capped) ?? agent.latestActivity;
  const nextAgent: ThreadRunProjectionAgent = {
    ...agent,
    timeline: capped,
    ...(activity ? { latestActivity: activity } : {}),
  };
  return agents.map((candidate, candidateIndex) => (candidateIndex === index ? nextAgent : candidate));
}

function upsertTrackedItem(
  items: ThreadRunProjectionTimelineItem[],
  next: ThreadRunProjectionTimelineItem,
): ThreadRunProjectionTimelineItem[] {
  const merged = new Map(items.map((item) => [item.id, item]));
  merged.set(next.id, next);
  return [...merged.values()].sort(compareFeedSkeletonTimelineItems);
}

function isTrackedItemOnRunningAttempt(
  item: ThreadRunProjectionTimelineItem,
  attempts: readonly ThreadRunProjectionAttempt[],
): boolean {
  const attemptId = item.runAttemptId?.trim();
  if (!attemptId) {
    return false;
  }
  return attempts.some((attempt) => attempt.attemptId === attemptId && attempt.status === "running");
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
    if (buildFeedSkeletonSegmentKey(item, attempts, boundaries) !== segmentKey) {
      return true;
    }
    // A later tool.failed / api.error must not wipe earlier message.final bodies;
    // selectSkeleton/reconcile still picks the authoritative segment final.
    if (isSkeletonTurnFinalItem(item)) {
      return true;
    }
    return false;
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
