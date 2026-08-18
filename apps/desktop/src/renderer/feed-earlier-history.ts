import type { ThreadRunProjectionTimelineItem } from "../shared/ipc";

/** Keep this above the feed top mask so pull-to-load still fires. */
export const ACTIVITY_FEED_LOAD_EARLIER_THRESHOLD_PX = 160;
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

export function isActivityFeedUndersized(options: {
  scrollHeight: number;
  clientHeight: number;
  thresholdPx?: number;
}): boolean {
  if (options.clientHeight < 32) {
    return false;
  }
  const threshold = options.thresholdPx ?? ACTIVITY_FEED_LOAD_EARLIER_THRESHOLD_PX;
  return options.scrollHeight <= options.clientHeight + threshold;
}

export function shouldLoadFeedEarlier(options: {
  scrollTop: number;
  hasEarlier: boolean;
  loadingEarlier: boolean;
  programmaticScroll: boolean;
  thresholdPx?: number;
  scrollHeight?: number;
  clientHeight?: number;
}): boolean {
  if (options.loadingEarlier || !options.hasEarlier) {
    return false;
  }
  const threshold = options.thresholdPx ?? ACTIVITY_FEED_LOAD_EARLIER_THRESHOLD_PX;
  const undersized =
    options.scrollHeight !== undefined &&
    options.clientHeight !== undefined &&
    isActivityFeedUndersized({
      scrollHeight: options.scrollHeight,
      clientHeight: options.clientHeight,
      thresholdPx: threshold,
    });
  // Collapsed turns / a taller feed after closing the workspace can leave no
  // overflow. Pulling at scrollTop=0 then never fires a scroll event, so fill
  // even while a programmatic stick-to-bottom is in progress.
  if (undersized) {
    return true;
  }
  if (options.programmaticScroll) {
    return false;
  }
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
