import { expect, test } from "bun:test";
import {
  FEED_PROJECTION_MAX_TEXT_CHARS,
  FEED_PROJECTION_MAX_TIMELINE_ITEMS,
  trimProjectionForFeed,
} from "../src/main/thread-run-projection-feed";
import type { ThreadRunProjectionSnapshot } from "../src/shared/ipc";

function createProjection(text: string, { longDelegation = true } = {}): ThreadRunProjectionSnapshot {
  return {
    thread: {
      threadId: "thr_1",
      status: "idle",
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    attempts: [],
    agents: [
      {
        agentId: "agent_1",
        role: "explore",
        kind: "subagent",
        status: "stopped",
        startedAt: "2026-01-01T00:00:00.000Z",
        durationMs: 1,
        ...(longDelegation ? { delegationPrompt: "x".repeat(3_000) } : {}),
        timeline: [
          {
            id: "evt_1",
            sequence: 1,
            eventType: "message.final",
            scope: "agent",
            text,
            at: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    ],
    requestSpans: [],
    timeline: [
      {
        id: "evt_main",
        sequence: 1,
        eventType: "message.final",
        scope: "main",
        text,
        at: "2026-01-01T00:00:00.000Z",
      },
    ],
    diagnostics: [],
    sourceEventCount: 2,
  };
}

test("trimProjectionForFeed truncates long timeline text and keeps metadata flag", () => {
  const longText = "a".repeat(FEED_PROJECTION_MAX_TEXT_CHARS + 50);
  const trimmed = trimProjectionForFeed(createProjection(longText));

  expect(trimmed.timeline[0]?.text).toHaveLength(FEED_PROJECTION_MAX_TEXT_CHARS);
  expect(trimmed.timeline[0]?.metadata?.textTruncated).toBe(true);
  expect(trimmed.agents[0]?.timeline[0]?.metadata?.textTruncated).toBe(true);
  expect(trimmed.agents[0]?.delegationPrompt).toHaveLength(2_000);
});

test("trimProjectionForFeed keeps only the most recent timeline items", () => {
  const items = Array.from({ length: 150 }, (_, index) => ({
    id: `evt_${index}`,
    sequence: index + 1,
    eventType: "message.final" as const,
    scope: "main" as const,
    text: `line ${index}`,
    at: "2026-01-01T00:00:00.000Z",
  }));
  const trimmed = trimProjectionForFeed({
    thread: {
      threadId: "thr_1",
      status: "idle",
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    attempts: [],
    agents: [],
    requestSpans: [],
    timeline: items,
    diagnostics: [],
    sourceEventCount: items.length,
  });

  expect(trimmed.timeline).toHaveLength(FEED_PROJECTION_MAX_TIMELINE_ITEMS);
  expect(trimmed.timeline[0]?.id).toBe("evt_30");
  expect(trimmed.timeline.at(-1)?.id).toBe("evt_149");
});

test("trimProjectionForFeed leaves short projection unchanged", () => {
  const projection = createProjection("short message", { longDelegation: false });
  expect(trimProjectionForFeed(projection)).toEqual(projection);
});
