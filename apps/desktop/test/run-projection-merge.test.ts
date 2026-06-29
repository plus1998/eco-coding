import { expect, test } from "bun:test";
import type { ThreadRunProjectionSnapshot, ThreadRunProjectionTimelineItem } from "../src/shared/ipc";
import { mergeThreadRunProjectionUpdate } from "../src/renderer/run-projection-merge";

function makeProjection(
  overrides: Partial<ThreadRunProjectionSnapshot> & Pick<ThreadRunProjectionSnapshot, "sourceEventCount">,
): ThreadRunProjectionSnapshot {
  const timeline =
    overrides.timeline ??
    Array.from({ length: overrides.sourceEventCount > 80 ? 120 : 40 }, (_, index) => ({
      id: `evt_${index}`,
      kind: "narrative" as const,
      text: `line ${index}`,
      role: "planner" as const,
      observedAt: new Date().toISOString(),
    }));
  return {
    generatedAt: overrides.generatedAt ?? new Date().toISOString(),
    thread: {
      threadId: "thr_1",
      status: "running",
      generatedAt: overrides.generatedAt ?? new Date().toISOString(),
      message: "",
    },
    timeline,
    agents: [],
    requestSpans: [],
    diagnostics: [],
    ...overrides,
    sourceEventCount: overrides.sourceEventCount,
  };
}

test("mergeThreadRunProjectionUpdate keeps fuller timeline when event count matches", () => {
  const full = makeProjection({ sourceEventCount: 100, timeline: Array.from({ length: 120 }, (_, i) => ({
    id: `evt_${i}`,
    kind: "narrative" as const,
    text: `line ${i}`,
    role: "planner" as const,
    observedAt: new Date().toISOString(),
  })) });
  const trimmed = makeProjection({ sourceEventCount: 100, timeline: Array.from({ length: 80 }, (_, i) => ({
    id: `evt_${i + 40}`,
    kind: "narrative" as const,
    text: `line ${i + 40}`,
    role: "planner" as const,
    observedAt: new Date().toISOString(),
  })) });

  expect(mergeThreadRunProjectionUpdate(full, trimmed)).toBe(full);
  const mergedFromTrimmed = mergeThreadRunProjectionUpdate(trimmed, full);
  expect(mergedFromTrimmed.timeline).toHaveLength(120);
  expect(mergedFromTrimmed.timeline.some((item) => item.id === "evt_0")).toBe(true);
  expect(mergedFromTrimmed.timeline.some((item) => item.id === "evt_119")).toBe(true);
});

test("mergeThreadRunProjectionUpdate merges trimmed newer feed without dropping history", () => {
  const full = makeProjection({ sourceEventCount: 100, timeline: Array.from({ length: 120 }, (_, i) => ({
    id: `evt_${i}`,
    kind: "narrative" as const,
    text: `line ${i}`,
    role: "planner" as const,
    observedAt: new Date().toISOString(),
  })) });
  const trimmed = makeProjection({ sourceEventCount: 101, timeline: Array.from({ length: 80 }, (_, i) => ({
    id: `evt_${i + 40}`,
    kind: "narrative" as const,
    text: `updated ${i + 40}`,
    role: "planner" as const,
    observedAt: new Date().toISOString(),
  })) });

  const merged = mergeThreadRunProjectionUpdate(full, trimmed, { preserveHistory: false });
  expect(merged.timeline).toHaveLength(120);
  expect(merged.sourceEventCount).toBe(101);
  expect(merged.timeline[40]?.text).toBe("updated 40");
  expect(merged.timeline[0]?.text).toBe("line 0");
});

test("mergeThreadRunProjectionUpdate keeps longer thinking text when feed update is truncated", () => {
  const current = makeProjection({
    sourceEventCount: 10,
    timeline: [
      {
        id: "think_1",
        sequence: 1,
        scope: "main" as const,
        eventType: "thinking.delta",
        text: "a".repeat(1500),
        role: "thinking" as const,
        at: "2026-01-01T00:00:01.000Z",
      },
    ],
  });
  const incoming = makeProjection({
    sourceEventCount: 11,
    timeline: [
      {
        id: "think_1",
        sequence: 1,
        scope: "main" as const,
        eventType: "thinking.delta",
        text: "a".repeat(1200),
        role: "thinking" as const,
        at: "2026-01-01T00:00:01.000Z",
      },
    ],
  });

  const merged = mergeThreadRunProjectionUpdate(current, incoming);
  expect(merged.timeline[0]?.text).toHaveLength(1500);
});

test("mergeThreadRunProjectionUpdate resets thinking text across user prompt boundary", () => {
  const current = makeProjection({
    sourceEventCount: 10,
    timeline: [
      {
        id: "think_1",
        sequence: 1,
        scope: "main" as const,
        eventType: "thinking.delta",
        text: "old thinking text that is much longer",
        role: "thinking" as const,
        streamKey: "thr_1:thinking",
        at: "2026-01-01T00:00:01.000Z",
      },
    ],
  });
  const incoming = makeProjection({
    sourceEventCount: 12,
    timeline: [
      {
        id: "prompt_2",
        sequence: 2,
        scope: "main" as const,
        eventType: "thread.status",
        text: "继续。",
        role: "user" as const,
        at: "2026-01-01T00:00:10.000Z",
        metadata: { liveType: "thread.user_prompt" },
      },
      {
        id: "think_1",
        sequence: 3,
        scope: "main" as const,
        eventType: "thinking.delta",
        text: "new",
        role: "thinking" as const,
        streamKey: "thr_1:thinking",
        at: "2026-01-01T00:00:11.000Z",
      },
    ],
  });

  const merged = mergeThreadRunProjectionUpdate(current, incoming);
  const thinking = merged.timeline.find((item) => item.id === "think_1");
  expect(thinking?.text).toBe("new");
});
