import { useCallback, useSyncExternalStore } from "react";
import type {
  ThreadLocalStreamUpdate,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../shared/ipc";

const updatesByThread = new Map<string, Map<string, ThreadLocalStreamUpdate>>();
const listenersByThread = new Map<string, Set<() => void>>();
const versionsByThread = new Map<string, number>();

export function publishLocalStreamUpdate(update: ThreadLocalStreamUpdate): void {
  const updates = updatesByThread.get(update.threadId) ?? new Map<string, ThreadLocalStreamUpdate>();
  if (update.streaming) {
    updates.set(update.streamKey, update);
    updatesByThread.set(update.threadId, updates);
  } else {
    updates.delete(update.streamKey);
    if (updates.size === 0) {
      updatesByThread.delete(update.threadId);
    }
  }
  versionsByThread.set(update.threadId, (versionsByThread.get(update.threadId) ?? 0) + 1);
  for (const listener of listenersByThread.get(update.threadId) ?? []) {
    listener();
  }
}

export function clearLocalStreamUpdates(threadId: string): void {
  if (!updatesByThread.has(threadId)) {
    return;
  }
  updatesByThread.delete(threadId);
  versionsByThread.set(threadId, (versionsByThread.get(threadId) ?? 0) + 1);
  for (const listener of listenersByThread.get(threadId) ?? []) {
    listener();
  }
}

export function useLocalStreamProjection(
  projection: ThreadRunProjectionSnapshot | undefined,
): ThreadRunProjectionSnapshot | undefined {
  const threadId = projection?.thread.threadId;
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!threadId) {
        return () => undefined;
      }
      const listeners = listenersByThread.get(threadId) ?? new Set<() => void>();
      listeners.add(listener);
      listenersByThread.set(threadId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          listenersByThread.delete(threadId);
        }
      };
    },
    [threadId],
  );
  const getSnapshot = useCallback(() => (threadId ? (versionsByThread.get(threadId) ?? 0) : 0), [threadId]);
  useSyncExternalStore(subscribe, getSnapshot, () => 0);
  if (!projection || !threadId) {
    return projection;
  }
  return applyLocalStreamUpdatesToProjection(projection, [
    ...(updatesByThread.get(threadId)?.values() ?? []),
  ]);
}

export function applyLocalStreamUpdatesToProjection(
  projection: ThreadRunProjectionSnapshot,
  updates: readonly ThreadLocalStreamUpdate[],
): ThreadRunProjectionSnapshot {
  let timeline = projection.timeline;
  let agents = projection.agents;
  let changed = false;

  for (const update of updates) {
    if (update.agentId) {
      const index = agents.findIndex((agent) => agent.agentId === update.agentId);
      if (index < 0) {
        continue;
      }
      const agent = agents[index];
      if (!agent) {
        continue;
      }
      const nextTimeline = overlayTimeline(agent.timeline, update, "agent");
      if (nextTimeline !== agent.timeline) {
        agents = [...agents];
        agents[index] = { ...agent, timeline: nextTimeline };
        changed = true;
      }
      continue;
    }
    const nextTimeline = overlayTimeline(timeline, update, "main");
    if (nextTimeline !== timeline) {
      timeline = nextTimeline;
      changed = true;
    }
  }

  return changed ? { ...projection, timeline, agents } : projection;
}

function overlayTimeline(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  update: ThreadLocalStreamUpdate,
  scope: "main" | "agent",
): ThreadRunProjectionTimelineItem[] {
  let matchIndex = -1;
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    if (timeline[index]?.streamKey === update.streamKey) {
      matchIndex = index;
      break;
    }
  }
  const eventType = update.channel === "thinking" ? "thinking.delta" : "message.delta";
  if (matchIndex >= 0) {
    const current = timeline[matchIndex];
    if (!current || (current.text === update.text && current.eventType === eventType)) {
      return timeline as ThreadRunProjectionTimelineItem[];
    }
    const next = [...timeline];
    next[matchIndex] = { ...current, text: update.text, eventType };
    return next;
  }

  const maxSequence = timeline.reduce((max, item) => Math.max(max, item.sequence), 0);
  return [
    ...timeline,
    {
      id: `local-stream:${update.streamKey}`,
      sequence: maxSequence + 0.5,
      eventType,
      scope,
      text: update.text,
      at: update.observedAt,
      role: update.role,
      streamKey: update.streamKey,
      ...(update.agentId && { agentId: update.agentId }),
      metadata: { localOnly: true },
    },
  ];
}
