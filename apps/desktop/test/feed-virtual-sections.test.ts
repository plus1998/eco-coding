import { describe, expect, test } from "bun:test";
import {
  estimateSectionSize,
  FEED_VIRTUALIZE_MIN_SECTIONS,
  findFeedSectionIndexForAnchor,
  isThreadPromptAnchorId,
  listUserMessageAnchorsFromSections,
  recordMeasuredSectionSize,
  shouldFeedAdjustScrollOnResize,
} from "../src/renderer/feed-virtual-sections";
import type { ThreadRunTurnFeedSection } from "../src/renderer/conversation-v2-turn-feed";

function timelineEntry(id: string, text = "hi"): ThreadRunTurnFeedSection {
  return {
    kind: "entry",
    key: `standalone:timeline:${id}`,
    entry: {
      kind: "timeline",
      key: `timeline:${id}`,
      at: "2026-01-01T00:00:00.000Z",
      sequence: 1,
      item: {
        id,
        at: "2026-01-01T00:00:00.000Z",
        sequence: 1,
        eventType: "thread.user_prompt",
        text,
        contentLoaded: true,
        metadata: { liveType: "thread.user_prompt" },
      },
    },
  };
}

describe("feed-virtual-sections", () => {
  test("virtualize threshold stays stable", () => {
    expect(FEED_VIRTUALIZE_MIN_SECTIONS).toBeGreaterThanOrEqual(8);
  });

  test("thread prompt anchors are recognized", () => {
    expect(isThreadPromptAnchorId("thread:abc")).toBe(true);
    expect(isThreadPromptAnchorId("evt_1")).toBe(false);
  });

  test("findFeedSectionIndexForAnchor matches user prompt item ids", () => {
    const sections: ThreadRunTurnFeedSection[] = [
      timelineEntry("u1"),
      timelineEntry("u2"),
      {
        kind: "turn",
        key: "turn:a",
        attempt: {
          attemptId: "a",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: "2026-01-01T00:00:01.000Z",
        },
        running: false,
        processEntries: [],
        finalEntry: {
          kind: "timeline",
          key: "timeline:final",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 3,
          item: {
            id: "final-1",
            at: "2026-01-01T00:00:01.000Z",
            sequence: 3,
            eventType: "message.assistant",
            text: "done",
            contentLoaded: true,
          },
        },
      },
    ];
    expect(findFeedSectionIndexForAnchor(sections, "u2")).toBe(1);
    expect(findFeedSectionIndexForAnchor(sections, "final-1")).toBe(2);
    expect(findFeedSectionIndexForAnchor(sections, "missing")).toBe(-1);
    expect(findFeedSectionIndexForAnchor(sections, "thread:x")).toBe(-1);
  });

  test("listUserMessageAnchorsFromSections only lists user prompts", () => {
    const sections: ThreadRunTurnFeedSection[] = [
      timelineEntry("u1"),
      {
        kind: "turn",
        key: "turn:a",
        attempt: {
          attemptId: "a",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: "2026-01-01T00:00:01.000Z",
        },
        running: false,
        processEntries: [],
      },
      timelineEntry("u2"),
    ];
    expect(listUserMessageAnchorsFromSections(sections)).toEqual([
      { anchorId: "u1", sectionIndex: 0 },
      { anchorId: "u2", sectionIndex: 2 },
    ]);
  });
});

function turnSection(processCount: number): ThreadRunTurnFeedSection {
  return {
    kind: "turn",
    key: `turn:shape-${processCount}`,
    attempt: {
      attemptId: `a${processCount}`,
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
    },
    running: false,
    processEntries: Array.from({ length: processCount }, (_, index) => ({
      kind: "timeline",
      key: `timeline:p${processCount}-${index}`,
      at: "2026-01-01T00:00:00.000Z",
      sequence: index + 1,
      item: {
        id: `p${processCount}-${index}`,
        at: "2026-01-01T00:00:00.000Z",
        sequence: index + 1,
        eventType: "agent.tool_call",
        text: "tool",
        contentLoaded: true,
        metadata: { liveType: "agent.tool_call" },
      },
    })),
  } as ThreadRunTurnFeedSection;
}

describe("row resize scroll compensation", () => {
  test("compensates only when the change stays above the fold", () => {
    // Grows, still entirely above the fold: everything that moved is off-screen.
    expect(shouldFeedAdjustScrollOnResize({ start: 100, size: 300 }, 200, 1_000)).toBe(true);
    // Grows across the fold: part of the change happened inside the viewport.
    expect(shouldFeedAdjustScrollOnResize({ start: 100, size: 300 }, 800, 1_000)).toBe(false);
    // Already spanned the fold before shrinking.
    expect(shouldFeedAdjustScrollOnResize({ start: 100, size: 1_200 }, -200, 1_000)).toBe(false);
    // Below the fold.
    expect(shouldFeedAdjustScrollOnResize({ start: 1_200, size: 300 }, 200, 1_000)).toBe(false);
  });

  test("a tall turn row mounting across the fold never drags the viewport", () => {
    // The measured case: estimate 508, real 1778, top 300px above the fold.
    // virtual-core's default compensates this by the full 1270px delta.
    expect(shouldFeedAdjustScrollOnResize({ start: 700, size: 508 }, 1_270, 1_000)).toBe(false);
  });
});

describe("learned row estimates", () => {
  test("a measured shape bucket replaces its static estimate", () => {
    const turn = turnSection(11);
    const before = estimateSectionSize(turn);
    for (let index = 0; index < 4; index += 1) {
      recordMeasuredSectionSize(turn, 1_400);
    }
    const after = estimateSectionSize(turn);
    expect(before).toBe(508);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThanOrEqual(1_400);
  });

  test("unusable measurements are ignored and outliers are clamped", () => {
    const turn = turnSection(12);
    for (const size of [0, -40, Number.NaN]) {
      recordMeasuredSectionSize(turn, size);
    }
    expect(estimateSectionSize(turn)).toBe(508);
    recordMeasuredSectionSize(turn, 99_999);
    expect(estimateSectionSize(turn)).toBeLessThanOrEqual(4_000);
  });

  test("buckets stay separate per turn shape", () => {
    const wide = turnSection(13);
    const narrow = turnSection(14);
    recordMeasuredSectionSize(wide, 2_000);
    expect(estimateSectionSize(wide)).toBe(2_000);
    expect(estimateSectionSize(narrow)).toBe(508);
  });
});
