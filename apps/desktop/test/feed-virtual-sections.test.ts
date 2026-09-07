import { describe, expect, test } from "bun:test";
import {
  FEED_VIRTUALIZE_MIN_SECTIONS,
  findFeedSectionIndexForAnchor,
  isThreadPromptAnchorId,
  listUserMessageAnchorsFromSections,
} from "../src/renderer/feed-virtual-sections";
import type { ThreadRunTurnFeedSection } from "../src/renderer/thread-run-turn-feed";

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
