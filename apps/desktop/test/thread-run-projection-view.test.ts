import { expect, test } from "bun:test";
import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../src/shared/ipc";
import {
  buildThreadRunProjectionViewModel,
  isProjectionRequestActive,
  projectionItemToDetailBlock,
} from "../src/renderer/thread-run-projection-view";

function item(input: Partial<ThreadRunProjectionTimelineItem> & { id: string }): ThreadRunProjectionTimelineItem {
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
  );

  expect(view.mainFeedEntries.map((entry) => entry.kind)).toEqual(["timeline", "agent-card", "agent-echo"]);
  const echo = view.mainFeedEntries[2];
  expect(echo?.kind).toBe("agent-echo");
  if (echo?.kind === "agent-echo") {
    expect(echo.item.id).toBe("coder-says");
    expect(echo.agent.agentId).toBe("coder_agent_00000001");
    expect(echo.shortAgentId).toBe("00000001");
    expect(echo.agentLabel).toContain("#00000001");
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

test("buildThreadRunProjectionViewModel hides request placeholder once the same request is streaming", () => {
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

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:thinking-placeholder"]);
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
