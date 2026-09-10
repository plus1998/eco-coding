import { describe, expect, test } from "vitest";
import { isMetricsOnlyThreadRunEvent } from "../src/main/thread-run-event-normalizer";
import { buildThreadRunProjection } from "../src/main/thread-run-projection";
import { trimProjectionForFeed } from "../src/main/thread-run-projection-feed";
import {
  collectSettledSdkMessageBlocks,
  sdkMessageBlockIdentity,
} from "../src/main/thread-run-message-blocks";
import {
  isFeedMainTimelineEvent,
  stageFeedTimelineEvent,
  type FeedTimelineStageState,
} from "../src/main/thread-feed-timeline-items";
import type { ThreadRunEvent } from "../src/shared/ipc";
import { compareFeedSkeletonTimelineItems } from "../src/shared/thread-run-projection-skeleton";
import {
  CORPUS_ATTEMPT_ID,
  CORPUS_THREAD_ID,
  collapseStreamDeltas,
  corpusAttemptRecord,
  eventFromShape,
  generateStream,
  isPersistableShape,
  loadObservedShapeFile,
  timelineSignature,
} from "./helpers/feed-parity-corpus";

const THREAD_ID = "thr_timeline_items";

function event(overrides: Partial<ThreadRunEvent> & Pick<ThreadRunEvent, "id">): ThreadRunEvent {
  return {
    threadId: THREAD_ID,
    sequence: 1,
    eventType: "message.final",
    scope: "main",
    streamState: "finalized",
    message: "text",
    observedAt: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

function emptyStage(): FeedTimelineStageState {
  return { items: [], finalizedSdkBlocks: [] };
}

function stageAll(events: readonly ThreadRunEvent[]): FeedTimelineStageState {
  let state = emptyStage();
  for (const item of events) {
    state = stageFeedTimelineEvent(state, item);
  }
  return state;
}

describe("feed timeline item staging", () => {
  test("tracks exactly the projection's main timeline scope on real shapes", () => {
    const shapeFile = loadObservedShapeFile();
    for (const shape of shapeFile.shapes) {
      const shapeEvent = eventFromShape(shape, { sequence: 1, attemptId: CORPUS_ATTEMPT_ID });
      const expected = shape.scope !== "agent" && !isMetricsOnlyThreadRunEvent(shapeEvent);
      expect(
        isFeedMainTimelineEvent(shapeEvent),
        `${shape.eventType}/${shape.scope}/${shape.role ?? "-"} liveType=${shape.metadata?.liveType ?? "-"}`,
      ).toBe(expected);
    }
  });

  test("persisted history never contains metrics-only live types", () => {
    // The Feed rule filters them defensively; real data shows they are not persisted at all.
    expect(loadObservedShapeFile().shapes.filter((shape) => !isPersistableShape(shape))).toEqual([]);
  });

  test("agent-scoped and metrics-only events leave the state untouched", () => {
    const state = stageAll([event({ id: "seed", sequence: 1 })]);
    expect(stageFeedTimelineEvent(state, event({ id: "agent", sequence: 2, scope: "agent" }))).toBe(state);
    expect(
      stageFeedTimelineEvent(
        state,
        event({ id: "metrics", sequence: 3, metadata: { liveType: "thread.todos_updated" } }),
      ),
    ).toBe(state);
    // A replayed duplicate of a settled block with no stream identity is also a no-op.
    const settled = stageAll([
      event({ id: "m1", sequence: 4, metadata: { sdkMessageId: "m1" } }),
    ]);
    expect(
      stageFeedTimelineEvent(settled, event({ id: "m2", sequence: 5, metadata: { sdkMessageId: "m1" } })),
    ).toBe(settled);
  });

  test("replaces the tracked item when a stream delta is re-emitted", () => {
    const first = event({ id: "d1", sequence: 1, eventType: "message.delta", streamState: "streaming", streamKey: "s1", runAttemptId: "att", message: "a" });
    const second = event({ id: "d2", sequence: 2, eventType: "message.delta", streamState: "streaming", streamKey: "s1", runAttemptId: "att", message: "ab" });
    const state = stageAll([first, second]);
    expect(state.items.map((item) => item.id)).toEqual(["d2"]);
    expect(state.items[0]?.text).toBe("ab");
  });

  test("keeps deltas of a different stream, attempt or request id side by side", () => {
    const base = { eventType: "message.delta", streamState: "streaming", streamKey: "s1", runAttemptId: "att" } as const;
    const state = stageAll([
      event({ id: "d1", sequence: 1, ...base }),
      event({ id: "d2", sequence: 2, ...base, streamKey: "s2" }),
      event({ id: "d3", sequence: 3, ...base, runAttemptId: "att2" }),
      event({ id: "d4", sequence: 4, ...base, requestId: "r1" }),
    ]);
    expect(state.items.map((item) => item.id)).toEqual(["d1", "d2", "d3", "d4"]);
  });

  test("drops a replay of a settled sdk block and re-anchors its stream", () => {
    const settledBlock = { metadata: { sdkMessageId: "m1" } };
    const delta = event({
      id: "d1",
      sequence: 1,
      eventType: "message.delta",
      streamState: "streaming",
      streamKey: "s1",
      ...settledBlock,
      message: "partial",
    });
    const final = event({ id: "f1", sequence: 2, streamState: "finalized", ...settledBlock, message: "final" });
    const replay = event({
      id: "d2",
      sequence: 3,
      eventType: "message.delta",
      streamState: "streaming",
      streamKey: "s1",
      ...settledBlock,
      message: "partial again",
    });

    const afterFinal = stageAll([delta, final]);
    expect(afterFinal.items.map((item) => item.id)).toEqual(["d1", "f1"]);

    // The replay is dropped, but its stream no longer has a tracked delta either: the store
    // already replaced that delta before the projection ran.
    const afterReplay = stageFeedTimelineEvent(afterFinal, replay);
    expect(afterReplay.items.map((item) => item.id)).toEqual(["f1"]);
    expect(afterReplay.finalizedSdkBlocks).toEqual(["main:message:m1"]);
  });

  test("items stay ordered by sequence and the block list matches the projection's dedupe", () => {
    const events = [
      event({ id: "b", sequence: 2 }),
      event({ id: "a", sequence: 1 }),
      event({ id: "c", sequence: 3, metadata: { sdkMessageId: "m1" } }),
      event({ id: "d", sequence: 4, metadata: { sdkMessageId: "m1" } }),
    ];
    const state = stageAll(events);
    expect(state.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect([...state.items].sort(compareFeedSkeletonTimelineItems)).toEqual(state.items);
    expect(state.finalizedSdkBlocks).toEqual(collectSettledSdkMessageBlocks(events));
    expect(new Set(state.finalizedSdkBlocks).size).toBe(state.finalizedSdkBlocks.length);
  });

  test("staging the whole corpus equals the projection's main timeline", () => {
    // Isolates the staging rule from the skeleton bookkeeping: after the store's delta
    // collapse, the items `stage` accumulates must be exactly the projection's main
    // timeline. Agent-scoped rows are excluded because the projection would promote orphan
    // agent rows onto the main timeline, which is a rebuild-only behaviour.
    const shapes = loadObservedShapeFile().shapes;
    for (let seed = 1; seed <= 25; seed += 1) {
      const stream = generateStream({ seed: seed * 3, shapes, count: 24, finishAttempt: false });
      const mainEvents = collapseStreamDeltas(stream.events).filter((item) => item.scope !== "agent");
      const staged = timelineSignature(stageAll(mainEvents).items);
      const projected = timelineSignature(
        trimProjectionForFeed(
          buildThreadRunProjection({
            threadId: CORPUS_THREAD_ID,
            status: "running",
            attempts: [corpusAttemptRecord("running")],
            agents: [],
            events: mainEvents,
            historyComplete: true,
          }),
        ).timeline,
      );
      expect(staged, `seed ${seed}`).toEqual(projected);
    }
  });

  test("settled block ids ignore agent-scoped rows", () => {
    const state = stageAll([
      event({ id: "a", sequence: 1, metadata: { sdkMessageId: "m1" } }),
      event({ id: "b", sequence: 2, scope: "agent", agentId: "agent_a", metadata: { sdkMessageId: "m1" } }),
    ]);
    expect(state.finalizedSdkBlocks).toEqual(["main:message:m1"]);
    expect(sdkMessageBlockIdentity(event({ id: "a", metadata: { sdkMessageId: "m1" } }))).toBe("main:message:m1");
  });
});
