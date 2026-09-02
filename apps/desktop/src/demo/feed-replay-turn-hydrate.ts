import { buildThreadRunProjectionDetail } from "../main/thread-run-projection-detail";
import type {
  ThreadRunProjectionDetailResult,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../shared/thread-run-projection";

export interface DemoFeedReplayHydrateOptions {
  /** Codex rpc-log replay has no runAttemptId on events; merge full timeline process rows instead. */
  codex?: boolean;
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

/** Same merge rules as renderer `mergeThreadRunProjectionDetail` (demo-only, main-process safe). */
function mergeProjectionDetail(
  current: ThreadRunProjectionSnapshot,
  detail: ThreadRunProjectionDetailResult,
): ThreadRunProjectionSnapshot {
  const mainItems = detail.timeline.filter((item) => item.scope !== "agent" || !item.agentId?.trim());
  const agentItems = new Map<string, ThreadRunProjectionTimelineItem[]>();
  for (const item of detail.timeline) {
    const agentId = item.agentId?.trim();
    if (item.scope === "agent" && agentId) {
      agentItems.set(agentId, [...(agentItems.get(agentId) ?? []), item]);
    }
  }
  const mergeTimeline = (
    left: readonly ThreadRunProjectionTimelineItem[],
    right: readonly ThreadRunProjectionTimelineItem[],
  ) => {
    const byId = new Map(left.map((item) => [item.id, item]));
    for (const item of right) {
      byId.set(item.id, item);
    }
    return [...byId.values()].sort(compareTimelineItems);
  };
  const agents = current.agents.map((agent) => {
    const incoming = agentItems.get(agent.agentId);
    return incoming ? { ...agent, timeline: mergeTimeline(agent.timeline, incoming) } : agent;
  });
  for (const [agentId, incoming] of agentItems) {
    if (agents.some((agent) => agent.agentId === agentId)) {
      continue;
    }
    agents.push({
      agentId,
      role: detail.agent?.role ?? "coder",
      kind: "subagent",
      status: detail.agent?.status ?? "stopped",
      startedAt: detail.agent?.startedAt ?? "",
      durationMs: detail.agent?.durationMs ?? 0,
      timeline: incoming,
    });
  }
  return {
    ...current,
    timeline: mergeTimeline(current.timeline, mainItems),
    agents,
  };
}

/**
 * Pre-load completed turn process items (tools, thinking, subagent timeline) into the
 * feed skeleton projection so feed-replay demo matches live after manual turn expand.
 * Demo-only: never called from live main process.
 */
export function hydrateDemoFeedReplayTurnDetails(
  feedProjection: ThreadRunProjectionSnapshot,
  fullProjection: ThreadRunProjectionSnapshot,
  options?: DemoFeedReplayHydrateOptions,
): ThreadRunProjectionSnapshot {
  if (options?.codex) {
    return hydrateCodexDemoFeedReplayProcessItems(feedProjection, fullProjection);
  }
  let hydrated = feedProjection;
  for (const attempt of fullProjection.attempts) {
    if (attempt.status === "running") {
      continue;
    }
    const detail = buildThreadRunProjectionDetail(fullProjection, {
      threadId: fullProjection.thread.threadId,
      kind: "turn",
      key: attempt.attemptId,
      limit: 500,
    });
    if (!detail?.timeline.length) {
      continue;
    }
    hydrated = mergeProjectionDetail(hydrated, detail);
  }
  return hydrated;
}

/** Codex replay events lack runAttemptId; merge non-skeleton main + subagent timeline rows. */
function hydrateCodexDemoFeedReplayProcessItems(
  feedProjection: ThreadRunProjectionSnapshot,
  fullProjection: ThreadRunProjectionSnapshot,
): ThreadRunProjectionSnapshot {
  const skeletonIds = new Set(feedProjection.timeline.map((item) => item.id));
  const extra = fullProjection.timeline.filter((item) => !skeletonIds.has(item.id));
  let hydrated = feedProjection;
  if (extra.length > 0) {
    hydrated = mergeProjectionDetail(hydrated, {
      threadId: fullProjection.thread.threadId,
      kind: "main",
      key: fullProjection.thread.threadId,
      generatedAt: fullProjection.thread.generatedAt,
      timeline: extra,
      sourceEventCount: fullProjection.sourceEventCount,
      hasMore: false,
      hasEarlier: false,
    });
  }
  for (const agent of fullProjection.agents) {
    if (!agent.timeline.length) {
      continue;
    }
    hydrated = mergeProjectionDetail(hydrated, {
      threadId: fullProjection.thread.threadId,
      kind: "agent",
      key: agent.agentId,
      generatedAt: fullProjection.thread.generatedAt,
      timeline: agent.timeline,
      sourceEventCount: fullProjection.sourceEventCount,
      hasMore: false,
      hasEarlier: false,
      agent: { ...agent, timeline: [] },
    });
  }
  return hydrated;
}
