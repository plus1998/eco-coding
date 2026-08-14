import { useCallback, useMemo, useSyncExternalStore } from "react";
import type {
  ThreadLocalStreamUpdate,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../shared/ipc";

const updatesByThread = new Map<string, Map<string, ThreadLocalStreamUpdate>>();
const listenersByThread = new Map<string, Set<() => void>>();
const versionsByThread = new Map<string, number>();
const pendingNotificationsByThread = new Map<string, ReturnType<typeof setTimeout>>();

export const LOCAL_STREAM_NOTIFY_INTERVAL_MS = 32;

export function subscribeToLocalStreamUpdates(threadId: string, listener: () => void): () => void {
  const listeners = listenersByThread.get(threadId) ?? new Set<() => void>();
  listeners.add(listener);
  listenersByThread.set(threadId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersByThread.delete(threadId);
    }
  };
}

function notifyThread(threadId: string): void {
  versionsByThread.set(threadId, (versionsByThread.get(threadId) ?? 0) + 1);
  for (const listener of listenersByThread.get(threadId) ?? []) {
    listener();
  }
}

function cancelPendingNotification(threadId: string): void {
  const pending = pendingNotificationsByThread.get(threadId);
  if (pending === undefined) {
    return;
  }
  clearTimeout(pending);
  pendingNotificationsByThread.delete(threadId);
}

function scheduleThreadNotification(threadId: string): void {
  if (pendingNotificationsByThread.has(threadId)) {
    return;
  }
  const timer = setTimeout(() => {
    pendingNotificationsByThread.delete(threadId);
    notifyThread(threadId);
  }, LOCAL_STREAM_NOTIFY_INTERVAL_MS);
  pendingNotificationsByThread.set(threadId, timer);
}

export function publishLocalStreamUpdate(update: ThreadLocalStreamUpdate): void {
  const updates = updatesByThread.get(update.threadId) ?? new Map<string, ThreadLocalStreamUpdate>();
  if (update.streaming) {
    const current = updates.get(update.streamKey);
    if (
      current?.text === update.text &&
      current.role === update.role &&
      current.channel === update.channel &&
      current.agentId === update.agentId &&
      current.reasoningDisplay === update.reasoningDisplay
    ) {
      return;
    }
    updates.set(update.streamKey, update);
    updatesByThread.set(update.threadId, updates);
    scheduleThreadNotification(update.threadId);
  } else {
    const changed = updates.delete(update.streamKey);
    if (updates.size === 0) {
      updatesByThread.delete(update.threadId);
    }
    if (!changed) {
      return;
    }
    cancelPendingNotification(update.threadId);
    notifyThread(update.threadId);
  }
}

export function listLocalStreamUpdates(threadId: string): ThreadLocalStreamUpdate[] {
  return [...(updatesByThread.get(threadId)?.values() ?? [])];
}

/** Remove updates without notifying subscribers — bake into projection before next render. */
export function takeLocalStreamUpdates(threadId: string): ThreadLocalStreamUpdate[] {
  const updates = listLocalStreamUpdates(threadId);
  const hadPendingNotification = pendingNotificationsByThread.has(threadId);
  updatesByThread.delete(threadId);
  cancelPendingNotification(threadId);
  if (updates.length > 0 || hadPendingNotification) {
    versionsByThread.delete(threadId);
  }
  return updates;
}

export function clearLocalStreamUpdates(threadId: string): void {
  const hadUpdates = updatesByThread.delete(threadId);
  const hadPendingNotification = pendingNotificationsByThread.has(threadId);
  cancelPendingNotification(threadId);
  if (!hadUpdates && !hadPendingNotification && !versionsByThread.has(threadId)) {
    return;
  }
  versionsByThread.delete(threadId);
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
      return subscribeToLocalStreamUpdates(threadId, listener);
    },
    [threadId],
  );
  const getSnapshot = useCallback(() => (threadId ? (versionsByThread.get(threadId) ?? 0) : 0), [threadId]);
  const localVersion = useSyncExternalStore(subscribe, getSnapshot, () => 0);
  return useMemo(() => {
    void localVersion;
    if (!projection || !threadId) {
      return projection;
    }
    return applyLocalStreamUpdatesToProjection(projection, [
      ...(updatesByThread.get(threadId)?.values() ?? []),
    ]);
  }, [localVersion, projection, threadId]);
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
  const reasoningDisplay = readOverlayReasoningDisplay(update);
  if (matchIndex >= 0) {
    const current = timeline[matchIndex];
    if (!current) {
      return timeline as ThreadRunProjectionTimelineItem[];
    }
    const nextMetadata = overlayThinkingMetadata(current.metadata, reasoningDisplay);
    if (
      current.text === update.text &&
      current.eventType === eventType &&
      current.metadata?.reasoningDisplay === nextMetadata.reasoningDisplay
    ) {
      return timeline as ThreadRunProjectionTimelineItem[];
    }
    const next = [...timeline];
    next[matchIndex] = { ...current, text: update.text, eventType, metadata: nextMetadata };
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
      metadata: overlayThinkingMetadata({ localOnly: true }, reasoningDisplay),
    },
  ];
}

function readOverlayReasoningDisplay(
  update: ThreadLocalStreamUpdate,
): "summary" | "raw" | undefined {
  return update.reasoningDisplay === "summary" || update.reasoningDisplay === "raw"
    ? update.reasoningDisplay
    : undefined;
}

function overlayThinkingMetadata(
  current: Record<string, unknown> | undefined,
  reasoningDisplay: "summary" | "raw" | undefined,
): Record<string, unknown> {
  return {
    ...(current ?? {}),
    ...(reasoningDisplay && { reasoningDisplay }),
  };
}
