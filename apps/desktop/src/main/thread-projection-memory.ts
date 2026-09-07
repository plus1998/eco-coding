import type { ThreadStatus, ThreadProjectionFocusReport } from "../shared/ipc";
import {
  collectProtectedProjectionThreadIds,
  isProjectionCacheHotThreadStatus,
  listEvictableProjectionThreadIds,
  PROJECTION_CACHE_EVICT_DELAY_MS,
  rememberRecentlyViewedThread,
} from "../shared/thread-projection-cache-policy";

export type { ThreadProjectionFocusReport };

export interface ThreadProjectionMemoryCoordinatorOptions {
  getHotThreadIds: () => readonly string[];
  listRetainedThreadIds: () => readonly string[];
  releaseThread: (threadId: string) => void;
  evictDelayMs?: number;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Main-process soft eviction for projection working memory.
 * Keeps selected/feed + hot (running|queued|awaiting_plan) + LRU peers warm;
 * releases the rest after a delay. Does not delete SQLite feed skeletons.
 */
export class ThreadProjectionMemoryCoordinator {
  private selectedThreadId: string | undefined;
  private feedThreadId: string | undefined;
  private recentlyViewedThreadIds: string[] = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly touchedThreadIds = new Set<string>();
  private readonly evictDelayMs: number;
  private readonly setTimer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;

  constructor(private readonly options: ThreadProjectionMemoryCoordinatorOptions) {
    this.evictDelayMs = options.evictDelayMs ?? PROJECTION_CACHE_EVICT_DELAY_MS;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  reportFocus(report: ThreadProjectionFocusReport): void {
    this.selectedThreadId = report.selectedThreadId?.trim() || undefined;
    this.feedThreadId = report.feedThreadId?.trim() || undefined;
    if (Array.isArray(report.recentlyViewedThreadIds)) {
      this.recentlyViewedThreadIds = report.recentlyViewedThreadIds
        .map((id) => id.trim())
        .filter(Boolean);
    } else if (this.selectedThreadId) {
      this.recentlyViewedThreadIds = rememberRecentlyViewedThread(
        this.recentlyViewedThreadIds,
        this.selectedThreadId,
      );
    }
    if (this.selectedThreadId) {
      this.touchedThreadIds.add(this.selectedThreadId);
    }
    if (this.feedThreadId) {
      this.touchedThreadIds.add(this.feedThreadId);
    }
    this.reconcile();
  }

  noteThreadTouched(threadId: string): void {
    const id = threadId.trim();
    if (!id) {
      return;
    }
    this.touchedThreadIds.add(id);
    this.reconcile();
  }

  forgetThread(threadId: string): void {
    const id = threadId.trim();
    if (!id) {
      return;
    }
    this.cancelTimer(id);
    this.touchedThreadIds.delete(id);
    if (this.selectedThreadId === id) {
      this.selectedThreadId = undefined;
    }
    if (this.feedThreadId === id) {
      this.feedThreadId = undefined;
    }
    this.recentlyViewedThreadIds = this.recentlyViewedThreadIds.filter((item) => item !== id);
  }

  reconcile(): void {
    const protectedIds = this.collectProtectedIds();
    for (const threadId of [...this.timers.keys()]) {
      if (protectedIds.has(threadId)) {
        this.cancelTimer(threadId);
      }
    }

    const retained = new Set<string>([
      ...this.touchedThreadIds,
      ...this.options.listRetainedThreadIds(),
    ]);
    for (const threadId of listEvictableProjectionThreadIds([...retained], protectedIds)) {
      if (this.timers.has(threadId)) {
        continue;
      }
      const timer = this.setTimer(() => {
        this.timers.delete(threadId);
        const protectedNow = this.collectProtectedIds();
        if (protectedNow.has(threadId)) {
          return;
        }
        this.touchedThreadIds.delete(threadId);
        this.options.releaseThread(threadId);
      }, this.evictDelayMs);
      this.timers.set(threadId, timer);
    }
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      this.clearTimer(timer);
    }
    this.timers.clear();
  }

  /** Test helper */
  getDebugState(): {
    selectedThreadId?: string;
    feedThreadId?: string;
    recentlyViewedThreadIds: readonly string[];
    pendingEvictions: readonly string[];
  } {
    return {
      ...(this.selectedThreadId ? { selectedThreadId: this.selectedThreadId } : {}),
      ...(this.feedThreadId ? { feedThreadId: this.feedThreadId } : {}),
      recentlyViewedThreadIds: [...this.recentlyViewedThreadIds],
      pendingEvictions: [...this.timers.keys()],
    };
  }

  private collectProtectedIds(): Set<string> {
    const hotThreadIds = this.options
      .getHotThreadIds()
      .filter((id) => id.trim().length > 0);
    return collectProtectedProjectionThreadIds({
      selectedThreadId: this.selectedThreadId,
      feedThreadId: this.feedThreadId,
      recentlyViewedThreadIds: this.recentlyViewedThreadIds,
      hotThreadIds,
    });
  }

  private cancelTimer(threadId: string): void {
    const timer = this.timers.get(threadId);
    if (timer === undefined) {
      return;
    }
    this.clearTimer(timer);
    this.timers.delete(threadId);
  }
}

export function listHotThreadIdsFromStatuses(
  threads: ReadonlyArray<{ id: string; status: ThreadStatus }>,
): string[] {
  return threads
    .filter((thread) => isProjectionCacheHotThreadStatus(thread.status))
    .map((thread) => thread.id);
}
