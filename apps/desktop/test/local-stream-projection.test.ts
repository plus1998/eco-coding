import { expect, test } from "bun:test";
import {
  applyLocalStreamUpdatesToProjection,
  clearLocalStreamUpdates,
  LOCAL_STREAM_NOTIFY_INTERVAL_MS,
  publishLocalStreamUpdate,
  subscribeToLocalStreamUpdates,
} from "../src/renderer/local-stream-projection";
import { projectionItemToDetailBlock } from "../src/renderer/thread-run-projection-view";
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

test("local thinking overlay with summary stamp maps to reasoning-stage without a collapsible thinking block", () => {
  const result = applyLocalStreamUpdatesToProjection(projection(), [
    {
      threadId: "thr_local",
      streamKey: "thr_local:planner:block:thinking:0",
      text: "定位入口",
      role: "thinking",
      channel: "thinking",
      reasoningDisplay: "summary",
      streaming: true,
      observedAt: "2026-01-01T00:00:01.000Z",
    },
  ]);

  expect(result.timeline[0]).toMatchObject({
    eventType: "thinking.delta",
    text: "定位入口",
    metadata: { localOnly: true, reasoningDisplay: "summary" },
  });
  expect(projectionItemToDetailBlock(result.timeline[0]!)).toMatchObject({
    kind: "reasoning-stage",
    label: "定位入口",
  });
});

test("local thinking overlay with raw stamp maps to collapsible thinking", () => {
  const result = applyLocalStreamUpdatesToProjection(projection(), [
    {
      threadId: "thr_local",
      streamKey: "thr_local:planner:block:thinking:0",
      text: "先看 adapter 再改 stamp",
      role: "thinking",
      channel: "thinking",
      reasoningDisplay: "raw",
      streaming: true,
      observedAt: "2026-01-01T00:00:01.000Z",
    },
  ]);

  expect(result.timeline[0]?.metadata).toMatchObject({
    localOnly: true,
    reasoningDisplay: "raw",
  });
  expect(projectionItemToDetailBlock(result.timeline[0]!)).toMatchObject({
    kind: "thinking",
    text: "先看 adapter 再改 stamp",
    streaming: true,
  });
});

test("local thinking overlay without a stamp stays collapsible thinking", () => {
  const result = applyLocalStreamUpdatesToProjection(projection(), [
    {
      threadId: "thr_local",
      streamKey: "thr_local:planner:block:thinking:0",
      text: "未分类思考",
      role: "thinking",
      channel: "thinking",
      streaming: true,
      observedAt: "2026-01-01T00:00:01.000Z",
    },
  ]);

  expect(result.timeline[0]?.metadata).toEqual({ localOnly: true });
  expect(projectionItemToDetailBlock(result.timeline[0]!)).toMatchObject({
    kind: "thinking",
    text: "未分类思考",
  });
});

test("overlays reasoningDisplay onto an existing local thinking item without changing kind later", () => {
  const first = applyLocalStreamUpdatesToProjection(projection(), [
    {
      threadId: "thr_local",
      streamKey: "thr_local:planner:block:thinking:0",
      text: "定位",
      role: "thinking",
      channel: "thinking",
      reasoningDisplay: "summary",
      streaming: true,
      observedAt: "2026-01-01T00:00:01.000Z",
    },
  ]);
  const second = applyLocalStreamUpdatesToProjection(first, [
    {
      threadId: "thr_local",
      streamKey: "thr_local:planner:block:thinking:0",
      text: "定位入口",
      role: "thinking",
      channel: "thinking",
      reasoningDisplay: "summary",
      streaming: true,
      observedAt: "2026-01-01T00:00:02.000Z",
    },
  ]);

  expect(second.timeline).toHaveLength(1);
  expect(second.timeline[0]?.metadata).toMatchObject({ reasoningDisplay: "summary" });
  expect(projectionItemToDetailBlock(first.timeline[0]!)?.kind).toBe("reasoning-stage");
  expect(projectionItemToDetailBlock(second.timeline[0]!)?.kind).toBe("reasoning-stage");
});

test("coalesces rapid local stream notifications and flushes final state immediately", async () => {
  const threadId = "thr_notify";
  let notifications = 0;
  const unsubscribe = subscribeToLocalStreamUpdates(threadId, () => {
    notifications += 1;
  });
  const baseUpdate = {
    threadId,
    streamKey: "stream_1",
    role: "planner",
    channel: "message" as const,
    streaming: true,
    observedAt: "2026-01-01T00:00:01.000Z",
  };

  publishLocalStreamUpdate({ ...baseUpdate, text: "一" });
  publishLocalStreamUpdate({ ...baseUpdate, text: "一段" });
  publishLocalStreamUpdate({ ...baseUpdate, text: "一段文字" });
  expect(notifications).toBe(0);

  await Bun.sleep(LOCAL_STREAM_NOTIFY_INTERVAL_MS + 10);
  expect(notifications).toBe(1);

  publishLocalStreamUpdate({ ...baseUpdate, text: "一段文字", streaming: false });
  expect(notifications).toBe(2);
  unsubscribe();
  clearLocalStreamUpdates(threadId);
});
