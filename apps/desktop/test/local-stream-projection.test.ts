import { expect, test } from "bun:test";
import { applyLocalStreamUpdatesToProjection } from "../src/renderer/local-stream-projection";
import type { ThreadRunProjectionSnapshot } from "../src/shared/ipc";

function projection(): ThreadRunProjectionSnapshot {
  return {
    thread: {
      threadId: "thr_local",
      status: "running",
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    attempts: [],
    agents: [],
    requestSpans: [],
    timeline: [],
    diagnostics: [],
    sourceEventCount: 1,
  };
}

test("adds an unpersisted local stream item immediately", () => {
  const result = applyLocalStreamUpdatesToProjection(projection(), [
    {
      threadId: "thr_local",
      streamKey: "thr_local:planner:block:text:0",
      text: "逐",
      role: "planner",
      channel: "message",
      streaming: true,
      observedAt: "2026-01-01T00:00:01.000Z",
    },
  ]);

  expect(result.timeline).toMatchObject([
    {
      eventType: "message.delta",
      text: "逐",
      streamKey: "thr_local:planner:block:text:0",
      metadata: { localOnly: true },
    },
  ]);
});

test("overlays the latest local text onto a persisted stream item without duplicating it", () => {
  const base = projection();
  base.timeline = [
    {
      id: "persisted_delta",
      sequence: 2,
      eventType: "message.delta",
      scope: "main",
      text: "逐字",
      at: "2026-01-01T00:00:01.000Z",
      role: "planner",
      streamKey: "thr_local:planner:block:text:0",
    },
  ];

  const result = applyLocalStreamUpdatesToProjection(base, [
    {
      threadId: "thr_local",
      streamKey: "thr_local:planner:block:text:0",
      text: "逐字输出",
      role: "planner",
      channel: "message",
      streaming: true,
      observedAt: "2026-01-01T00:00:02.000Z",
    },
  ]);

  expect(result.timeline).toHaveLength(1);
  expect(result.timeline[0]?.text).toBe("逐字输出");
});
