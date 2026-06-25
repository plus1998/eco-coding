import type { ThreadRunProjectionSnapshot } from "../shared/ipc";

export interface MergeThreadRunProjectionOptions {
  /** When true, reject trimmed feed updates that would drop older timeline items. */
  preserveHistory?: boolean;
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
    if (!preserveHistory || incoming.timeline.length >= current.timeline.length) {
      return incoming;
    }
    return current;
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
  return current;
}
