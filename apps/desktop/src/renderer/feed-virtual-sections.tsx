import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { ThreadRunTurnFeedSection } from "./thread-run-turn-feed";
import { isProjectionUserPromptItem } from "./thread-run-projection-view";

/** Below this count, mount everything — virtualization overhead is not worth it. */
export const FEED_VIRTUALIZE_MIN_SECTIONS = 12;

export const FEED_SCROLL_TO_ANCHOR_EVENT = "eco:feed-scroll-to-anchor";

export type FeedScrollToAnchorDetail = {
  anchorId: string;
};

const ESTIMATE_TURN_PX = 220;
const ESTIMATE_ENTRY_PX = 140;
const OVERSCAN = 6;

function estimateSectionSize(section: ThreadRunTurnFeedSection): number {
  if (section.kind === "turn") {
    const process = section.processEntries.length;
    return ESTIMATE_TURN_PX + Math.min(process, 8) * 36;
  }
  return ESTIMATE_ENTRY_PX;
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

  const virtualizer = useVirtualizer({
    count: enabled ? count : 0,
    getScrollElement,
    estimateSize: (index) => {
      const section = sections[index];
      return section ? estimateSectionSize(section) : ESTIMATE_ENTRY_PX;
    },
    overscan: OVERSCAN,
    getItemKey: (index) => sections[index]?.key ?? index,
    scrollMargin,
  });

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
    measureElement: virtualizer.measureElement,
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
  totalSize: number;
  scrollMargin: number;
  virtualItems: readonly VirtualItem[];
  measureElement: (node: Element | null) => void;
  renderSection: (index: number) => ReactNode;
}): ReactNode {
  const { totalSize, scrollMargin, virtualItems, measureElement, renderSection } = props;
  const first = virtualItems[0];
  const last = virtualItems[virtualItems.length - 1];
  // item.start/end include scrollMargin; totalSize does not. Header already occupies that margin in DOM.
  const topSpacer = Math.max(0, (first?.start ?? 0) - scrollMargin);
  const bottomSpacer = Math.max(0, totalSize - ((last?.end ?? scrollMargin) - scrollMargin));

  return (
    <>
      {topSpacer > 0 ? <div className="run-log-virtual-spacer" style={{ height: topSpacer }} aria-hidden /> : null}
      {virtualItems.map((item) => (
        <div key={item.key} data-index={item.index} ref={measureElement} className="run-log-virtual-row">
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
