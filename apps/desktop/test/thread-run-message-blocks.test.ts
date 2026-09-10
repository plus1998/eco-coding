import { describe, expect, test } from "vitest";
import {
  collectSettledSdkMessageBlocks,
  dedupeSettledSdkMessageBlocks,
  isCollapsibleStreamEvent,
  sameStreamIdentity,
  sdkMessageBlockIdentity,
  settlesSdkMessageBlock,
  streamIdentityOf,
} from "../src/main/thread-run-message-blocks";
import type { ThreadRunEvent } from "../src/shared/ipc";
import { loadObservedShapeFile } from "./helpers/feed-parity-corpus";

const THREAD_ID = "thr_message_blocks";

function event(overrides: Partial<ThreadRunEvent> & Pick<ThreadRunEvent, "id">): ThreadRunEvent {
  return {
    threadId: THREAD_ID,
    sequence: 1,
    eventType: "message.delta",
    scope: "main",
    streamState: "streaming",
    message: "text",
    observedAt: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

describe("thread run message block rules", () => {
  test("only stream deltas with a non-blank stream key collapse", () => {
    expect(isCollapsibleStreamEvent(event({ id: "a", eventType: "message.delta", streamKey: "s1" }))).toBe(
      true,
    );
    expect(isCollapsibleStreamEvent(event({ id: "b", eventType: "thinking.delta", streamKey: "s1" }))).toBe(
      true,
    );
    expect(isCollapsibleStreamEvent(event({ id: "c", eventType: "message.delta" }))).toBe(false);
    expect(isCollapsibleStreamEvent(event({ id: "d", eventType: "message.delta", streamKey: "   " }))).toBe(
      false,
    );
    expect(isCollapsibleStreamEvent(event({ id: "e", eventType: "message.final", streamKey: "s1" }))).toBe(
      false,
    );
    expect(isCollapsibleStreamEvent(event({ id: "f", eventType: "tool.started", streamKey: "s1" }))).toBe(
      false,
    );
  });

  test("stream identity ignores content but separates type, key, request and attempt", () => {
    const base = event({ id: "a", streamKey: "s1", requestId: "r1", runAttemptId: "t1", message: "one" });
    expect(sameStreamIdentity(base, event({ ...base, id: "b", message: "two", sequence: 9 }))).toBe(true);
    expect(sameStreamIdentity(base, event({ ...base, id: "c", streamKey: "s2" }))).toBe(false);
    expect(sameStreamIdentity(base, event({ ...base, id: "d", requestId: "r2" }))).toBe(false);
    expect(sameStreamIdentity(base, event({ ...base, id: "e", runAttemptId: "t2" }))).toBe(false);
    expect(sameStreamIdentity(base, event({ ...base, id: "f", eventType: "thinking.delta" }))).toBe(false);
    // Keys are trimmed on persist, so padding must not split one stream in two.
    expect(sameStreamIdentity(base, event({ ...base, id: "g", streamKey: " s1 " }))).toBe(true);
  });

  test("item identity groups exactly the events the collapse rule groups", () => {
    const first = event({ id: "a", streamKey: "s1", requestId: "r1", runAttemptId: "t1" });
    const second = event({ ...first, id: "b", sequence: 2, message: "longer text" });
    expect(streamIdentityOf(first)).toBe(streamIdentityOf(second));
    expect(sameStreamIdentity(first, second)).toBe(true);
    // Non-deltas and keyless deltas have no stream identity at all.
    expect(streamIdentityOf(event({ id: "c", eventType: "message.final", streamKey: "s1" }))).toBeUndefined();
    expect(streamIdentityOf(event({ id: "d", streamKey: "  " }))).toBeUndefined();
    expect(streamIdentityOf(event({ id: "e", streamKey: "s2" }))).not.toBe(streamIdentityOf(first));
  });

  test("sdk block identity uses channel, owner precedence and trims the id", () => {
    const base = event({
      id: "a",
      metadata: { sdkMessageId: "m1" },
      role: "coder",
      agentId: "agent_a",
      parentToolUseId: "tool_a",
    });
    expect(sdkMessageBlockIdentity(base)).toBe("agent_a:message:m1");
    expect(sdkMessageBlockIdentity(event({ ...base, id: "b", agentId: undefined }))).toBe(
      "tool_a:message:m1",
    );
    expect(
      sdkMessageBlockIdentity(event({ ...base, id: "c", agentId: undefined, parentToolUseId: undefined })),
    ).toBe("coder:message:m1");
    expect(
      sdkMessageBlockIdentity(
        event({ ...base, id: "d", agentId: undefined, parentToolUseId: undefined, role: undefined }),
      ),
    ).toBe("main:message:m1");
    expect(sdkMessageBlockIdentity(event({ ...base, id: "e", eventType: "thinking.final" }))).toBe(
      "agent_a:thinking:m1",
    );
    expect(
      sdkMessageBlockIdentity(event({ ...base, id: "f", metadata: { sdkMessageId: "  " } })),
    ).toBeUndefined();
    expect(sdkMessageBlockIdentity(event({ ...base, id: "g", metadata: {} }))).toBeUndefined();
    expect(sdkMessageBlockIdentity(event({ ...base, id: "h", eventType: "tool.started" }))).toBeUndefined();
    expect(sdkMessageBlockIdentity(event({ ...base, id: "i", metadata: { sdkMessageId: " m1 " } }))).toBe(
      "agent_a:message:m1",
    );
  });

  test("a block settles on finals and on finalized stream state only", () => {
    expect(settlesSdkMessageBlock(event({ id: "a", eventType: "message.final" }))).toBe(true);
    expect(settlesSdkMessageBlock(event({ id: "b", eventType: "thinking.final" }))).toBe(true);
    expect(settlesSdkMessageBlock(event({ id: "c", streamState: "finalized" }))).toBe(true);
    expect(settlesSdkMessageBlock(event({ id: "d", streamState: "streaming" }))).toBe(false);
    // Real data has a third state ("placeholder") that must not be treated as settled.
    expect(settlesSdkMessageBlock(event({ id: "e", streamState: "placeholder" }))).toBe(false);
    expect(settlesSdkMessageBlock(event({ id: "f", streamState: "none" }))).toBe(false);
  });

  test("dedupe drops replays that arrive after their block settled", () => {
    const stream = [
      event({
        id: "d1",
        sequence: 1,
        eventType: "message.delta",
        streamKey: "s1",
        metadata: { sdkMessageId: "m1" },
      }),
      event({
        id: "d2",
        sequence: 2,
        eventType: "message.delta",
        streamKey: "s1",
        metadata: { sdkMessageId: "m1" },
      }),
      event({
        id: "f1",
        sequence: 3,
        eventType: "message.final",
        streamKey: "s1",
        streamState: "finalized",
        metadata: { sdkMessageId: "m1" },
      }),
      // Replay of the same block after it settled -> dropped.
      event({
        id: "d3",
        sequence: 4,
        eventType: "message.delta",
        streamKey: "s1",
        metadata: { sdkMessageId: "m1" },
      }),
      // A different block is untouched.
      event({
        id: "o1",
        sequence: 5,
        eventType: "thinking.delta",
        streamKey: "s2",
        metadata: { sdkMessageId: "m2" },
      }),
      event({ id: "p1", sequence: 6, eventType: "tool.started" }),
    ];
    expect(dedupeSettledSdkMessageBlocks(stream).map((item) => item.id)).toEqual([
      "d1",
      "d2",
      "f1",
      "o1",
      "p1",
    ]);
    expect(collectSettledSdkMessageBlocks(stream)).toEqual(["main:message:m1"]);
    // Blocks without an id are always kept.
    expect(dedupeSettledSdkMessageBlocks([event({ id: "x" }), event({ id: "y", sequence: 2 })])).toHaveLength(
      2,
    );
  });

  test("collect matches dedupe for real observed shapes", () => {
    const shapes = loadObservedShapeFile().shapes.filter(
      (shape) => shape.metadata?.liveType && shape.eventType.includes("."),
    );
    // Build a small log from real shapes that carry sdkMessageId, then assert the two rules
    // agree: everything dedupe drops is exactly the replay of an already settled block.
    const events: ThreadRunEvent[] = [];
    let sequence = 0;
    for (const shape of shapes) {
      for (let repeat = 0; repeat < 2; repeat += 1) {
        sequence += 1;
        events.push(
          event({
            id: `e${sequence}`,
            sequence,
            eventType: shape.eventType as ThreadRunEvent["eventType"],
            scope: shape.scope as ThreadRunEvent["scope"],
            streamState: shape.streamState as ThreadRunEvent["streamState"],
            ...(shape.role ? { role: shape.role } : {}),
            ...(shape.hasStreamKey ? { streamKey: `s${sequence % 3}` } : {}),
            ...(shape.hasRunAttemptId ? { runAttemptId: "att" } : {}),
            metadata: { sdkMessageId: "block", liveType: shape.metadata?.liveType },
          }),
        );
      }
    }
    const kept = new Set(dedupeSettledSdkMessageBlocks(events).map((item) => item.id));
    const settled = new Set<string>();
    const expected = new Set<string>();
    for (const item of events) {
      const identity = sdkMessageBlockIdentity(item);
      if (!identity) {
        expected.add(item.id);
        continue;
      }
      if (!settled.has(identity)) {
        expected.add(item.id);
      }
      if (settlesSdkMessageBlock(item)) {
        settled.add(identity);
      }
    }
    expect([...kept].sort()).toEqual([...expected].sort());
  });

  test("the rules are implemented once, shared by the projection and the event cache", async () => {
    // The original feed bug came from three private copies of these rules drifting apart.
    const { readFileSync } = await import("node:fs");
    const sources = {
      projection: readFileSync(new URL("../src/main/thread-run-projection.ts", import.meta.url), "utf8"),
      store: readFileSync(new URL("../src/main/conversation-store.ts", import.meta.url), "utf8"),
      timelineItems: readFileSync(
        new URL("../src/main/thread-feed-timeline-items.ts", import.meta.url),
        "utf8",
      ),
    };
    for (const [label, source] of Object.entries(sources)) {
      expect(source, `${label} must import the shared rules`).toMatch(/from "\.\/thread-run-message-blocks"/);
      expect(source, `${label} must not define another copy`).not.toMatch(
        /function\s+(sdkMessageBlockIdentity|isCollapsibleStreamEvent|isCollapsibleProjectionStreamEvent|dedupeSettledSdkMessageBlocks|dedupeFinalizedSdkMessageBlocks|sameStreamIdentity|sameProjectionStreamIdentity)\s*\(/,
      );
    }
  });
});
