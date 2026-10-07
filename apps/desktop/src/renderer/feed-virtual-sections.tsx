import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { ThreadRunTurnFeedSection } from "./conversation-v2-turn-feed";
import { isProjectionUserPromptItem } from "./conversation-v2-projection-view";

/** Below this count, mount everything — virtualization overhead is not worth it. */
export const FEED_VIRTUALIZE_MIN_SECTIONS = 12;

export const FEED_SCROLL_TO_ANCHOR_EVENT = "eco:feed-scroll-to-anchor";

export type FeedScrollToAnchorDetail = {
  anchorId: string;
};

const ESTIMATE_TURN_PX = 220;
const ESTIMATE_ENTRY_PX = 140;
const OVERSCAN = 6;

const ESTIMATE_TOOL_ENTRY_PX = 36;

/**
 * A turn row in a real feed measures 700–1800px, while the static estimate
 * caps at 508. Under-estimating is what makes the model's total size churn by
 * ~200px per row as the reader scrolls into unmeasured history, and every
 * churn is a chance for the viewport to lurch. Each shape bucket therefore
 * learns its own average from what it has already measured.
 */
const LEARNED_ESTIMATE_BUCKETS = 48;
const LEARNED_ESTIMATE_ALPHA = 0.4;
const LEARNED_ESTIMATE_MIN_PX = 40;
const LEARNED_ESTIMATE_MAX_PX = 4_000;
const learnedSectionSizes = new Map<string, number>();

function sectionEstimateKey(section: ThreadRunTurnFeedSection): string {
  if (section.kind !== "turn") {
    return "entry";
  }
  return `turn:${Math.min(section.processEntries.length, 16)}`;
}

function staticEstimateSectionSize(section: ThreadRunTurnFeedSection): number {
  if (section.kind === "turn") {
    return ESTIMATE_TURN_PX + Math.min(section.processEntries.length, 8) * ESTIMATE_TOOL_ENTRY_PX;
  }
  return ESTIMATE_ENTRY_PX;
}

export function estimateSectionSize(section: ThreadRunTurnFeedSection): number {
  return learnedSectionSizes.get(sectionEstimateKey(section)) ?? staticEstimateSectionSize(section);
}

/** Fold one measured row height into its shape bucket's average. */
export function recordMeasuredSectionSize(section: ThreadRunTurnFeedSection, size: number): void {
  if (!(size > 0) || !Number.isFinite(size)) {
    return;
  }
  const clamped = Math.min(LEARNED_ESTIMATE_MAX_PX, Math.max(LEARNED_ESTIMATE_MIN_PX, size));
  const key = sectionEstimateKey(section);
  const previous = learnedSectionSizes.get(key);
  const next =
    previous === undefined
      ? Math.round(clamped)
      : Math.round(previous * (1 - LEARNED_ESTIMATE_ALPHA) + clamped * LEARNED_ESTIMATE_ALPHA);
  learnedSectionSizes.delete(key);
  learnedSectionSizes.set(key, next);
  while (learnedSectionSizes.size > LEARNED_ESTIMATE_BUCKETS) {
    const oldest = learnedSectionSizes.keys().next();
    if (oldest.done) {
      break;
    }
    learnedSectionSizes.delete(oldest.value);
  }
}

/**
 * Decide whether a measured size change may move the viewport.
 *
 * virtual-core compensates the first measurement of any row whose top sits
 * above the fold, including rows that span it. These rows are flow laid out, so
 * a tall turn row that mounts while the reader scrolls upward grows *into* the
 * viewport, and compensating it drags the viewport down by the whole delta.
 * Only compensate when the change is confined to the region above the fold —
 * in either the old or the new geometry.
 */
export function shouldFeedAdjustScrollOnResize(
  item: { start: number; size: number },
  delta: number,
  scrollOffsetWithAdjustments: number,
): boolean {
  const oldBottom = item.start + item.size;
  const newBottom = oldBottom + delta;
  return Math.max(oldBottom, newBottom) <= scrollOffsetWithAdjustments;
}

function sectionContainsUserAnchor(section: ThreadRunTurnFeedSection, anchorId: string): boolean {
  if (section.kind === "entry") {
    if (section.entry.kind === "timeline" && section.entry.item.id === anchorId) {
      return true;
    }
    return section.entry.key === anchorId || section.key === `standalone:${anchorId}`;
  }
  if (section.finalEntry?.kind === "timeline" && section.finalEntry.item.id === anchorId) {
    return true;
  }
  return section.processEntries.some((entry) => {
    if (entry.kind === "timeline" && entry.item.id === anchorId) {
      return true;
    }
    return entry.key === anchorId;
  });
}

export function isThreadPromptAnchorId(anchorId: string): boolean {
  return anchorId.startsWith("thread:");
}

export function findFeedSectionIndexForAnchor(
  sections: readonly ThreadRunTurnFeedSection[],
  anchorId: string,
): number {
  const trimmed = anchorId.trim();
  if (!trimmed || isThreadPromptAnchorId(trimmed)) {
    return -1;
  }
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (!section) {
      continue;
    }
    if (sectionContainsUserAnchor(section, trimmed)) {
      return index;
    }
    // User prompts are standalone timeline entries — also match by prompt item helper.
    if (
      section.kind === "entry" &&
      section.entry.kind === "timeline" &&
      isProjectionUserPromptItem(section.entry.item) &&
      section.entry.item.id === trimmed
    ) {
      return index;
    }
  }
  return -1;
}

export function listUserMessageAnchorsFromSections(
  sections: readonly ThreadRunTurnFeedSection[],
): Array<{ anchorId: string; sectionIndex: number }> {
  const anchors: Array<{ anchorId: string; sectionIndex: number }> = [];
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    if (!section || section.kind !== "entry") {
      continue;
    }
    if (section.entry.kind !== "timeline" || !isProjectionUserPromptItem(section.entry.item)) {
      continue;
    }
    const anchorId = section.entry.item.id.trim();
    if (!anchorId) {
      continue;
    }
    anchors.push({ anchorId, sectionIndex });
  }
  return anchors;
}

/**
 * Zero-size stand-ins so messages-nav active/jump keep working when the real
 * user-prompt row is virtualized out of the DOM.
 */
export function FeedVirtualUserMessageSentinels(props: {
  anchors: readonly { anchorId: string; sectionIndex: number }[];
  mountedSectionIndexes: ReadonlySet<number>;
  /** Virtual item.start values include scrollMargin (= header offset inside run-log). */
  resolveSectionTopPx: (sectionIndex: number) => number;
}): ReactNode {
  const { anchors, mountedSectionIndexes, resolveSectionTopPx } = props;
  if (anchors.length === 0) {
    return null;
  }
  return (
    <>
      {anchors.map((anchor) => {
        if (mountedSectionIndexes.has(anchor.sectionIndex)) {
          return null;
        }
        return (
          <div
            key={`virtual-anchor:${anchor.anchorId}`}
            className="run-log-virtual-anchor"
            data-user-message-anchor-id={anchor.anchorId}
            data-virtual-anchor="true"
            aria-hidden
            style={{ top: resolveSectionTopPx(anchor.sectionIndex) }}
          />
        );
      })}
    </>
  );
}

export function useFeedSectionVirtualizer(input: {
  sections: readonly ThreadRunTurnFeedSection[];
  enabled: boolean;
  runLogRef: RefObject<HTMLElement | null>;
  /** Element above the virtualized rows (e.g. thread prompt) inside the same scroll parent. */
  headerRef: RefObject<HTMLElement | null>;
}) {
  const { sections, enabled, runLogRef, headerRef } = input;
  const count = sections.length;
  const [scrollMargin, setScrollMargin] = useState(0);

  const getScrollElement = useCallback(() => {
    const runLog = runLogRef.current;
    if (!runLog) {
      return null;
    }
    return runLog.closest(".activity-messages") as HTMLElement | null;
  }, [runLogRef]);

  const getItemKey = useCallback((index: number) => sections[index]?.key ?? index, [sections]);
  const estimateSize = useCallback((index: number) => {
    const section = sections[index];
    return section ? estimateSectionSize(section) : ESTIMATE_ENTRY_PX;
  }, [sections]);

  const virtualizer = useVirtualizer({
    count: enabled ? count : 0,
    enabled,
    getScrollElement,
    estimateSize,
    overscan: OVERSCAN,
    getItemKey,
    scrollMargin,
    // Mount measurements can correct the scroll offset during React's commit.
    // Let React batch those notifications rather than flush the whole Feed here.
    useFlushSync: false,
  });

  // virtual-core reads this off the instance, not from the options object.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) =>
    shouldFeedAdjustScrollOnResize(
      item,
      delta,
      // getScrollOffset() is private in the typings; these two fields are what
      // it resolves to (initialOffset stays 0 here).
      (instance.scrollOffset ?? 0) + instance.scrollAdjustments,
    );

  const measureElement = useCallback((node: Element | null) => {
    virtualizer.measureElement(node);
    if (!node) return;
    const index = virtualizer.indexFromElement(node);
    if (index < 0 || index >= virtualizer.options.count) return;
    const height = (node as HTMLElement).offsetHeight;
    const section = sections[index];
    if (section) {
      recordMeasuredSectionSize(section, height);
    }
    const key = virtualizer.options.getItemKey(index);
    if (virtualizer.itemSizeCache.has(key)) return;
    // The library skips mount measurements while scrolling. In our flow layout,
    // an unmeasured long row changes scrollHeight before the bottom-follow RO runs.
    // It can then be removed before its own RO ever fires, oscillating forever
    // between its estimate and DOM height. Cache its first size in this commit.
    virtualizer.resizeItem(index, height);
  }, [sections, virtualizer]);

  useLayoutEffect(() => {
    if (!enabled) {
      setScrollMargin(0);
      return;
    }
    const header = headerRef.current;
    const next = header?.offsetHeight ?? 0;
    setScrollMargin((current) => (Math.abs(next - current) > 0.5 ? next : current));
  }, [enabled, headerRef, sections.length]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const header = headerRef.current;
    if (!header) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const next = header.offsetHeight;
      setScrollMargin((current) => (Math.abs(next - current) > 0.5 ? next : current));
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, [enabled, headerRef]);

  const scrollToAnchor = useCallback(
    async (anchorId: string) => {
      if (isThreadPromptAnchorId(anchorId)) {
        const scroll = getScrollElement();
        scroll?.scrollTo({ top: 0, behavior: "smooth" });
        return true;
      }
      const index = findFeedSectionIndexForAnchor(sections, anchorId);
      if (index < 0) {
        return false;
      }
      virtualizer.scrollToIndex(index, { align: "start" });
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      return true;
    },
    [getScrollElement, sections, virtualizer],
  );

  useEffect(() => {
    const runLog = runLogRef.current;
    if (!runLog || !enabled) {
      return;
    }
    const onScrollToAnchor = (event: Event) => {
      const detail = (event as CustomEvent<FeedScrollToAnchorDetail>).detail;
      const anchorId = detail?.anchorId?.trim();
      if (!anchorId) {
        return;
      }
      void scrollToAnchor(anchorId);
    };
    runLog.addEventListener(FEED_SCROLL_TO_ANCHOR_EVENT, onScrollToAnchor as EventListener);
    return () => {
      runLog.removeEventListener(FEED_SCROLL_TO_ANCHOR_EVENT, onScrollToAnchor as EventListener);
    };
  }, [enabled, runLogRef, scrollToAnchor]);

  return {
    enabled,
    virtualizer,
    virtualItems: enabled ? virtualizer.getVirtualItems() : ([] as VirtualItem[]),
    totalSize: enabled ? virtualizer.getTotalSize() : 0,
    scrollMargin: enabled ? scrollMargin : 0,
    measureElement,
    resolveSectionTopPx: (sectionIndex: number) => {
      if (!enabled || sectionIndex < 0) {
        return 0;
      }
      const measured = virtualizer.measurementsCache[sectionIndex];
      if (measured) {
        return measured.start;
      }
      let start = scrollMargin;
      for (let index = 0; index < sectionIndex; index += 1) {
        const previous = virtualizer.measurementsCache[index];
        const section = sections[index];
        start += previous?.size ?? (section ? estimateSectionSize(section) : ESTIMATE_ENTRY_PX);
      }
      return start;
    },
  };
}

export function FeedVirtualSectionWindow(props: {
  sections: readonly ThreadRunTurnFeedSection[];
  totalSize: number;
  scrollMargin: number;
  virtualItems: readonly VirtualItem[];
  measureElement: (node: Element | null) => void;
  renderSection: (index: number) => ReactNode;
}): ReactNode {
  const { sections, totalSize, scrollMargin, virtualItems, measureElement, renderSection } = props;
  const first = virtualItems[0];
  const last = virtualItems[virtualItems.length - 1];
  // item.start/end include scrollMargin; totalSize does not. Header already occupies that margin in DOM.
  const topSpacer = Math.max(0, (first?.start ?? 0) - scrollMargin);
  const bottomSpacer = Math.max(0, totalSize - ((last?.end ?? scrollMargin) - scrollMargin));

  return (
    <>
      {topSpacer > 0 ? <div className="run-log-virtual-spacer" style={{ height: topSpacer }} aria-hidden /> : null}
      {virtualItems.map((item) => (
        <div
          key={item.key}
          data-index={item.index}
          data-previous-section-kind={sections[item.index - 1]?.kind}
          ref={measureElement}
          className="run-log-virtual-row"
        >
          {renderSection(item.index)}
        </div>
      ))}
      {bottomSpacer > 0 ? (
        <div className="run-log-virtual-spacer" style={{ height: bottomSpacer }} aria-hidden />
      ) : null}
    </>
  );
}

export function dispatchFeedScrollToAnchor(container: ParentNode, anchorId: string): boolean {
  const runLog = container.querySelector(".run-log");
  if (!(runLog instanceof HTMLElement)) {
    return false;
  }
  runLog.dispatchEvent(
    new CustomEvent<FeedScrollToAnchorDetail>(FEED_SCROLL_TO_ANCHOR_EVENT, {
      detail: { anchorId },
      bubbles: false,
    }),
  );
  return true;
}
