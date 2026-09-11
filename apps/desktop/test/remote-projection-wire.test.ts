import { expect, test } from "bun:test";
import { DesktopEventCenter, type DesktopEventCenterSink } from "../src/main/event-center";
import { MobileRemoteEventPublisher } from "../src/main/mobile-remote-event-publisher";
import { selectFeedProjectionLivePayload } from "../src/main/thread-run-projection-feed";
import type { EventCenterEnvelope, EventCenterJsonRpcNotification } from "../src/shared/event-center";
import type { ThreadLiveEvent, ThreadRunProjectionSnapshot } from "../src/shared/ipc";

const AT = "2026-01-01T00:00:00.000Z";

function userPrompt(sequence: number, text: string): ThreadRunProjectionSnapshot["timeline"][number] {
  return {
    id: `user:${sequence}`,
    sequence,
    eventType: "thread.status",
    scope: "main",
    role: "user",
    text,
    at: AT,
    metadata: { liveType: "thread.user_prompt" },
  };
}

function plannerMessage(sequence: number, text: string): ThreadRunProjectionSnapshot["timeline"][number] {
  return {
    id: `evt:${sequence}`,
    sequence,
    eventType: "message.final",
    scope: "main",
    role: "planner",
    text,
    at: AT,
  };
}

function snapshot(
  timeline: ThreadRunProjectionSnapshot["timeline"],
  historyRevision = 0,
): ThreadRunProjectionSnapshot {
  return {
    thread: { threadId: "thr_1", status: "running", generatedAt: AT },
    attempts: [],
    agents: [],
    requestSpans: [],
    timeline,
    diagnostics: [],
    sourceEventCount: timeline.length,
    historyRevision,
  };
}

function readWireProjection(notification: EventCenterJsonRpcNotification): ThreadRunProjectionSnapshot {
  const envelope = notification.params as EventCenterEnvelope<ThreadLiveEvent>;
  const projection = envelope.payload.projection;
  if (!projection) {
    throw new Error("notification has no projection payload");
  }
  return projection;
}

function timelineTexts(projection: ThreadRunProjectionSnapshot): string[] {
  return projection.timeline.map((item) => item.text);
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

/**
 * Mirrors the `emitThreadRunProjectionUpdated` cursor bookkeeping: the shared
 * per-thread cursor is what decides delta vs. full on the *shared* envelope.
 */
function createEmitter(center: DesktopEventCenter) {
  let previousMaxSequence: number | undefined;
  let previousEmittedRevision: number | undefined;
  return function emit(feedProjection: ThreadRunProjectionSnapshot) {
    const selection = selectFeedProjectionLivePayload({
      feedProjection,
      previousMaxSequence,
      previousEmittedRevision,
    });
    if (selection.payload.timeline.length > 0) {
      previousMaxSequence = Math.max(...feedProjection.timeline.map((item) => item.sequence));
    }
    previousEmittedRevision = selection.nextEmittedRevision;
    const payload: ThreadLiveEvent = {
      threadId: "thr_1",
      type: "thread.run_projection_updated",
      message: "run projection updated",
      role: "system",
      stream: false,
      projection: selection.payload,
    };
    center.publishThreadLiveEvent(payload, undefined, { remoteProjection: feedProjection });
    return selection.payload;
  };
}

test("remote wire keeps every user prompt while the renderer payload stays incremental", () => {
  const localEnvelopes: EventCenterEnvelope[] = [];
  const wireProjections: ThreadRunProjectionSnapshot[] = [];
  const localSink: DesktopEventCenterSink = {
    publish(envelope) {
      localEnvelopes.push(envelope);
    },
  };
  const center = new DesktopEventCenter();
  center.subscribe(localSink);
  center.subscribe(
    new MobileRemoteEventPublisher({
      deliver: (notification) => {
        wireProjections.push(readWireProjection(notification));
      },
    }),
  );
  const emit = createEmitter(center);

  const first = snapshot([userPrompt(1, "hi"), plannerMessage(29, "hello")]);
  const firstPayload = emit(first);
  expect(firstPayload.timeline.map((item) => item.sequence)).toEqual([1, 29]);

  const second = snapshot([
    userPrompt(1, "hi"),
    plannerMessage(29, "hello"),
    plannerMessage(31, "still working"),
  ]);
  const secondPayload = emit(second);

  // Local renderer contract unchanged: it already holds the skeleton and gets a
  // filtered delta on the shared envelope.
  expect(secondPayload.timeline.map((item) => item.sequence)).toEqual([31]);
  expect(localEnvelopes).toHaveLength(2);
  expect(
    (
      requireValue(localEnvelopes[1], "second local envelope").payload as ThreadLiveEvent
    ).projection?.timeline.map((item) => item.sequence),
  ).toEqual([31]);

  // Remote contract: a phone syncing from this notification must be able to
  // rebuild the whole Feed, including the user prompt that sits in the delta's
  // dropped range.
  expect(wireProjections).toHaveLength(2);
  expect(timelineTexts(requireValue(wireProjections[1], "second wire projection"))).toEqual([
    "hi",
    "hello",
    "still working",
  ]);
  expect(
    requireValue(wireProjections[1], "second wire projection").timeline.map((item) => item.sequence),
  ).toEqual([1, 29, 31]);
});

test("remote wire carries a full skeleton after a revision bump", () => {
  const wireProjections: ThreadRunProjectionSnapshot[] = [];
  const center = new DesktopEventCenter();
  center.subscribe(
    new MobileRemoteEventPublisher({
      deliver: (notification) => wireProjections.push(readWireProjection(notification)),
    }),
  );
  const emit = createEmitter(center);

  emit(snapshot([userPrompt(1, "hi"), plannerMessage(29, "hello")]));
  emit(snapshot([userPrompt(1, "hi"), plannerMessage(29, "hello"), plannerMessage(31, "tick")], 1));

  expect(wireProjections).toHaveLength(2);
  const revisionBumped = requireValue(wireProjections[1], "second wire projection");
  expect(revisionBumped.historyRevision).toBe(1);
  expect(revisionBumped.timeline.map((item) => item.sequence)).toEqual([1, 29, 31]);
});

test("projection wire follows the delivered cursor: revision bump then delta then full", () => {
  const wireProjections: ThreadRunProjectionSnapshot[] = [];
  const center = new DesktopEventCenter();
  center.subscribe(
    new MobileRemoteEventPublisher({
      deliver: (notification) => wireProjections.push(readWireProjection(notification)),
    }),
  );
  const emit = createEmitter(center);

  emit(snapshot([userPrompt(1, "hi")]));
  emit(snapshot([userPrompt(1, "hi"), plannerMessage(3, "a")]));
  emit(snapshot([userPrompt(1, "hi"), plannerMessage(3, "a"), plannerMessage(5, "b")]));

  // Third emit is a delta on the shared envelope, but every remote payload still
  // contains the complete skeleton — a client that missed emit #1 is fine.
  for (const projection of wireProjections) {
    expect(timelineTexts(projection)).toContain("hi");
  }
  expect(
    requireValue(wireProjections.at(-1), "last wire projection").timeline.map((item) => item.sequence),
  ).toEqual([1, 3, 5]);
});

test("publisher without extras keeps the previous delta passthrough", () => {
  const delivered: EventCenterJsonRpcNotification[] = [];
  const publisher = new MobileRemoteEventPublisher({ deliver: (n) => delivered.push(n) });
  const delta = snapshot([plannerMessage(31, "tick")]);
  const envelope: EventCenterEnvelope<ThreadLiveEvent> = {
    protocolVersion: 1,
    id: "evt_1",
    kind: "thread.projection",
    source: "desktop",
    occurredAt: AT,
    threadId: "thr_1",
    payload: {
      threadId: "thr_1",
      type: "thread.run_projection_updated",
      message: "run projection updated",
      role: "system",
      stream: false,
      projection: delta,
    },
  };

  publisher.publish(envelope, { jsonrpc: "2.0", method: "thread.events", params: envelope });

  expect(delivered).toHaveLength(1);
  expect(
    readWireProjection(requireValue(delivered[0], "delivered notification")).timeline.map(
      (item) => item.sequence,
    ),
  ).toEqual([31]);
});
