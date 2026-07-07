import { expect, test } from "bun:test";
import {
  buildFeedProjectionSignature,
  FEED_PROJECTION_MAX_TEXT_CHARS,
  filterFeedProjectionAfterSequence,
  maxFeedProjectionTimelineSequence,
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
  expect(trimmed.agents[0]?.timeline).toEqual([]);
  expect(trimmed.agents[0]?.delegationPrompt).toHaveLength(2_000);
});

test("trimProjectionForFeed truncates streaming deltas", () => {
  const longText = "b".repeat(FEED_PROJECTION_MAX_TEXT_CHARS + 50);
  const projection: ThreadRunProjectionSnapshot = {
    thread: {
      threadId: "thr_1",
      status: "running",
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    attempts: [],
    agents: [],
    requestSpans: [],
    timeline: [
      {
        id: "think_delta",
        sequence: 1,
        eventType: "thinking.delta",
        scope: "main",
        text: longText,
        at: "2026-01-01T00:00:00.000Z",
      },
    ],
    diagnostics: [],
    sourceEventCount: 1,
  };

  const trimmed = trimProjectionForFeed(projection);
  expect(trimmed.timeline[0]?.text).toHaveLength(FEED_PROJECTION_MAX_TEXT_CHARS);
  expect(trimmed.timeline[0]?.metadata?.textTruncated).toBe(true);
});

test("trimProjectionForFeed keeps full main timeline history", () => {
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

  expect(trimmed.timeline).toHaveLength(items.length);
  expect(trimmed.timeline[0]?.id).toBe("evt_0");
  expect(trimmed.timeline.at(-1)?.id).toBe("evt_149");
});

test("filterFeedProjectionAfterSequence keeps only uncached main timeline items", () => {
  const projection = trimProjectionForFeed({
    ...createProjection("short message", { longDelegation: false }),
    timeline: [
      {
        id: "evt_1",
        sequence: 1,
        eventType: "message.final",
        scope: "main",
        text: "one",
        at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "evt_2",
        sequence: 2,
        eventType: "message.final",
        scope: "main",
        text: "two",
        at: "2026-01-01T00:00:01.000Z",
      },
      {
        id: "evt_3",
        sequence: 3,
        eventType: "message.final",
        scope: "main",
        text: "three",
        at: "2026-01-01T00:00:02.000Z",
      },
    ],
  });

  const filtered = filterFeedProjectionAfterSequence(projection, 1);

  expect(filtered.thread).toEqual(projection.thread);
  expect(filtered.agents).toEqual(projection.agents);
  expect(filtered.timeline.map((item) => item.id)).toEqual(["evt_2", "evt_3"]);
  expect(maxFeedProjectionTimelineSequence(projection)).toBe(3);
});

test("trimProjectionForFeed strips agent detail timeline from feed", () => {
  const items = Array.from({ length: 150 }, (_, index) => ({
    id: `agent_evt_${index}`,
    sequence: index + 1,
    eventType: "message.final" as const,
    scope: "agent" as const,
    text: `line ${index}`,
    at: "2026-01-01T00:00:00.000Z",
  }));
  const projection = createProjection("short message", { longDelegation: false });
  const trimmed = trimProjectionForFeed({
    ...projection,
    agents: [
      {
        ...projection.agents[0]!,
        timeline: items,
      },
    ],
  });

  expect(trimmed.agents[0]?.timeline).toEqual([]);
  expect(trimmed.timeline[0]?.text).toBe("short message");
});

test("trimProjectionForFeed strips tool detail metadata from main feed", () => {
  const projection = createProjection("short message", { longDelegation: false });
  const trimmed = trimProjectionForFeed({
    ...projection,
    timeline: [
      {
        id: "tool_1",
        sequence: 1,
        eventType: "tool.completed",
        scope: "main",
        text: "Tool: Bash · bun test",
        at: "2026-01-01T00:00:00.000Z",
        metadata: {
          tool: {
            name: "Bash",
            detail: "bun test",
            toolUseId: "toolu_1",
            description: "Run tests",
            status: "completed",
            durationMs: 1200,
            output: "x".repeat(20_000),
            outputTruncated: true,
            outputOriginalChars: 20_000,
            outputKeptChars: 4_000,
            fileChange: {
              path: "apps/mobile/lib/main.dart",
              additions: 1,
              deletions: 0,
              previewLines: [{ kind: "add", text: "large diff preview" }],
            },
          },
        },
      },
    ],
  });

  expect(trimmed.timeline[0]?.metadata?.tool).toEqual({
    name: "Bash",
    detail: "bun test",
    toolUseId: "toolu_1",
    description: "Run tests",
    status: "completed",
    durationMs: 1200,
  });
});

test("trimProjectionForFeed leaves short projection unchanged", () => {
  const projection = createProjection("short message", { longDelegation: false });
  expect(trimProjectionForFeed(projection)).toEqual({
    ...projection,
    agents: [{ ...projection.agents[0]!, timeline: [] }],
  });
});

test("buildFeedProjectionSignature ignores generatedAt", () => {
  const projection = createProjection("short message", { longDelegation: false });
  const changed = {
    ...projection,
    thread: {
      ...projection.thread,
      generatedAt: "2026-01-01T00:00:01.000Z",
    },
  };

  expect(buildFeedProjectionSignature(changed)).toBe(buildFeedProjectionSignature(projection));
});

test("buildFeedProjectionSignature ignores active agent duration", () => {
  const projection = createProjection("short message", { longDelegation: false });
  const activeProjection: ThreadRunProjectionSnapshot = {
    ...projection,
    agents: [
      {
        ...projection.agents[0]!,
        status: "active",
        durationMs: 1,
      },
    ],
  };
  const changed = {
    ...activeProjection,
    agents: [
      {
        ...activeProjection.agents[0]!,
        durationMs: 10_000,
      },
    ],
  };

  expect(buildFeedProjectionSignature(changed)).toBe(buildFeedProjectionSignature(activeProjection));
});

test("buildFeedProjectionSignature changes when feed-visible content changes", () => {
  const projection = createProjection("short message", { longDelegation: false });
  const signature = buildFeedProjectionSignature(projection);

  expect(
    buildFeedProjectionSignature({
      ...projection,
      thread: { ...projection.thread, status: "running" },
    }),
  ).not.toBe(signature);
  expect(
    buildFeedProjectionSignature({
      ...projection,
      sourceEventCount: projection.sourceEventCount + 1,
    }),
  ).not.toBe(signature);
  expect(
    buildFeedProjectionSignature({
      ...projection,
      timeline: [
        {
          ...projection.timeline[0]!,
          text: "changed message",
        },
      ],
    }),
  ).not.toBe(signature);
  expect(
    buildFeedProjectionSignature({
      ...projection,
      requestSpans: [
        {
          requestId: "req_1",
          status: "streaming",
          startedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
  ).not.toBe(signature);
});
