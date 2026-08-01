import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../shared/ipc";
import {
  isRecordedUserPromptLiveEvent,
  isThreadFollowUpActivityMessage,
} from "../shared/thread-follow-up-events";
import {
  FEED_PROJECTION_MAX_AGENT_TIMELINE_ITEMS,
  FEED_PROJECTION_MAX_MAIN_TIMELINE_ITEMS,
} from "../shared/thread-run-projection-limits";
import { isThinkingTextContinuation } from "./thread-run-projection-view";

export interface MergeThreadRunProjectionOptions {
  /** When true, reject trimmed feed updates that would drop older timeline items. */
  preserveHistory?: boolean;
}

function projectionHistoryRevision(snapshot: ThreadRunProjectionSnapshot): number {
  const revision = snapshot.historyRevision;
  return typeof revision === "number" && Number.isFinite(revision) ? revision : 0;
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

function timelineItemsEqual(
  current: ThreadRunProjectionTimelineItem,
  incoming: ThreadRunProjectionTimelineItem,
): boolean {
  return (
    current === incoming ||
    (current.id === incoming.id &&
      current.sequence === incoming.sequence &&
      current.eventType === incoming.eventType &&
      current.scope === incoming.scope &&
      current.role === incoming.role &&
      current.agentId === incoming.agentId &&
      current.requestId === incoming.requestId &&
      current.streamKey === incoming.streamKey &&
      current.text === incoming.text &&
      current.at === incoming.at &&
      JSON.stringify(current.metadata ?? null) === JSON.stringify(incoming.metadata ?? null))
  );
}

function mergeProjectionTimelines(
  current: readonly ThreadRunProjectionTimelineItem[],
  incoming: readonly ThreadRunProjectionTimelineItem[],
  maxItems: number,
): ThreadRunProjectionTimelineItem[] {
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  let changed = false;
  const merged = current.map((item) => {
    const update = incomingById.get(item.id);
    if (!update) {
      return item;
    }
    const next = mergeStreamTimelineItem(item, update, incoming);
    if (timelineItemsEqual(item, next)) {
      return item;
    }
    changed = true;
    return next;
  });
  const knownIds = new Set(merged.map((item) => item.id));
  for (const item of incoming) {
    if (!knownIds.has(item.id)) {
      merged.push(item);
      knownIds.add(item.id);
      changed = true;
    }
  }
  if (!changed && current.length <= maxItems) {
    return current as ThreadRunProjectionTimelineItem[];
  }
  if (changed) {
    merged.sort(compareTimelineItems);
  }
  return merged.slice(-maxItems);
}

function projectionAgentStableSignature(agent: ThreadRunProjectionAgent): string {
  const isActive = agent.status === "active" || agent.status === "launching";
  return JSON.stringify({
    agentId: agent.agentId,
    role: agent.role,
    kind: agent.kind,
    status: agent.status,
    startedAt: agent.startedAt,
    durationMs: isActive ? undefined : agent.durationMs,
    runAttemptId: agent.runAttemptId,
    parentAgentId: agent.parentAgentId,
    parentToolUseId: agent.parentToolUseId,
    mission: agent.mission,
    delegationSummary: agent.delegationSummary,
    delegationPrompt: agent.delegationPrompt,
    taskName: agent.taskName,
    nickname: agent.nickname,
    todoId: agent.todoId,
    endedAt: agent.endedAt,
    latestActivity: agent.latestActivity,
    usage: agent.usage,
    context: agent.context,
  });
}

function mergeProjectionAgents(
  current: readonly ThreadRunProjectionAgent[],
  incoming: readonly ThreadRunProjectionAgent[],
): ThreadRunProjectionAgent[] {
  const currentById = new Map(current.map((agent) => [agent.agentId, agent]));
  const incomingIds = new Set(incoming.map((agent) => agent.agentId));
  let changed = false;
  const merged = incoming.map((agent) => {
    const currentAgent = currentById.get(agent.agentId);
    if (!currentAgent) {
      changed = true;
      return agent;
    }
    const timeline = mergeProjectionTimelines(
      currentAgent.timeline,
      agent.timeline,
      FEED_PROJECTION_MAX_AGENT_TIMELINE_ITEMS,
    );
    const nextAgent = {
      ...agent,
      timeline,
    };
    if (
      timeline === currentAgent.timeline &&
      projectionAgentStableSignature(currentAgent) === projectionAgentStableSignature(nextAgent)
    ) {
      return currentAgent;
    }
    changed = true;
    return {
      ...nextAgent,
    };
  });

  for (const agent of current) {
    if (!incomingIds.has(agent.agentId)) {
      merged.push(agent);
    }
  }
  if (!changed) {
    return current as ThreadRunProjectionAgent[];
  }
  return merged;
}

function mergeTrimmedIncomingProjection(
  current: ThreadRunProjectionSnapshot,
  incoming: ThreadRunProjectionSnapshot,
): ThreadRunProjectionSnapshot {
  const timeline = mergeProjectionTimelines(
    current.timeline,
    incoming.timeline,
    FEED_PROJECTION_MAX_MAIN_TIMELINE_ITEMS,
  );
  const agents = mergeProjectionAgents(current.agents, incoming.agents);
  if (
    timeline === current.timeline &&
    agents === current.agents &&
    incoming.sourceEventCount === current.sourceEventCount &&
    projectionThreadStableSignature(incoming) === projectionThreadStableSignature(current) &&
    JSON.stringify(incoming.attempts) === JSON.stringify(current.attempts) &&
    JSON.stringify(incoming.requestSpans) === JSON.stringify(current.requestSpans) &&
    JSON.stringify(incoming.diagnostics) === JSON.stringify(current.diagnostics)
  ) {
    return current;
  }
  return {
    ...incoming,
    timeline,
    agents,
    sourceEventCount: Math.max(current.sourceEventCount, incoming.sourceEventCount),
  };
}

function mergeIncomingProjection(
  current: ThreadRunProjectionSnapshot,
  incoming: ThreadRunProjectionSnapshot,
): ThreadRunProjectionSnapshot {
  const timeline = mergeProjectionTimelines(
    current.timeline,
    incoming.timeline,
    FEED_PROJECTION_MAX_MAIN_TIMELINE_ITEMS,
  );
  const agents = mergeProjectionAgents(current.agents, incoming.agents);
  if (
    timeline === current.timeline &&
    agents === current.agents &&
    incoming.sourceEventCount === current.sourceEventCount &&
    projectionThreadStableSignature(incoming) === projectionThreadStableSignature(current) &&
    JSON.stringify(incoming.attempts) === JSON.stringify(current.attempts) &&
    JSON.stringify(incoming.requestSpans) === JSON.stringify(current.requestSpans) &&
    JSON.stringify(incoming.diagnostics) === JSON.stringify(current.diagnostics)
  ) {
    return current;
  }
  return {
    ...incoming,
    timeline,
    agents,
    sourceEventCount: Math.max(current.sourceEventCount, incoming.sourceEventCount),
  };
}

function projectionThreadStableSignature(snapshot: ThreadRunProjectionSnapshot): string {
  return JSON.stringify({
    threadId: snapshot.thread.threadId,
    status: snapshot.thread.status,
    message: snapshot.thread.message,
    currentAttemptId: snapshot.thread.currentAttemptId,
  });
}

export function mergeThreadRunProjectionUpdate(
  current: ThreadRunProjectionSnapshot | undefined,
  incoming: ThreadRunProjectionSnapshot,
  options?: MergeThreadRunProjectionOptions,
): ThreadRunProjectionSnapshot {
  if (!current) {
    return incoming;
  }

  const currentHistoryRevision = projectionHistoryRevision(current);
  const incomingHistoryRevision = projectionHistoryRevision(incoming);
  if (incomingHistoryRevision < currentHistoryRevision) {
    return current;
  }
  if (incomingHistoryRevision > currentHistoryRevision) {
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
      return incoming.thread.generatedAt >= current.thread.generatedAt
        ? mergeTrimmedIncomingProjection(current, incoming)
        : current;
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
