import type { ThreadStatus } from "./ipc";

/** Keep this many previously viewed threads (excluding selected/feed) warm. */
export const PROJECTION_CACHE_LRU_SIZE = 2;

/** Delay before dropping an unprotected idle projection (avoids thrash on quick switches). */
export const PROJECTION_CACHE_EVICT_DELAY_MS = 45_000;

/** Visit history length: current + LRU peers. */
export const PROJECTION_CACHE_VISIT_HISTORY_SIZE = PROJECTION_CACHE_LRU_SIZE + 1;

export function isProjectionCacheHotThreadStatus(status?: ThreadStatus): boolean {
  return status === "running" || status === "queued" || status === "awaiting_plan";
}

export function rememberRecentlyViewedThread(
  current: readonly string[],
  threadId: string,
  maxEntries: number = PROJECTION_CACHE_VISIT_HISTORY_SIZE,
): string[] {
  const next = [threadId, ...current.filter((id) => id !== threadId)];
  return next.slice(0, Math.max(1, maxEntries));
}

export function collectProtectedProjectionThreadIds(input: {
  selectedThreadId?: string | undefined;
  feedThreadId?: string | undefined;
  recentlyViewedThreadIds: readonly string[];
  hotThreadIds: readonly string[];
  lruSize?: number | undefined;
}): Set<string> {
  const protectedIds = new Set<string>();
  if (input.selectedThreadId) {
    protectedIds.add(input.selectedThreadId);
  }
  if (input.feedThreadId) {
    protectedIds.add(input.feedThreadId);
  }
  for (const threadId of input.hotThreadIds) {
    if (threadId) {
      protectedIds.add(threadId);
    }
  }

  const lruSize = input.lruSize ?? PROJECTION_CACHE_LRU_SIZE;
  let added = 0;
  for (const threadId of input.recentlyViewedThreadIds) {
    if (!threadId) {
      continue;
    }
    if (threadId === input.selectedThreadId || threadId === input.feedThreadId) {
      continue;
    }
    // Hot / already protected ids do not consume LRU slots.
    if (protectedIds.has(threadId)) {
      continue;
    }
    protectedIds.add(threadId);
    added += 1;
    if (added >= lruSize) {
      break;
    }
  }

  return protectedIds;
}

export function listEvictableProjectionThreadIds(
  cachedThreadIds: readonly string[],
  protectedIds: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const evictable: string[] = [];
  for (const threadId of cachedThreadIds) {
    if (!threadId || seen.has(threadId) || protectedIds.has(threadId)) {
      continue;
    }
    seen.add(threadId);
    evictable.push(threadId);
  }
  return evictable;
}

export function removeRecordKeys<T>(record: Record<string, T>, keys: readonly string[]): Record<string, T> {
  if (keys.length === 0) {
    return record;
  }
  let changed = false;
  const next = { ...record };
  for (const key of keys) {
    if (key in next) {
      delete next[key];
      changed = true;
    }
  }
  return changed ? next : record;
}
