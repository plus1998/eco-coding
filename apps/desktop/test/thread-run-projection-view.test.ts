import { expect, test } from "bun:test";
import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../src/shared/ipc";
import {
  buildProjectionDisplayTimelineItems,
  buildThreadRunProjectionViewModel,
  isProjectionRequestActive,
  projectionItemToDetailBlock,
} from "../src/renderer/thread-run-projection-view";

function item(
  input: Partial<ThreadRunProjectionTimelineItem> & { id: string },
): ThreadRunProjectionTimelineItem {
  return {
    id: input.id,
    sequence: input.sequence ?? 1,
    eventType: input.eventType ?? "message.final",
    scope: input.scope ?? "main",
    text: input.text ?? "",
    at: input.at ?? "2026-01-01T00:00:00.000Z",
    ...(input.role && { role: input.role }),
    ...(input.agentId && { agentId: input.agentId }),
    ...(input.requestId && { requestId: input.requestId }),
    ...(input.streamKey && { streamKey: input.streamKey }),
    ...(input.metadata && { metadata: input.metadata }),
  };
}

function agent(input: Partial<ThreadRunProjectionAgent> & { agentId: string }): ThreadRunProjectionAgent {
  return {
    agentId: input.agentId,
    role: input.role ?? "coder",
    kind: input.kind ?? "subagent",
    status: input.status ?? "active",
    startedAt: input.startedAt ?? "2026-01-01T00:00:01.000Z",
    durationMs: input.durationMs ?? 1000,
    timeline: input.timeline ?? [],
    ...(input.latestActivity && { latestActivity: input.latestActivity }),
    ...(input.endedAt && { endedAt: input.endedAt }),
    ...(input.usage && { usage: input.usage }),
    ...(input.context && { context: input.context }),
  };
}

function projection(input: Partial<ThreadRunProjectionSnapshot>): ThreadRunProjectionSnapshot {
  return {
    thread: {
      threadId: "thr_view",
      status: "running",
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    attempts: [],
    agents: [],
    requestSpans: [],
    timeline: [],
    diagnostics: [],
    sourceEventCount: 1,
    ...input,
  };
}

test("buildThreadRunProjectionViewModel keys subagent cards by agentId", () => {
  const firstTimeline = [item({ id: "a-msg", scope: "agent", role: "coder", agentId: "coder_a" })];
  const secondTimeline = [item({ id: "b-msg", scope: "agent", role: "coder", agentId: "coder_b" })];
  const view = buildThreadRunProjectionViewModel(
    projection({
      agents: [
        agent({ agentId: "coder_a", role: "coder", timeline: firstTimeline, latestActivity: "Read API" }),
        agent({ agentId: "coder_b", role: "coder", timeline: secondTimeline, latestActivity: "Edit UI" }),
      ],
      timeline: [
        item({
          id: "prompt",
          eventType: "thread.status",
          role: "user",
          text: "实现功能",
          metadata: { liveType: "thread.user_prompt" },
        }),
      ],
    }),
    { id: "thr_view", prompt: "实现功能" },
  );

  expect(view.showThreadPrompt).toBe(false);
  expect(view.subagentCards.map((card) => card.key)).toEqual(["coder_a", "coder_b"]);
  expect(view.subagentCards.map((card) => card.timelineIds)).toEqual([["a-msg"], ["b-msg"]]);
  expect(view.subagentCards.map((card) => card.statusText)).toEqual(["Read API", "Edit UI"]);
});

test("buildThreadRunProjectionViewModel surfaces fixed workflow lifecycle rows", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "workflow-start",
          eventType: "agent.started",
          text: "固定编排步骤开始：research",
          role: "planner",
        }),
        item({
          id: "normal-agent-start",
          eventType: "agent.started",
          text: "Agent session started.",
          role: "planner",
          sequence: 2,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:workflow-start"]);
  const entry = view.mainFeedEntries[0];
  expect(entry?.kind).toBe("timeline");
  if (entry?.kind === "timeline") {
    expect(projectionItemToDetailBlock(entry.item)).toEqual({
      kind: "phase",
      label: "固定编排步骤开始：research",
    });
  }
});

test("buildThreadRunProjectionViewModel echoes agent narrative in main feed while preserving agent card details", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "main-thinking",
          eventType: "thinking.final",
          role: "thinking",
          text: "先分析结构",
          at: "2026-01-01T00:00:01.000Z",
        }),
      ],
      agents: [
        agent({
          agentId: "coder_agent_00000001",
          role: "coder",
          timeline: [
            item({
              id: "coder-says",
              eventType: "message.final",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "我在检查渲染路径。",
              at: "2026-01-01T00:00:02.000Z",
              sequence: 2,
            }),
          ],
        }),
      ],
    }),
    undefined,
    { agentDisplayNames: { coder: "Implementation Agent" } },
  );

  expect(view.mainFeedEntries.map((entry) => entry.kind)).toEqual(["timeline", "agent-card", "agent-echo"]);
  const echo = view.mainFeedEntries[2];
  expect(echo?.kind).toBe("agent-echo");
  if (echo?.kind === "agent-echo") {
    expect(echo.item.id).toBe("coder-says");
    expect(echo.agent.agentId).toBe("coder_agent_00000001");
    expect(echo.shortAgentId).toBe("00000001");
    expect(echo.agentLabel).toBe("Implementation Agent #00000001");
  }
  const card = view.mainFeedEntries[1];
  expect(card?.kind).toBe("agent-card");
  if (card?.kind === "agent-card") {
    expect(card.card.statusText).toBe("我在检查渲染路径。");
  }
  expect(view.subagentCards[0]?.timelineIds).toEqual(["coder-says"]);
});

test("buildThreadRunProjectionViewModel keeps concurrent same-role agent echoes distinct", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      agents: [
        agent({
          agentId: "coder_agent_00000001",
          role: "coder",
          timeline: [
            item({
              id: "coder-a-msg",
              eventType: "message.final",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "我处理 API。",
              at: "2026-01-01T00:00:01.000Z",
              sequence: 1,
            }),
          ],
        }),
        agent({
          agentId: "coder_agent_00000002",
          role: "coder",
          timeline: [
            item({
              id: "coder-b-msg",
              eventType: "message.final",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000002",
              text: "我处理 UI。",
              at: "2026-01-01T00:00:02.000Z",
              sequence: 2,
            }),
          ],
        }),
      ],
    }),
  );

  const echoes = view.mainFeedEntries.filter((entry) => entry.kind === "agent-echo");
  expect(echoes.map((entry) => entry.agent.agentId)).toEqual([
    "coder_agent_00000001",
    "coder_agent_00000002",
  ]);
  expect(echoes.map((entry) => entry.shortAgentId)).toEqual(["00000001", "00000002"]);
});

test("buildThreadRunProjectionViewModel interleaves planner and agent speech by time", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "planner-first",
          eventType: "thinking.final",
          role: "thinking",
          text: "先看代码。",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "planner-last",
          eventType: "message.final",
          role: "planner",
          text: "我总结一下。",
          at: "2026-01-01T00:00:03.000Z",
          sequence: 3,
        }),
      ],
      agents: [
        agent({
          agentId: "coder_agent_00000001",
          role: "coder",
          timeline: [
            item({
              id: "coder-middle",
              eventType: "message.final",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "我找到问题了。",
              at: "2026-01-01T00:00:02.000Z",
              sequence: 2,
            }),
          ],
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual([
    "main:planner-first",
    "agent-card:coder_agent_00000001",
    "agent:coder_agent_00000001:coder-middle",
    "main:planner-last",
  ]);
});

test("buildThreadRunProjectionViewModel does not echo request or lifecycle noise", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [item({ id: "main", role: "planner", text: "Working" })],
      agents: [
        agent({
          agentId: "coder_agent_00000001",
          role: "coder",
          timeline: [
            item({
              id: "agent-start",
              eventType: "agent.started",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "Subagent coder started",
              sequence: 1,
            }),
            item({
              id: "request-start",
              eventType: "request.started",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "Requesting model",
              sequence: 2,
            }),
          ],
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual([
    "main:main",
    "agent-card:coder_agent_00000001",
  ]);
  expect(view.mainFeedEntries.some((entry) => entry.kind === "agent-echo")).toBe(false);
});

test("buildThreadRunProjectionViewModel removes main feed status and usage noise", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "prompt",
          eventType: "thread.status",
          role: "user",
          text: "使用子代理查询天气",
          metadata: { liveType: "thread.user_prompt" },
          sequence: 1,
        }),
        item({
          id: "agent-lifecycle",
          eventType: "agent.started",
          role: "planner",
          text: "Requesting model…",
          sequence: 2,
        }),
        item({
          id: "usage",
          eventType: "thread.status",
          role: "planner",
          text: "↑23k ↓404",
          sequence: 3,
        }),
        item({
          id: "status-updated",
          eventType: "thread.status",
          role: "system",
          text: "状态已更新",
          sequence: 4,
        }),
        item({
          id: "router-ready",
          eventType: "thread.status",
          role: "system",
          text: "Local model router ready: http://127.0.0.1:24643",
          sequence: 5,
        }),
        item({
          id: "worktree-merge",
          eventType: "message.final",
          role: "system",
          text: '__eco_worktree_merge__\n{"fileCount":1}',
          sequence: 6,
        }),
        item({
          id: "substantive",
          eventType: "message.final",
          role: "planner",
          text: "天气查询完成。",
          sequence: 7,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:prompt", "main:substantive"]);
});

test("buildThreadRunProjectionViewModel keeps pre-speech current action on the agent card", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      agents: [
        agent({
          agentId: "coder_agent_00000001",
          role: "coder",
          status: "active",
          timeline: [
            item({
              id: "tool-read",
              eventType: "tool.started",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "Tool: Read · ActivityLogView.tsx",
              sequence: 1,
            }),
          ],
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries).toHaveLength(1);
  const entry = view.mainFeedEntries[0];
  expect(entry?.kind).toBe("agent-card");
  if (entry?.kind === "agent-card") {
    expect(entry.card.statusText).toBe("Read · ActivityLogView.tsx");
    expect(entry.card.agent.agentId).toBe("coder_agent_00000001");
  }
});

test("buildThreadRunProjectionViewModel removes completed agent request placeholders from cards", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_coder",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:05.000Z",
          ownerAgentId: "coder_done",
          role: "coder",
        },
      ],
      agents: [
        agent({
          agentId: "coder_done",
          role: "coder",
          status: "stopped",
          endedAt: "2026-01-01T00:00:05.000Z",
          timeline: [
            item({
              id: "request-start",
              eventType: "request.started",
              scope: "agent",
              role: "coder",
              agentId: "coder_done",
              requestId: "req_coder",
              at: "2026-01-01T00:00:01.000Z",
              sequence: 1,
            }),
            item({
              id: "tool",
              eventType: "tool.started",
              scope: "agent",
              role: "coder",
              agentId: "coder_done",
              text: "Tool: Bash · git diff",
              at: "2026-01-01T00:00:03.000Z",
              sequence: 2,
            }),
          ],
        }),
      ],
    }),
  );

  expect(view.subagentCards[0]?.timelineIds).toEqual(["tool"]);
});

test("buildThreadRunProjectionViewModel ignores empty streaming agent placeholders", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      agents: [
        agent({
          agentId: "coder_agent_00000001",
          role: "coder",
          status: "active",
          timeline: [
            item({
              id: "empty-delta",
              eventType: "message.delta",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "",
              sequence: 1,
            }),
          ],
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.kind)).toEqual(["agent-card"]);
  expect(view.mainFeedEntries.some((entry) => entry.kind === "agent-echo")).toBe(false);
});

test("buildThreadRunProjectionViewModel treats legacy todo updates as tool state not speech", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      agents: [
        agent({
          agentId: "explore_agent_00000001",
          role: "explore",
          status: "stopped",
          timeline: [
            item({
              id: "todo-webfetch",
              eventType: "message.final",
              scope: "agent",
              role: "explore",
              agentId: "explore_agent_00000001",
              text: "Tool: WebFetch · https://weather.example",
              metadata: { liveType: "todo.updated" },
              sequence: 1,
            }),
          ],
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.kind)).toEqual(["agent-card"]);
  expect(view.mainFeedEntries.some((entry) => entry.kind === "agent-echo")).toBe(false);
  expect(view.subagentCards[0]?.statusText).toBe("WebFetch · https://weather.example");
  expect(projectionItemToDetailBlock(view.subagentCards[0]!.agent.timeline[0]!)).toMatchObject({
    kind: "action",
    label: "WebFetch · https://weather.example",
  });
});

test("buildThreadRunProjectionViewModel hides empty streaming placeholder without losing request state", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "request-start",
          eventType: "request.started",
          role: "planner",
          requestId: "req_planner",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "thinking-placeholder",
          eventType: "thinking.delta",
          role: "thinking",
          requestId: "req_planner",
          text: "",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:request-start"]);
});

test("buildThreadRunProjectionViewModel collapses superseded stream deltas after final output", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "stream:thinking",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          firstTokenAt: "2026-01-01T00:00:02.000Z",
          endedAt: "2026-01-01T00:00:03.000Z",
        },
      ],
      timeline: [
        item({
          id: "thinking-placeholder",
          eventType: "thinking.delta",
          role: "thinking",
          text: "",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "thinking-delta",
          eventType: "thinking.delta",
          role: "thinking",
          text: "先查天气来源",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
        item({
          id: "thinking-final",
          eventType: "thinking.final",
          role: "thinking",
          text: "先查天气来源",
          at: "2026-01-01T00:00:03.000Z",
          sequence: 3,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:thinking-final"]);
  const entry = view.mainFeedEntries[0];
  expect(entry?.kind).toBe("timeline");
  if (entry?.kind === "timeline") {
    expect(projectionItemToDetailBlock(entry.item)).toMatchObject({
      kind: "thinking",
      streaming: false,
      text: "先查天气来源",
    });
  }
});

test("buildThreadRunProjectionViewModel settles terminal deltas when final event is missing", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "stream:planner",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          firstTokenAt: "2026-01-01T00:00:02.000Z",
          endedAt: "2026-01-01T00:00:03.000Z",
        },
      ],
      timeline: [
        item({
          id: "planner-delta",
          eventType: "message.delta",
          role: "planner",
          text: "天气查询完成。",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
      ],
    }),
  );

  const entry = view.mainFeedEntries[0];
  expect(entry?.kind).toBe("timeline");
  if (entry?.kind === "timeline") {
    expect(entry.item.eventType).toBe("message.final");
    expect(projectionItemToDetailBlock(entry.item)).toMatchObject({
      kind: "narrative",
      streaming: false,
      text: "天气查询完成。",
    });
  }
});

test("buildThreadRunProjectionViewModel hides completed request lifecycle placeholders", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_done",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:02.000Z",
        },
      ],
      timeline: [
        item({
          id: "request-start",
          eventType: "request.started",
          role: "planner",
          requestId: "req_done",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "request-done",
          eventType: "request.completed",
          role: "planner",
          requestId: "req_done",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries).toEqual([]);
});

test("buildThreadRunProjectionViewModel hides request placeholders once owner output appears", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_orphan_started",
          status: "waiting_first_token",
          startedAt: "2026-01-01T00:00:01.000Z",
        },
        {
          requestId: "stream:planner",
          status: "streaming",
          startedAt: "2026-01-01T00:00:01.500Z",
          firstTokenAt: "2026-01-01T00:00:02.000Z",
        },
      ],
      timeline: [
        item({
          id: "request-start",
          eventType: "request.started",
          role: "planner",
          requestId: "req_orphan_started",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "planner-delta",
          eventType: "message.delta",
          role: "planner",
          text: "我会让子代理查询天气。",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:planner-delta"]);
});

test("buildThreadRunProjectionViewModel keeps final main agent text after empty placeholder sharing a streamKey", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "stream:act_weather",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:03.000Z",
        },
      ],
      timeline: [
        item({
          id: "planner-placeholder",
          eventType: "message.delta",
          role: "planner",
          text: "",
          streamKey: "act_weather",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "planner-final",
          eventType: "message.final",
          role: "planner",
          text: "子代理查询结果：广州今天中到大雨。",
          streamKey: "act_weather",
          at: "2026-01-01T00:00:03.000Z",
          sequence: 2,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:planner-final"]);
  const entry = view.mainFeedEntries[0];
  expect(entry?.kind).toBe("timeline");
  if (entry?.kind === "timeline") {
    expect(projectionItemToDetailBlock(entry.item)).toMatchObject({
      kind: "narrative",
      streaming: false,
      text: "子代理查询结果：广州今天中到大雨。",
    });
  }
});

test("buildThreadRunProjectionViewModel hides planner OTel tool duration summaries from main feed", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "otel-websearch-duration",
          eventType: "tool.started",
          role: "planner",
          text: "Tool: WebSearch (5.9s)",
          metadata: { liveType: "otel.activity" },
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries).toEqual([]);
});

test("buildThreadRunProjectionViewModel hides planner OTel agent elapsed summaries from main feed", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "otel-agent-duration",
          eventType: "tool.started",
          role: "planner",
          text: "Tool: Agent · eco_explore (29.6s)",
          metadata: { liveType: "otel.activity" },
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries).toEqual([]);
});

test("buildThreadRunProjectionViewModel collapses agent card stream rows without losing final echo", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "stream:coder_agent_00000001",
          ownerAgentId: "coder_agent_00000001",
          role: "coder",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          firstTokenAt: "2026-01-01T00:00:02.000Z",
          endedAt: "2026-01-01T00:00:03.000Z",
        },
      ],
      agents: [
        agent({
          agentId: "coder_agent_00000001",
          role: "coder",
          status: "stopped",
          timeline: [
            item({
              id: "agent-placeholder",
              eventType: "message.delta",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "",
              at: "2026-01-01T00:00:01.000Z",
              sequence: 1,
            }),
            item({
              id: "agent-final",
              eventType: "message.final",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "广州今天有阵雨。",
              at: "2026-01-01T00:00:03.000Z",
              sequence: 3,
            }),
          ],
        }),
      ],
    }),
  );

  expect(view.subagentCards[0]?.timelineIds).toEqual(["agent-final"]);
  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual([
    "agent-card:coder_agent_00000001",
    "agent:coder_agent_00000001:agent-final",
  ]);
  const echo = view.mainFeedEntries[1];
  expect(echo?.kind).toBe("agent-echo");
  if (echo?.kind === "agent-echo") {
    expect(projectionItemToDetailBlock(echo.item)).toMatchObject({
      kind: "narrative",
      streaming: false,
      text: "广州今天有阵雨。",
    });
  }
});

test("buildProjectionDisplayTimelineItems keeps only the latest in-flight delta per stream", () => {
  const rows = buildProjectionDisplayTimelineItems(
    [
      item({
        id: "delta-1",
        eventType: "message.delta",
        role: "planner",
        text: "A",
        at: "2026-01-01T00:00:01.000Z",
        sequence: 1,
      }),
      item({
        id: "delta-2",
        eventType: "message.delta",
        role: "planner",
        text: "AB",
        at: "2026-01-01T00:00:02.000Z",
        sequence: 2,
      }),
    ],
    new Map([
      [
        "stream:planner",
        {
          requestId: "stream:planner",
          status: "streaming",
          startedAt: "2026-01-01T00:00:01.000Z",
          firstTokenAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    ]),
  );

  expect(rows.map((row) => row.id)).toEqual(["delta-2"]);
  expect(rows[0]?.eventType).toBe("message.delta");
});

test("buildProjectionDisplayTimelineItems collapses duplicate tool rows by toolUseId", () => {
  const rows = buildProjectionDisplayTimelineItems(
    [
      item({
        id: "tool-start",
        eventType: "tool.started",
        text: "Tool: mcp__eco_plan__finalize_plan",
        sequence: 1,
        metadata: {
          tool: {
            name: "mcp__eco_plan__finalize_plan",
            toolUseId: "toolu_plan",
          },
        },
      }),
      item({
        id: "tool-input-complete",
        eventType: "tool.started",
        text: "Tool: mcp__eco_plan__finalize_plan",
        sequence: 2,
        metadata: {
          tool: {
            name: "mcp__eco_plan__finalize_plan",
            detail: "提交计划",
            toolUseId: "toolu_plan",
          },
        },
      }),
    ],
    new Map(),
  );

  expect(rows.map((row) => row.id)).toEqual(["tool-input-complete"]);
});

test("buildThreadRunProjectionViewModel collapses superseded context compaction started states", () => {
  const running = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "compact-start-1",
          eventType: "context.compaction.started",
          text: "正在自动压缩上下文",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "compact-start-2",
          eventType: "context.compaction.started",
          text: "正在自动压缩上下文",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
      ],
    }),
  );
  expect(running.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:compact-start-2"]);

  const completed = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "compact-start",
          eventType: "context.compaction.started",
          text: "正在自动压缩上下文",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "compact-done",
          eventType: "context.compaction.completed",
          text: "上下文已自动压缩",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
      ],
    }),
  );

  expect(completed.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:compact-done"]);
  const detail = projectionItemToDetailBlock(
    item({
      id: "compact-done",
      eventType: "context.compaction.completed",
      text: "上下文已自动压缩",
    }),
  );
  expect(detail).toEqual({ kind: "phase", label: "上下文已自动压缩" });
});

test("buildThreadRunProjectionViewModel requests legacy prompt only when projection lacks user prompt", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [item({ id: "main", role: "planner", text: "Working" })],
    }),
    { id: "thr_view", prompt: "原始需求" },
  );

  expect(view.showThreadPrompt).toBe(true);
  expect(view.mainItemIds).toEqual(["main"]);
});

test("projectionItemToDetailBlock maps API errors and request ownership", () => {
  const apiError = projectionItemToDetailBlock(
    item({
      id: "api-error",
      eventType: "api.error",
      scope: "both",
      role: "coder",
      agentId: "coder_a",
      text: "HTTP 502",
      metadata: { apiError: { statusCode: 502, code: "bad_gateway", message: "Bad gateway" } },
    }),
  );
  const agentRequest = projectionItemToDetailBlock(
    item({
      id: "agent-request",
      eventType: "request.started",
      scope: "agent",
      role: "coder",
      agentId: "coder_a",
      requestId: "req_agent",
    }),
  );
  const mainRequest = projectionItemToDetailBlock(
    item({
      id: "main-request",
      eventType: "request.started",
      scope: "main",
      role: "planner",
      requestId: "req_main",
    }),
  );

  expect(apiError).toMatchObject({
    kind: "api-error",
    message: "Bad gateway",
    statusCode: 502,
    code: "bad_gateway",
    subagent: "coder",
    agentId: "coder_a",
  });
  expect(agentRequest).toMatchObject({ kind: "agent-request", subagent: "coder", agentId: "coder_a" });
  expect(mainRequest).toMatchObject({ kind: "model-request", role: "planner" });
});

test("projectionItemToDetailBlock prefers structured tool metadata", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "otel-webfetch",
      eventType: "tool.completed",
      scope: "agent",
      role: "explore",
      agentId: "agent_weather",
      text: "Tool: WebFetch",
      metadata: {
        liveType: "otel.activity",
        tool: {
          name: "WebFetch",
          detail: "https://weather.example/guangzhou",
          toolUseId: "toolu_fetch_1",
          durationMs: 8300,
        },
      },
    }),
  );

  expect(detail).toEqual({
    kind: "action",
    icon: "agent",
    label: "WebFetch · https://weather.example/guangzhou (8.3s)",
    subagent: "explore",
    agentId: "agent_weather",
  });
});

test("projectionItemToDetailBlock formats MCP tool metadata", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "plan-tool",
      eventType: "tool.started",
      scope: "main",
      role: "planner",
      text: "Tool: mcp__eco_plan__finalize_plan",
      metadata: {
        liveType: "tool.started",
        tool: {
          name: "mcp__eco_plan__finalize_plan",
          toolUseId: "toolu_plan",
        },
      },
    }),
  );

  expect(detail).toMatchObject({
    kind: "action",
    label: "提交计划",
  });

  const wrapper = projectionItemToDetailBlock(
    item({
      id: "plan-wrapper",
      eventType: "tool.completed",
      scope: "main",
      role: "planner",
      text: "Tool: mcp_tool · mcp__eco_plan__finalize_plan (0.0s)",
      metadata: {
        liveType: "otel.activity",
        tool: {
          name: "mcp_tool",
          detail: "mcp__eco_plan__finalize_plan",
          durationMs: 0,
        },
      },
    }),
  );

  expect(wrapper).toMatchObject({
    kind: "action",
    label: "提交计划 (0.0s)",
  });
});

test("projectionItemToDetailBlock treats structured todo metadata as tool action", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "todo-webfetch",
      eventType: "tool.started",
      scope: "agent",
      role: "explore",
      agentId: "agent_weather",
      text: "https://weather.example/guangzhou",
      metadata: {
        liveType: "todo.updated",
        tool: {
          name: "WebFetch",
          detail: "https://weather.example/guangzhou",
        },
      },
    }),
  );

  expect(detail).toEqual({
    kind: "action",
    icon: "agent",
    label: "WebFetch · https://weather.example/guangzhou",
    subagent: "explore",
    agentId: "agent_weather",
  });
});

test("isProjectionRequestActive follows request span status", () => {
  expect(
    isProjectionRequestActive({
      requestId: "req_waiting",
      status: "waiting_first_token",
      startedAt: "2026-01-01T00:00:00.000Z",
    }),
  ).toBe(true);
  expect(
    isProjectionRequestActive({
      requestId: "req_streaming",
      status: "streaming",
      startedAt: "2026-01-01T00:00:00.000Z",
    }),
  ).toBe(true);
  expect(
    isProjectionRequestActive({
      requestId: "req_done",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
    }),
  ).toBe(false);
});
