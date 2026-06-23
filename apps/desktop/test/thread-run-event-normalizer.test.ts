import { expect, test } from "bun:test";
import { formatSubagentMissionMessage, parseSubagentMissionMessage } from "@eco/runtime";
import {
  buildSubagentLifecycleRunEvent,
  buildSubagentMissionAttributedRunEvent,
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
  expect(event?.requestId).toBeUndefined();
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
    requestId: "msgreq_provider_123",
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(event).toMatchObject({
    id: "tre:request_1",
    eventType: "request.started",
    scope: "main",
    requestId: "msgreq_provider_123",
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
    requestId: "msgreq_provider_retry",
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(event).toMatchObject({
    id: "tre:retry_1",
    eventType: "request.retry_scheduled",
    scope: "main",
    requestId: "msgreq_provider_retry",
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

test("buildSubagentLifecycleRunEvent stores delegation prompt metadata", () => {
  const event = buildSubagentLifecycleRunEvent({
    threadId: "thr_1",
    agentId: "agent_coder_a",
    role: "coder",
    lifecycle: "started",
    delegationPrompt: "Implement export filters in src/api.ts",
    delegationSummary: "实现：export filters",
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(event.metadata).toMatchObject({
    lifecycle: "started",
    delegationPrompt: "Implement export filters in src/api.ts",
    delegationSummary: "实现：export filters",
  });
});

test("buildSubagentMissionAttributedRunEvent stamps agentId into @mission payload", () => {
  const event = buildSubagentMissionAttributedRunEvent({
    threadId: "thr_1",
    agentId: "agent_coder_a",
    role: "coder",
    prompt: "Implement export filters in src/api.ts",
    parentToolUseId: "toolu_agent_1",
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(event).toMatchObject({
    eventType: "message.final",
    scope: "agent",
    agentId: "agent_coder_a",
    parentToolUseId: "toolu_agent_1",
  });
  const mission = parseSubagentMissionMessage(event.message);
  expect(mission?.agentId).toBe("agent_coder_a");
  expect(mission?.prompt).toContain("export filters");
});

test("buildThreadRunEventFromLiveEvent keeps planner Agent delegation on main timeline", () => {
  const mission = formatSubagentMissionMessage("coder", "Implement export filters in src/api.ts");
  const event = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "act_delegate",
    liveType: "tool.started",
    role: "coder",
    stream: false,
    message: mission,
    tool: {
      name: "Agent",
      detail: "coder",
    },
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(event).toMatchObject({
    eventType: "tool.started",
    scope: "main",
    message: mission,
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

test("buildThreadRunEventFromLiveEvent persists bash approval metadata", () => {
  const event = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "act_approval",
    liveType: "bash_approval.requested",
    role: "tool",
    stream: false,
    message: "等待确认 Grep：/outside/file.txt",
    observedAt: "2026-01-01T00:00:00.000Z",
    bashApproval: {
      toolUseId: "toolu_grep_1",
      phase: "requested",
      toolName: "Grep",
      detail: "/outside/file.txt",
    },
  });

  expect(event).toMatchObject({
    eventType: "message.final",
    metadata: {
      liveType: "bash_approval.requested",
      bashApproval: {
        toolUseId: "toolu_grep_1",
        phase: "requested",
        toolName: "Grep",
        detail: "/outside/file.txt",
      },
    },
  });
});

test("buildThreadRunEventFromLiveEvent scopes bash approval to agent when agentId is present", () => {
  const event = buildThreadRunEventFromLiveEvent({
    threadId: "thr_1",
    eventId: "act_bash_approval",
    liveType: "bash_approval.requested",
    role: "tool",
    stream: false,
    message: "等待确认 Bash：npm test",
    observedAt: "2026-01-01T00:00:00.000Z",
    agentId: "agent_coder_a",
    bashApproval: {
      toolUseId: "toolu_bash_1",
      phase: "requested",
      toolName: "Bash",
      detail: "npm test",
    },
  });

  expect(event).toMatchObject({
    eventType: "message.final",
    scope: "agent",
    agentId: "agent_coder_a",
  });
});
