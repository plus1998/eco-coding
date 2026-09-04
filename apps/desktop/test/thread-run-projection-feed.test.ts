import { expect, test } from "bun:test";
import {
  buildFeedProjectionSignature,
  FEED_PROJECTION_MAX_AGENT_TIMELINE_ITEMS,
  FEED_PROJECTION_MAX_MAIN_TIMELINE_ITEMS,
  FEED_PROJECTION_MAX_TEXT_CHARS,
  FEED_STREAMING_PREVIEW_MAX_CHARS,
  filterFeedProjectionAfterSequence,
  filterFeedProjectionForClient,
  maxFeedProjectionTimelineSequence,
  trimProjectionForFeed,
  trimProjectionForRemoteWire,
} from "../src/main/thread-run-projection-feed";
import type { ThreadRunProjectionSnapshot } from "../src/shared/ipc";
import { projectThreadRunToolMetadataForFeed } from "../src/shared/thread-run-tool-projection";

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function runningAttempt(): ThreadRunProjectionSnapshot["attempts"][number] {
  return {
    attemptId: "att_run",
    phase: "run",
    retryIndex: 0,
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
  };
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

test("trimProjectionForFeed preserves complete narrative output", () => {
  const longText = "a".repeat(FEED_PROJECTION_MAX_TEXT_CHARS + 50);
  const trimmed = trimProjectionForFeed(createProjection(longText));

  expect(trimmed.timeline[0]?.text).toBe(longText);
  expect(trimmed.timeline[0]?.metadata?.textTruncated).toBeUndefined();
  expect(trimmed.agents[0]?.timeline).toEqual([]);
  expect(trimmed.agents[0]?.delegationPrompt).toHaveLength(2_000);
});

test("trimProjectionForFeed preserves complete narrative streaming deltas", () => {
  const longText = "b".repeat(FEED_PROJECTION_MAX_TEXT_CHARS + 50);
  const projection: ThreadRunProjectionSnapshot = {
    thread: {
      threadId: "thr_1",
      status: "running",
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    attempts: [runningAttempt()],
    agents: [],
    requestSpans: [],
    timeline: [
      {
        id: "message_delta",
        sequence: 1,
        eventType: "message.delta",
        scope: "main",
        text: longText,
        at: "2026-01-01T00:00:00.000Z",
        runAttemptId: "att_run",
      },
    ],
    diagnostics: [],
    sourceEventCount: 1,
  };

  const trimmed = trimProjectionForFeed(projection);
  expect(trimmed.timeline[0]?.text).toBe(longText);
  expect(trimmed.timeline[0]?.metadata?.textTruncated).toBeUndefined();
});

test("trimProjectionForRemoteWire collapses streaming deltas and strips heavy fields", () => {
  const longDelta = "d".repeat(FEED_STREAMING_PREVIEW_MAX_CHARS + 80);
  const projection: ThreadRunProjectionSnapshot = {
    thread: {
      threadId: "thr_1",
      status: "running",
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    attempts: [{ attemptId: "a1", phase: "execution", retryIndex: 0, status: "running", startedAt: "t" }],
    agents: [],
    requestSpans: [
      {
        requestId: "r1",
        status: "streaming",
        startedAt: "t",
      },
    ],
    timeline: [
      {
        id: "d1",
        sequence: 1,
        eventType: "message.delta",
        scope: "main",
        streamKey: "msg",
        text: "old",
        at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "d2",
        sequence: 2,
        eventType: "message.delta",
        scope: "main",
        streamKey: "msg",
        text: longDelta,
        at: "2026-01-01T00:00:01.000Z",
      },
      {
        id: "tool",
        sequence: 3,
        eventType: "tool.result",
        scope: "main",
        text: "ok",
        at: "2026-01-01T00:00:02.000Z",
      },
    ],
    diagnostics: [{ code: "request_span_left_open", message: "x" }],
    sourceEventCount: 3,
  };

  const wire = trimProjectionForRemoteWire(projection, { streaming: true });
  expect(wire.requestSpans).toEqual([]);
  expect(wire.diagnostics).toEqual([]);
  expect(wire.timeline).toHaveLength(2);
  expect(wire.timeline.find((item) => item.eventType === "message.delta")?.text).toHaveLength(
    FEED_STREAMING_PREVIEW_MAX_CHARS,
  );
  expect(wire.timeline.find((item) => item.eventType === "message.delta")?.metadata?.textTruncated).toBe(
    true,
  );
  expect(wire.timeline.find((item) => item.id === "tool")).toBeTruthy();
  expect(wire.attempts).toHaveLength(1);
});

test("trimProjectionForFeed keeps a long thinking skeleton and marks deferred content", () => {
  const longText = "c".repeat(FEED_PROJECTION_MAX_TEXT_CHARS + 50);
  const projection = createProjection("short", { longDelegation: false });
  projection.attempts = [runningAttempt()];
  projection.timeline = [
    {
      id: "thinking_delta",
      sequence: 1,
      eventType: "thinking.delta",
      scope: "main",
      text: longText,
      at: "2026-01-01T00:00:00.000Z",
      runAttemptId: "att_run",
    },
  ];

  const trimmed = trimProjectionForFeed(projection);
  expect(trimmed.timeline[0]?.text).toHaveLength(FEED_PROJECTION_MAX_TEXT_CHARS);
  expect(trimmed.timeline[0]?.summary).toHaveLength(FEED_PROJECTION_MAX_TEXT_CHARS);
  expect(trimmed.timeline[0]?.contentAvailable).toBe(true);
  expect(trimmed.timeline[0]?.contentLoaded).toBe(false);
  expect(trimmed.timeline[0]?.metadata?.textTruncated).toBe(true);
});

test("trimProjectionForFeed keeps the full skeleton instead of paging the main timeline", () => {
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

  expect(trimmed.timeline).toHaveLength(1);
  expect(trimmed.timeline[0]?.id).toBe(`evt_${items.length - 1}`);
  expect(trimmed.hasEarlier).toBeUndefined();
});

test("trimProjectionForFeed never pages the main Feed with hasEarlier", () => {
  const trimmed = trimProjectionForFeed({
    ...createProjection("short", { longDelegation: false }),
    hasEarlier: true,
  });
  expect(trimmed.hasEarlier).toBeUndefined();
});

test("filterFeedProjectionAfterSequence keeps only uncached main and subagent timeline items", () => {
  const baseProjection = createProjection("short message", { longDelegation: false });
  const projection = {
    ...baseProjection,
    agents: [
      {
        ...requireValue(baseProjection.agents[0], "base agent"),
        timeline: [
          {
            id: "agent_evt_4",
            sequence: 4,
            eventType: "message.final" as const,
            scope: "agent" as const,
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
        eventType: "message.final" as const,
        scope: "main" as const,
        text: "one",
        at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "evt_2",
        sequence: 2,
        eventType: "message.final" as const,
        scope: "main" as const,
        text: "two",
        at: "2026-01-01T00:00:01.000Z",
      },
      {
        id: "evt_3",
        sequence: 3,
        eventType: "message.final" as const,
        scope: "main" as const,
        text: "three",
        at: "2026-01-01T00:00:02.000Z",
      },
    ],
  };

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

test("trimProjectionForFeed clears agent process timelines on the Feed skeleton", () => {
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
        latestActivity: "agent done",
        timeline: items,
      },
    ],
  });

  expect(trimmed.agents[0]?.timeline).toEqual([]);
  expect(trimmed.agents[0]?.latestActivity).toBe("agent done");
  expect(trimmed.timeline[0]?.text).toBe("short message");
});

test("trimProjectionForFeed keeps a live agent timeline tail on the Feed skeleton", () => {
  const items = Array.from({ length: 150 }, (_, index) => ({
    id: `agent_evt_${index}`,
    sequence: index + 1,
    eventType: "thinking.delta" as const,
    scope: "agent" as const,
    text: `line ${index}`,
    at: "2026-01-01T00:00:00.000Z",
  }));
  const projection = createProjection("short message", { longDelegation: false });
  const trimmed = trimProjectionForFeed({
    ...projection,
    thread: {
      ...projection.thread,
      status: "running",
    },
    agents: [
      {
        ...requireValue(projection.agents[0], "projection agent"),
        status: "active",
        latestActivity: "line 149",
        timeline: items,
      },
    ],
  });

  expect(trimmed.agents[0]?.timeline).toHaveLength(FEED_PROJECTION_MAX_AGENT_TIMELINE_ITEMS);
  expect(trimmed.agents[0]?.timeline[0]?.id).toBe("agent_evt_70");
  expect(trimmed.agents[0]?.timeline.at(-1)?.id).toBe("agent_evt_149");
  expect(trimmed.agents[0]?.latestActivity).toBe("line 149");
});

test("trimProjectionForFeed strips tool detail metadata from a live running turn", () => {
  const projection = createProjection("short message", { longDelegation: false });
  const trimmed = trimProjectionForFeed({
    ...projection,
    attempts: [
      {
        attemptId: "att_run",
        phase: "run",
        retryIndex: 0,
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    timeline: [
      {
        id: "tool_1",
        sequence: 1,
        eventType: "tool.completed",
        scope: "main",
        text: "Tool: Bash · bun test",
        at: "2026-01-01T00:00:00.000Z",
        runAttemptId: "att_run",
        metadata: {
          tool: {
            name: "Bash",
            detail: "bun test",
            toolUseId: "toolu_1",
            description: "Run tests",
            status: "completed",
            durationMs: 1200,
            outputPreview: "x".repeat(8_000),
            outputPreviewTruncated: true,
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

test("live feed tool projection never exposes bash output preview", () => {
  expect(
    projectThreadRunToolMetadataForFeed({
      name: "Bash",
      detail: "bun test",
      outputPreview: "secret output",
      outputPreviewTruncated: true,
      status: "completed",
    }),
  ).toEqual({ name: "Bash", detail: "bun test", status: "completed" });
});

test("trimProjectionForFeed keeps imageView path for Eco view_image on a live running turn", () => {
  const projection = createProjection("short message", { longDelegation: false });
  const trimmed = trimProjectionForFeed({
    ...projection,
    attempts: [
      {
        attemptId: "att_run",
        phase: "run",
        retryIndex: 0,
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    timeline: [
      {
        id: "tool_image_view",
        sequence: 1,
        eventType: "tool.completed",
        scope: "main",
        text: "Tool: mcp__eco_image_view__view_image · /tmp/shot.png",
        at: "2026-01-01T00:00:00.000Z",
        runAttemptId: "att_run",
        metadata: {
          tool: {
            name: "mcp__eco_image_view__view_image",
            detail: "/tmp/shot.png",
            toolUseId: "toolu_image",
            status: "completed",
            imageView: { path: "/tmp/shot.png" },
          },
        },
      },
    ],
  });

  expect(trimmed.timeline[0]?.metadata?.tool).toEqual({
    name: "mcp__eco_image_view__view_image",
    detail: "/tmp/shot.png",
    toolUseId: "toolu_image",
    status: "completed",
    imageView: { path: "/tmp/shot.png" },
  });
});

test("live feed tool projection keeps imageView path for Eco view_image", () => {
  expect(
    projectThreadRunToolMetadataForFeed({
      name: "mcp__eco_image_view__view_image",
      detail: "/tmp/shot.png",
      status: "completed",
      imageView: { path: "/tmp/shot.png" },
    }),
  ).toEqual({
    name: "mcp__eco_image_view__view_image",
    detail: "/tmp/shot.png",
    status: "completed",
    imageView: { path: "/tmp/shot.png" },
  });
});

test("live feed tool projection keeps imageDisplay artifact for Eco display_image", () => {
  expect(
    projectThreadRunToolMetadataForFeed({
      name: "mcp__eco_image_display__display_image",
      detail: "art-feed-1",
      status: "completed",
      imageDisplay: { artifactId: "art-feed-1", title: "示例图" },
    }),
  ).toEqual({
    name: "mcp__eco_image_display__display_image",
    detail: "art-feed-1",
    status: "completed",
    imageDisplay: { artifactId: "art-feed-1", title: "示例图" },
  });
});

test("live feed tool projection keeps htmlHost page for Eco publish_html", () => {
  expect(
    projectThreadRunToolMetadataForFeed({
      name: "mcp__eco_html_host__publish_html",
      detail: "https://example.supabase.co/functions/v1/html-page-view/slug",
      status: "completed",
      htmlHost: {
        pageId: "page-1",
        publicUrl: "https://example.supabase.co/functions/v1/html-page-view/slug",
        title: "CDP冒烟测试",
        expiresAt: "2030-01-01T00:00:00.000Z",
        canExtend: true,
      },
    }),
  ).toEqual({
    name: "mcp__eco_html_host__publish_html",
    detail: "https://example.supabase.co/functions/v1/html-page-view/slug",
    status: "completed",
    htmlHost: {
      pageId: "page-1",
      publicUrl: "https://example.supabase.co/functions/v1/html-page-view/slug",
      title: "CDP冒烟测试",
      expiresAt: "2030-01-01T00:00:00.000Z",
      canExtend: true,
    },
  });
});

test("trimProjectionForFeed keeps imageDisplay artifact for Eco display_image on a live running turn", () => {
  const projection = createProjection("short message", { longDelegation: false });
  const trimmed = trimProjectionForFeed({
    ...projection,
    attempts: [
      {
        attemptId: "att_run",
        phase: "run",
        retryIndex: 0,
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    timeline: [
      {
        id: "tool_image_display",
        sequence: 1,
        eventType: "tool.completed",
        scope: "main",
        text: "Tool: mcp__eco_image_display__display_image · art-feed-1",
        at: "2026-01-01T00:00:00.000Z",
        runAttemptId: "att_run",
        metadata: {
          tool: {
            name: "mcp__eco_image_display__display_image",
            detail: "art-feed-1",
            toolUseId: "toolu_display",
            status: "completed",
            imageDisplay: { artifactId: "art-feed-1", title: "示例图" },
          },
        },
      },
    ],
  });

  expect(trimmed.timeline[0]?.metadata?.tool).toEqual({
    name: "mcp__eco_image_display__display_image",
    detail: "art-feed-1",
    toolUseId: "toolu_display",
    status: "completed",
    imageDisplay: { artifactId: "art-feed-1", title: "示例图" },
  });
});

test("trimProjectionForFeed keeps htmlHost page for Eco publish_html on a live running turn", () => {
  const projection = createProjection("short message", { longDelegation: false });
  const trimmed = trimProjectionForFeed({
    ...projection,
    attempts: [
      {
        attemptId: "att_run",
        phase: "run",
        retryIndex: 0,
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    timeline: [
      {
        id: "tool_html_host",
        sequence: 1,
        eventType: "tool.completed",
        scope: "main",
        text: "Tool: mcp__eco_html_host__publish_html · https://example.supabase.co/functions/v1/html-page-view/slug",
        at: "2026-01-01T00:00:00.000Z",
        runAttemptId: "att_run",
        metadata: {
          tool: {
            name: "mcp__eco_html_host__publish_html",
            detail: "https://example.supabase.co/functions/v1/html-page-view/slug",
            toolUseId: "toolu_html",
            status: "completed",
            htmlHost: {
              pageId: "page-1",
              publicUrl: "https://example.supabase.co/functions/v1/html-page-view/slug",
              title: "CDP冒烟测试",
              expiresAt: "2030-01-01T00:00:00.000Z",
              canExtend: true,
            },
          },
        },
      },
    ],
  });

  expect(trimmed.timeline[0]?.metadata?.tool).toEqual({
    name: "mcp__eco_html_host__publish_html",
    detail: "https://example.supabase.co/functions/v1/html-page-view/slug",
    toolUseId: "toolu_html",
    status: "completed",
    htmlHost: {
      pageId: "page-1",
      publicUrl: "https://example.supabase.co/functions/v1/html-page-view/slug",
      title: "CDP冒烟测试",
      expiresAt: "2030-01-01T00:00:00.000Z",
      canExtend: true,
    },
  });
});

test("trimProjectionForFeed keeps PI mcp discovery metadata on a live running turn", () => {
  const projection = createProjection("short message", { longDelegation: false });
  const trimmed = trimProjectionForFeed({
    ...projection,
    attempts: [runningAttempt()],
    timeline: [
      {
        id: "tool_mcp_search",
        sequence: 1,
        eventType: "tool.completed",
        scope: "main",
        text: "Tool: mcp",
        at: "2026-01-01T00:00:00.000Z",
        runAttemptId: "att_run",
        metadata: {
          tool: {
            name: "mcp",
            toolUseId: "toolu_mcp_search",
            status: "completed",
            mcpDiscovery: { kind: "search" },
          },
        },
      },
    ],
  });

  expect(trimmed.timeline[0]?.metadata?.tool).toEqual({
    name: "mcp",
    toolUseId: "toolu_mcp_search",
    status: "completed",
    mcpDiscovery: { kind: "search" },
  });
});

test("trimProjectionForFeed leaves a short main skeleton and clears agent process timelines", () => {
  const projection = createProjection("short message", { longDelegation: false });
  expect(trimProjectionForFeed(projection)).toEqual({
    ...projection,
    agents: [
      {
        ...requireValue(projection.agents[0], "base agent"),
        timeline: [],
      },
    ],
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
          latestActivity: "changed subagent activity",
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

test("trimProjectionForRemoteWire reduces JSON payload size under streaming load", () => {
  const longDelta = "x".repeat(8_000);
  const projection: ThreadRunProjectionSnapshot = {
    thread: {
      threadId: "thr_1",
      status: "running",
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    attempts: [],
    agents: [],
    requestSpans: Array.from({ length: 8 }, (_, i) => ({
      requestId: `r${i}`,
      status: "streaming" as const,
      startedAt: "t",
    })),
    timeline: Array.from({ length: 12 }, (_, i) => ({
      id: "same_stream",
      sequence: i + 1,
      eventType: "message.delta" as const,
      scope: "main" as const,
      streamKey: "msg",
      text: longDelta.slice(0, 500 + i * 500),
      at: "2026-01-01T00:00:00.000Z",
    })),
    diagnostics: [{ code: "request_span_left_open" as const, message: "z".repeat(200) }],
    sourceEventCount: 12,
  };

  const before = JSON.stringify(projection).length;
  const after = JSON.stringify(trimProjectionForRemoteWire(projection, { streaming: true })).length;
  expect(after).toBeLessThan(before * 0.35);
});
