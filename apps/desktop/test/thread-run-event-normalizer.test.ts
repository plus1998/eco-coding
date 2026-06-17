import { expect, test } from "bun:test";
import {
  buildSubagentLifecycleRunEvent,
  buildThreadRunEventFromLiveEvent,
  isMetricsOnlyThreadLiveEvent,
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

test("buildThreadRunEventFromLiveEvent drops follow-up operational events", () => {
  const event = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "act_cancel",
    liveType: "thread.follow_up.cancelled",
    role: "user",
    stream: false,
    message: "已取消排队的后续消息。",
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(event).toBeUndefined();
});

test("buildThreadRunEventFromLiveEvent drops operational thread lifecycle status lines", () => {
  const stopped = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "act_idle",
    liveType: "thread.idle",
    role: "system",
    stream: false,
    message: "已停止。可继续对话；文件可通过检查点回滚。",
    observedAt: "2026-01-01T00:00:00.000Z",
  });
  const resume = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "act_running",
    liveType: "thread.running",
    role: "system",
    stream: false,
    message: "正在继续执行…",
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(stopped).toBeUndefined();
  expect(resume).toBeUndefined();
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

test("buildThreadRunEventFromLiveEvent maps SDK request status to request span", () => {
  const event = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "request_1",
    liveType: "request.started",
    role: "planner",
    stream: false,
    message: "Requesting model…",
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(event).toMatchObject({
    id: "tre:request_1",
    eventType: "request.started",
    scope: "main",
    requestId: "req:thr_1:request_1",
    streamState: "none",
    metadata: { liveType: "request.started" },
  });
});

test("buildThreadRunEventFromLiveEvent maps SDK retry status to request retry", () => {
  const event = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "retry_1",
    liveType: "request.retry_scheduled",
    role: "planner",
    stream: false,
    message: "API retry 2/5…",
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(event).toMatchObject({
    id: "tre:retry_1",
    eventType: "request.retry_scheduled",
    scope: "main",
    requestId: "req:thr_1:retry_1",
    streamState: "none",
    metadata: { liveType: "request.retry_scheduled" },
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
  const structuredToolEvent = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "todo_structured_tool",
    liveType: "todo.updated",
    role: "explore",
    agentId: "agent_explore_a",
    stream: false,
    message: "https://weather.example",
    tool: {
      name: "WebFetch",
      detail: "https://weather.example",
    },
    observedAt: "2026-01-01T00:00:02.000Z",
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
  expect(structuredToolEvent).toMatchObject({
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
      status: "completed",
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
        status: "completed",
      },
    },
  });
});

test("buildThreadRunEventFromLiveEvent maps structured OTel tool failure without text parsing", () => {
  const event = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "otel_tool_failed",
    liveType: "otel.activity",
    role: "explore",
    agentId: "agent_explore_a",
    stream: false,
    message: "WebFetch timeout",
    tool: {
      name: "WebFetch",
      detail: "https://weather.example/guangzhou",
      toolUseId: "toolu_fetch_1",
      durationMs: 1200,
      status: "failed",
    },
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(event).toMatchObject({
    eventType: "tool.failed",
    scope: "agent",
    streamState: "none",
    metadata: {
      liveType: "otel.activity",
      tool: {
        name: "WebFetch",
        detail: "https://weather.example/guangzhou",
        toolUseId: "toolu_fetch_1",
        durationMs: 1200,
        status: "failed",
      },
    },
  });
});

test("buildThreadRunEventFromLiveEvent maps SDK tool failed events", () => {
  const event = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "sdk_tool_failed",
    liveType: "tool.failed",
    role: "tool",
    agentId: "agent_researcher",
    stream: false,
    message: "Permission denied for Bash: Bash is disabled for this Eco agent.",
    tool: {
      name: "Bash",
      detail: "Bash is disabled for this Eco agent.",
      toolUseId: "tool_denied",
      status: "failed",
    },
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(event).toMatchObject({
    eventType: "tool.failed",
    scope: "agent",
    agentId: "agent_researcher",
    metadata: {
      liveType: "tool.failed",
      tool: {
        name: "Bash",
        detail: "Bash is disabled for this Eco agent.",
        toolUseId: "tool_denied",
        status: "failed",
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

test("buildThreadRunEventFromLiveEvent skips metrics-only thread live events", () => {
  for (const liveType of [
    "thread.usage_updated",
    "thread.context_updated",
    "thread.subagent_timing_updated",
    "thread.todos_updated",
    "thread.title_updated",
  ]) {
    expect(isMetricsOnlyThreadLiveEvent(liveType)).toBe(true);
    expect(
      buildThreadRunEventFromLiveEvent({
        threadId: "thr_1",
        eventId: `metrics_${liveType}`,
        liveType,
        role: "architect",
        stream: false,
        message: "↑1k ↓2k",
        observedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBeUndefined();
  }
});
