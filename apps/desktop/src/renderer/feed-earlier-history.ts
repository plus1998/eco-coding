import type { ThreadRunProjectionTimelineItem } from "../shared/ipc";

export const ACTIVITY_FEED_LOAD_EARLIER_THRESHOLD_PX = 80;
export const ACTIVITY_FEED_EARLIER_PAGE_LIMIT = 100;

export type FeedEarlierHistoryState = {
  threadId: string;
  historyRevision: number;
  timeline: ThreadRunProjectionTimelineItem[];
  hasEarlier: boolean;
  beforeSequence?: number;
};

export function createFeedEarlierHistoryState(
  threadId: string,
  options: {
    historyRevision?: number;
    hasEarlier?: boolean;
    timeline?: readonly ThreadRunProjectionTimelineItem[];
  } = {},
): FeedEarlierHistoryState {
  const timeline = options.timeline ? [...options.timeline] : [];
  return {
    threadId,
    historyRevision: options.historyRevision ?? 0,
    timeline,
    hasEarlier: options.hasEarlier === true,
    ...(timeline[0]?.sequence !== undefined ? { beforeSequence: timeline[0].sequence } : {}),
  };
}

export function mergeFeedTimelineById(
  current: readonly ThreadRunProjectionTimelineItem[],
  incoming: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()].sort(
    (left, right) => left.sequence - right.sequence || left.at.localeCompare(right.at),
  );
}

export function shouldLoadFeedEarlier(options: {
  scrollTop: number;
  hasEarlier: boolean;
  loadingEarlier: boolean;
  programmaticScroll: boolean;
  thresholdPx?: number;
}): boolean {
  if (options.programmaticScroll || options.loadingEarlier || !options.hasEarlier) {
    return false;
  }
  const threshold = options.thresholdPx ?? ACTIVITY_FEED_LOAD_EARLIER_THRESHOLD_PX;
  return options.scrollTop <= threshold;
}

export function resolveFeedEarlierBeforeSequence(
  earlier: FeedEarlierHistoryState | undefined,
  liveTimeline: readonly ThreadRunProjectionTimelineItem[],
): number | undefined {
  if (earlier?.beforeSequence !== undefined) {
    return earlier.beforeSequence;
  }
  return liveTimeline[0]?.sequence;
}
