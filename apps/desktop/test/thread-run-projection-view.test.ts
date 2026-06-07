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
