import { expect, test } from "bun:test";
import {
  buildFeedProjectionSignature,
  FEED_PROJECTION_MAX_AGENT_TIMELINE_ITEMS,
  FEED_PROJECTION_MAX_MAIN_TIMELINE_ITEMS,
  FEED_PROJECTION_MAX_TEXT_CHARS,
  filterFeedProjectionAfterSequence,
  filterFeedProjectionForClient,
  maxFeedProjectionTimelineSequence,
  trimProjectionForFeed,
} from "../src/main/thread-run-projection-feed";
import type { ThreadRunProjectionSnapshot } from "../src/shared/ipc";

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

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
  expect(trimmed.agents[0]?.timeline[0]?.text).toHaveLength(FEED_PROJECTION_MAX_TEXT_CHARS);
  expect(trimmed.agents[0]?.timeline[0]?.metadata?.textTruncated).toBe(true);
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

test("trimProjectionForFeed bounds main timeline history", () => {
  const items = Array.from({ length: FEED_PROJECTION_MAX_MAIN_TIMELINE_ITEMS + 50 }, (_, index) => ({
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

  expect(trimmed.timeline).toHaveLength(FEED_PROJECTION_MAX_MAIN_TIMELINE_ITEMS);
  expect(trimmed.timeline[0]?.id).toBe("evt_50");
  expect(trimmed.timeline.at(-1)?.id).toBe(`evt_${items.length - 1}`);
});

test("filterFeedProjectionAfterSequence keeps only uncached main and subagent timeline items", () => {
  const baseProjection = createProjection("short message", { longDelegation: false });
  const projection = trimProjectionForFeed({
    ...baseProjection,
    agents: [
      {
        ...requireValue(baseProjection.agents[0], "base agent"),
        timeline: [
          {
            id: "agent_evt_4",
            sequence: 4,
            eventType: "message.final",
            scope: "agent",
            text: "agent four",
            at: "2026-01-01T00:00:03.000Z",
          },
        ],
      },
    ],
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
  expect(filtered.timeline.map((item) => item.id)).toEqual(["evt_2", "evt_3"]);
  expect(filtered.agents[0]?.timeline.map((item) => item.id)).toEqual(["agent_evt_4"]);
  expect(maxFeedProjectionTimelineSequence(projection)).toBe(4);
});

test("filterFeedProjectionAfterSequence does not resend an acknowledged mutable delta", () => {
  const projection = createProjection("streaming", { longDelegation: false });
  projection.timeline[0] = {
    ...requireValue(projection.timeline[0], "streaming timeline item"),
    eventType: "message.delta",
    streamKey: "stream_1",
  };

  expect(filterFeedProjectionAfterSequence(projection, 1).timeline).toHaveLength(0);
});

test("filterFeedProjectionForClient returns the current feed after a history revision change", () => {
  const projection = {
    ...createProjection("current history", { longDelegation: false }),
    historyRevision: 2,
  };

  const filtered = filterFeedProjectionForClient(projection, {
    afterSequence: 100,
    historyRevision: 1,
  });

  expect(filtered.timeline.map((item) => item.id)).toEqual(["evt_main"]);
  expect(filtered.agents[0]?.timeline.map((item) => item.id)).toEqual(["evt_1"]);
});

test("trimProjectionForFeed keeps trimmed agent detail timeline for incremental updates", () => {
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
        ...requireValue(projection.agents[0], "projection agent"),
        timeline: items,
      },
    ],
  });

  expect(trimmed.agents[0]?.timeline).toHaveLength(FEED_PROJECTION_MAX_AGENT_TIMELINE_ITEMS);
  expect(trimmed.agents[0]?.timeline[0]?.id).toBe("agent_evt_30");
  expect(trimmed.agents[0]?.timeline.at(-1)?.id).toBe("agent_evt_149");
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
  expect(trimProjectionForFeed(projection)).toEqual(projection);
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
        ...requireValue(projection.agents[0], "projection agent"),
        status: "active",
        durationMs: 1,
      },
    ],
  };
  const changed = {
    ...activeProjection,
    agents: [
      {
        ...requireValue(activeProjection.agents[0], "active projection agent"),
        durationMs: 10_000,
      },
    ],
  };

  expect(buildFeedProjectionSignature(changed)).toBe(buildFeedProjectionSignature(activeProjection));
});

test("buildFeedProjectionSignature ignores projection diagnostics", () => {
  const projection = createProjection("short message", { longDelegation: false });
  const changed: ThreadRunProjectionSnapshot = {
    ...projection,
    diagnostics: [
      {
        code: "orphan_stream_finalize",
        message: "bounded history omitted the start",
        eventId: "event_1001",
        requestId: "request_1",
      },
    ],
  };

  expect(buildFeedProjectionSignature(changed)).toBe(buildFeedProjectionSignature(projection));
});

test("buildFeedProjectionSignature changes when feed-visible content changes", () => {
  const projection = createProjection("short message", { longDelegation: false });
  const projectionAgent = requireValue(projection.agents[0], "projection agent");
  const projectionAgentItem = requireValue(projectionAgent.timeline[0], "projection agent item");
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
          ...requireValue(projection.timeline[0], "projection timeline item"),
          text: "changed message",
        },
      ],
    }),
  ).not.toBe(signature);
  expect(
    buildFeedProjectionSignature({
      ...projection,
      agents: [
        {
          ...projectionAgent,
          timeline: [
            {
              ...projectionAgentItem,
              text: "changed subagent message",
            },
          ],
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
