import { expect, test } from "bun:test";
import {
  buildSubagentLifecycleRunEvent,
  buildThreadRunEventFromLiveEvent,
} from "../src/main/thread-run-event-normalizer";

test("buildThreadRunEventFromLiveEvent scopes subagent streams by agent id", () => {
  const event = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "act_1",
    liveType: "message.delta",
    role: "coder",
    agentId: "agent_coder_a",
    stream: true,
    message: "Reading package.json",
    runAttemptId: "attempt_1",
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(event).toMatchObject({
    id: "tre:act_1",
    threadId: "thr_1",
    eventType: "message.delta",
    scope: "agent",
    agentId: "agent_coder_a",
    streamState: "streaming",
    runAttemptId: "attempt_1",
  });
});

test("buildThreadRunEventFromLiveEvent keeps api errors visible in main and agent scopes", () => {
  const event = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "act_error",
    liveType: "thread.api_error",
    role: "coder",
    agentId: "agent_coder_a",
    stream: false,
    message: "HTTP 502",
    apiError: { statusCode: 502, message: "Bad Gateway" },
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(event?.eventType).toBe("api.error");
  expect(event?.scope).toBe("both");
  expect(event?.requestId).toBe("req:thr_1:act_error");
  expect(event?.metadata?.apiError).toEqual({ statusCode: 502, message: "Bad Gateway" });
});

test("buildThreadRunEventFromLiveEvent maps empty streaming chunks to placeholders", () => {
  const event = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "act_empty",
    liveType: "message.delta",
    role: "thinking",
    stream: true,
    message: "",
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(event?.eventType).toBe("thinking.delta");
  expect(event?.scope).toBe("main");
  expect(event?.streamState).toBe("placeholder");
});

test("buildThreadRunEventFromLiveEvent keeps stable streamKey separate from unique event id", () => {
  const event = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "act_line:live_2",
    liveType: "message.delta",
    role: "planner",
    stream: false,
    message: "子代理查询结果：广州今天中到大雨。",
    streamKey: "act_line",
    observedAt: "2026-01-01T00:00:01.000Z",
  });

  expect(event).toMatchObject({
    id: "tre:act_line:live_2",
    eventType: "message.final",
    scope: "main",
    streamState: "finalized",
    streamKey: "act_line",
    message: "子代理查询结果：广州今天中到大雨。",
  });
});

test("buildThreadRunEventFromLiveEvent keeps todo updates out of narrative messages", () => {
  const toolEvent = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "todo_tool",
    liveType: "todo.updated",
    role: "explore",
    agentId: "agent_explore_a",
    stream: false,
    message: "Tool: WebFetch · https://weather.example",
    tool: {
      name: "WebFetch",
      detail: "https://weather.example",
    },
    observedAt: "2026-01-01T00:00:00.000Z",
  });
  const statusEvent = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "todo_status",
    liveType: "todo.updated",
    role: "explore",
    agentId: "agent_explore_a",
    stream: false,
    message: "Task completed",
    observedAt: "2026-01-01T00:00:01.000Z",
  });

  expect(toolEvent).toMatchObject({
    eventType: "tool.started",
    scope: "agent",
    streamState: "none",
    metadata: {
      liveType: "todo.updated",
      tool: {
        name: "WebFetch",
        detail: "https://weather.example",
      },
    },
  });
  expect(statusEvent).toMatchObject({
    eventType: "thread.status",
    scope: "agent",
    streamState: "none",
    metadata: { liveType: "todo.updated" },
  });
});

test("buildThreadRunEventFromLiveEvent preserves structured OTel tool metadata", () => {
  const event = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "otel_tool",
    liveType: "otel.activity",
    role: "explore",
    agentId: "agent_explore_a",
    stream: false,
    message: "Tool: WebFetch · https://weather.example/guangzhou (8.3s)",
    tool: {
      name: "WebFetch",
      detail: "https://weather.example/guangzhou",
      toolUseId: "toolu_fetch_1",
      durationMs: 8300,
    },
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(event).toMatchObject({
    eventType: "tool.completed",
    scope: "agent",
    streamState: "none",
    metadata: {
      liveType: "otel.activity",
      tool: {
        name: "WebFetch",
        detail: "https://weather.example/guangzhou",
        toolUseId: "toolu_fetch_1",
        durationMs: 8300,
      },
    },
  });
});

test("buildSubagentLifecycleRunEvent includes parent and mission metadata", () => {
  const event = buildSubagentLifecycleRunEvent({
    threadId: "thr_1",
    agentId: "agent_coder_a",
    role: "coder",
    lifecycle: "started",
    runAttemptId: "attempt_1",
    parentAgentId: "planner:attempt_1",
    parentToolUseId: "toolu_1",
    missionKey: "implement api",
    todoId: "todo-1",
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(event).toMatchObject({
    id: "tre:thr_1:agent:agent_coder_a:started",
    eventType: "agent.started",
    scope: "agent",
    agentId: "agent_coder_a",
    parentAgentId: "planner:attempt_1",
    parentToolUseId: "toolu_1",
    metadata: { lifecycle: "started", missionKey: "implement api", todoId: "todo-1" },
  });
});
