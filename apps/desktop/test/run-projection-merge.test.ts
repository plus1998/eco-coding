import { expect, test } from "bun:test";
import type { ThreadRunProjectionSnapshot } from "../src/shared/ipc";
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
  expect(mergeThreadRunProjectionUpdate(trimmed, full)).toBe(full);
});

test("mergeThreadRunProjectionUpdate rejects trimmed newer feed while preserving history", () => {
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
    text: `line ${i + 40}`,
    role: "planner" as const,
    observedAt: new Date().toISOString(),
  })) });

  expect(
    mergeThreadRunProjectionUpdate(full, trimmed, { preserveHistory: true }),
  ).toBe(full);
  expect(
    mergeThreadRunProjectionUpdate(full, trimmed, { preserveHistory: false }),
  ).toBe(trimmed);
});
