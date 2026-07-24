import { expect, test } from "bun:test";
import {
  createFeedEarlierHistoryState,
  mergeFeedTimelineById,
  resolveFeedEarlierBeforeSequence,
  shouldLoadFeedEarlier,
} from "../src/renderer/feed-earlier-history";
import type { ThreadRunProjectionTimelineItem } from "../src/shared/ipc";

function item(id: string, sequence: number): ThreadRunProjectionTimelineItem {
  return {
    id,
    sequence,
    eventType: "message.final",
    scope: "main",
    text: id,
    at: `2026-01-01T00:00:${String(sequence).padStart(2, "0")}.000Z`,
  };
}

test("mergeFeedTimelineById prepends earlier items and dedupes by id", () => {
  const merged = mergeFeedTimelineById(
    [item("a", 1), item("b", 2)],
    [item("b", 2), item("c", 3)],
  );
  expect(merged.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
});

test("shouldLoadFeedEarlier only fires near the top while earlier history remains", () => {
  expect(
    shouldLoadFeedEarlier({
      scrollTop: 40,
      hasEarlier: true,
      loadingEarlier: false,
      programmaticScroll: false,
      thresholdPx: 80,
    }),
  ).toBe(true);
  expect(
    shouldLoadFeedEarlier({
      scrollTop: 120,
      hasEarlier: true,
      loadingEarlier: false,
      programmaticScroll: false,
      thresholdPx: 80,
    }),
  ).toBe(false);
  expect(
    shouldLoadFeedEarlier({
      scrollTop: 0,
      hasEarlier: true,
      loadingEarlier: true,
      programmaticScroll: false,
    }),
  ).toBe(false);
  expect(
    shouldLoadFeedEarlier({
      scrollTop: 0,
      hasEarlier: false,
      loadingEarlier: false,
      programmaticScroll: false,
    }),
  ).toBe(false);
});

test("resolveFeedEarlierBeforeSequence prefers earlier cursor then live window start", () => {
  const earlier = createFeedEarlierHistoryState("thr_1", {
    hasEarlier: true,
    timeline: [item("old", 4), item("mid", 5)],
  });
  expect(resolveFeedEarlierBeforeSequence(earlier, [item("live", 10)])).toBe(4);
  expect(resolveFeedEarlierBeforeSequence(undefined, [item("live", 10)])).toBe(10);
  expect(resolveFeedEarlierBeforeSequence(undefined, [])).toBeUndefined();
});
