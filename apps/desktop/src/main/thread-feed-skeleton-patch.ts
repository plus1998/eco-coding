import type { ThreadRunEvent, ThreadRunProjectionAgent } from "../shared/ipc";
import type {
  ThreadRunProjectionAttempt,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../shared/thread-run-projection";
import { FEED_PROJECTION_MAX_AGENT_TIMELINE_ITEMS } from "../shared/thread-run-projection-limits";
import {
  compareFeedSkeletonTimelineItems,
  createFeedSkeletonRunningAttemptMatcher,
  excludeAgentScopedFeedTimelineItems,
  isLiveFeedSkeletonAgent,
  isSkeletonUserPromptItem,
  selectSkeletonTimelineItems,
} from "../shared/thread-run-projection-skeleton";
import {
  FEED_SKELETON_RULES_VERSION,
  type FeedSkeletonPatchState,
  type ThreadFeedSkeletonRecord,
} from "./thread-feed-skeleton-store";
import { isMetricsOnlyThreadRunEvent } from "./thread-run-event-normalizer";
import { eventToTimelineItem } from "./thread-run-projection";
import { trimTimelineItemForFeed } from "./thread-run-projection-feed";
import { collectSettledSdkMessageBlocks } from "./thread-run-message-blocks";
import { stageFeedTimelineEvent, type FeedTimelineStageState } from "./thread-feed-timeline-items";

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

export function createFeedSkeletonPatchState(
  snapshot: ThreadRunProjectionSnapshot,
  events: readonly ThreadRunEvent[] = [],
): FeedSkeletonPatchState {
  return {
    trackedItems: snapshot.timeline.map((item) => ({ ...item })),
    // Seed from the event log the snapshot was projected from: a replayed duplicate block
    // must stay dropped, exactly as the full projection would drop it.
    finalizedSdkBlocks: collectSettledSdkMessageBlocks(events),
    rulesVersion: FEED_SKELETON_RULES_VERSION,
  };
}

export function createThreadFeedSkeletonRecord(
  snapshot: ThreadRunProjectionSnapshot,
  context: FeedSkeletonPatchContext,
  events: readonly ThreadRunEvent[] = [],
): ThreadFeedSkeletonRecord {
  return {
    historyRevision: context.historyRevision,
    maxEventSequence: context.maxEventSequence,
    snapshot,
    patchState: createFeedSkeletonPatchState(snapshot, events),
  };
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
  const agents = mergeSkeletonAgentsForPatch(record.snapshot.agents, context.agents);
  const attemptBecameTerminal = hasFeedSkeletonAttemptBecameTerminal(record.snapshot.attempts, attempts);

  // Tracked items are the source of truth: append the event, never prune here. Bounding
  // happens below through the selection rule, so the incremental path cannot drop content
  // the full rebuild (buildThreadRunProjection -> trimProjectionForFeed) would keep.
  const trackedState: FeedTimelineStageState = {
    items: excludeAgentScopedFeedTimelineItems(record.patchState.trackedItems),
    finalizedSdkBlocks: record.patchState.finalizedSdkBlocks,
  };
  const staged = stageFeedTimelineEvent(trackedState, event);
  let structureChanged =
    staged !== trackedState || trackedState.items.length !== record.patchState.trackedItems.length;
  let nextAgents = agents;

  if (!structureChanged && shouldPatchAgentTimelineForFeedSkeleton(event)) {
    const patchedAgents = upsertAgentScopedItemOntoSkeletonAgents(agents, event);
    if (patchedAgents !== agents) {
      nextAgents = patchedAgents;
      structureChanged = true;
    }
  }

  // A terminal transition (its own event, or an attempt status flip observed from the
  // store) changes what the selection keeps, so re-derive even without new items.
  if (!structureChanged && (isFeedSkeletonTerminalEventType(event.eventType) || attemptBecameTerminal)) {
    structureChanged = true;
  }

  if (!structureChanged) {
    return record.maxEventSequence === context.maxEventSequence
      ? record
      : {
          ...record,
          maxEventSequence: context.maxEventSequence,
        };
  }

  // One selection pass feeds both the wire timeline and the tracked set bound.
  const timeline = selectSkeletonTimelineItems(staged.items, attempts).map((item) => ({ ...item }));
  return {
    historyRevision: context.historyRevision,
    maxEventSequence: context.maxEventSequence,
    snapshot: buildPatchedFeedSkeletonSnapshot(record, {
      attempts,
      agents: nextAgents,
      timeline,
      historyRevision: context.historyRevision,
      maxEventSequence: context.maxEventSequence,
    }),
    patchState: {
      trackedItems: reconcileFeedSkeletonTrackedItems(staged.items, attempts),
      finalizedSdkBlocks: [...staged.finalizedSdkBlocks],
      rulesVersion: FEED_SKELETON_RULES_VERSION,
    },
  };
}

function buildPatchedFeedSkeletonSnapshot(
  record: ThreadFeedSkeletonRecord,
  input: {
    attempts: readonly ThreadRunProjectionAttempt[];
    agents: readonly ThreadRunProjectionAgent[];
    timeline: readonly ThreadRunProjectionTimelineItem[];
    historyRevision: number;
    maxEventSequence: number;
  },
): ThreadRunProjectionSnapshot {
  const currentAttemptId =
    input.attempts.find((attempt) => attempt.status === "running")?.attemptId ??
    input.attempts.at(-1)?.attemptId;
  return {
    ...record.snapshot,
    thread: {
      ...record.snapshot.thread,
      generatedAt: new Date().toISOString(),
      ...(currentAttemptId ? { currentAttemptId } : {}),
    },
    attempts: [...input.attempts],
    agents: [...input.agents],
    timeline: [...input.timeline],
    sourceEventCount: Math.max(record.snapshot.sourceEventCount, input.maxEventSequence),
    historyRevision: input.historyRevision,
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

function upsertTimelineItem(
  items: readonly ThreadRunProjectionTimelineItem[],
  next: ThreadRunProjectionTimelineItem,
): ThreadRunProjectionTimelineItem[] {
  const merged = new Map(items.map((item) => [item.id, item]));
  merged.set(next.id, next);
  return [...merged.values()].sort(compareFeedSkeletonTimelineItems);
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
  const timeline = upsertTimelineItem(agent.timeline, item);
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

/**
 * Bounds the tracked set to what the selection can still need: the selected items, the user
 * boundaries, and the whole trail of attempts that are still running. Also used when only
 * attempt states changed (a run finished without its own event), where re-selecting the
 * tracked items is enough and no event log read is required.
 */
export function reconcileFeedSkeletonTrackedItems(
  items: readonly ThreadRunProjectionTimelineItem[],
  attempts: readonly ThreadRunProjectionAttempt[],
): ThreadRunProjectionTimelineItem[] {
  const isOnRunningAttempt = createFeedSkeletonRunningAttemptMatcher(attempts);
  const skeletonTimeline = selectSkeletonTimelineItems(items, attempts);
  const skeletonIds = new Set(skeletonTimeline.map((item) => item.id));
  const kept = new Map<string, ThreadRunProjectionTimelineItem>();
  for (const item of items) {
    if (isSkeletonUserPromptItem(item)) {
      kept.set(item.id, item);
      continue;
    }
    if (skeletonIds.has(item.id) || isOnRunningAttempt(item)) {
      kept.set(item.id, item);
    }
  }
  for (const item of skeletonTimeline) {
    kept.set(item.id, item);
  }
  return [...kept.values()].sort(compareFeedSkeletonTimelineItems);
}
