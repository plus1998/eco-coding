import { expect, test } from "bun:test";
import { buildThreadRunProjection } from "../src/main/thread-run-projection";
import type { AgentInstanceRecord, RunAttemptRecord } from "../src/main/usage-ledger";
import type { ThreadBillingSnapshot, ThreadContextSnapshot, ThreadRunEvent } from "../src/shared/ipc";

const attempt: RunAttemptRecord = {
  threadId: "thr_projection",
  attemptId: "attempt_1",
  phase: "execution",
  retryIndex: 0,
  status: "running",
  startedAt: "2026-01-01T00:00:00.000Z",
};

const retryAttempt: RunAttemptRecord = {
  threadId: "thr_projection",
  attemptId: "attempt_2",
  phase: "execution",
  retryIndex: 1,
  status: "cancelled",
  startedAt: "2026-01-01T00:00:04.000Z",
  endedAt: "2026-01-01T00:00:06.000Z",
};

function agent(input: Partial<AgentInstanceRecord> & { agentId: string }): AgentInstanceRecord {
  return {
    threadId: "thr_projection",
    agentId: input.agentId,
    role: input.role ?? "coder",
    kind: input.kind ?? "subagent",
    status: input.status ?? "active",
    runAttemptId: "attempt_1",
    parentAgentId: "planner:attempt_1",
    startedAt: input.startedAt ?? "2026-01-01T00:00:01.000Z",
    updatedAt: input.updatedAt ?? "2026-01-01T00:00:01.000Z",
    ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
    ...(input.missionKey && { missionKey: input.missionKey }),
    ...(input.todoId && { todoId: input.todoId }),
    ...(input.endedAt && { endedAt: input.endedAt }),
  };
}

function event(input: Partial<ThreadRunEvent> & { id: string; sequence: number }): ThreadRunEvent {
  return {
    id: input.id,
    threadId: "thr_projection",
    sequence: input.sequence,
    eventType: input.eventType ?? "message.delta",
    scope: input.scope ?? "agent",
    streamState: input.streamState ?? "none",
    message: input.message ?? "",
    observedAt: input.observedAt ?? "2026-01-01T00:00:02.000Z",
    ...(input.role && { role: input.role }),
    ...(input.agentId && { agentId: input.agentId }),
    ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
    ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
    ...(input.requestId && { requestId: input.requestId }),
    ...(input.streamKey && { streamKey: input.streamKey }),
    ...(input.metadata && { metadata: input.metadata }),
  };
}

test("buildThreadRunProjection isolates concurrent same-role subagents by agentId", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "running",
    attempts: [attempt],
    agents: [
      agent({ agentId: "coder_a", parentToolUseId: "toolu_a", missionKey: "api" }),
      agent({ agentId: "coder_b", parentToolUseId: "toolu_b", missionKey: "ui" }),
    ],
    events: [
      event({ id: "e1", sequence: 1, role: "coder", agentId: "coder_a", message: "Read api.ts" }),
      event({ id: "e2", sequence: 2, role: "coder", agentId: "coder_b", message: "Edit ui.ts" }),
    ],
    nowMs: Date.parse("2026-01-01T00:00:05.000Z"),
  });

  expect(projection.agents).toHaveLength(2);
  expect(projection.agents.find((row) => row.agentId === "coder_a")?.latestActivity).toBe("Read api.ts");
  expect(projection.agents.find((row) => row.agentId === "coder_b")?.latestActivity).toBe("Edit ui.ts");
  expect(projection.timeline).toEqual([]);
});

test("buildThreadRunProjection keeps unattributed subagent tools off main timeline", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "running",
    attempts: [attempt],
    agents: [agent({ agentId: "explore_a", role: "explore" })],
    events: [
      event({
        id: "tool_read",
        sequence: 1,
        eventType: "tool.started",
        scope: "agent",
        role: "explore",
        message: "Tool: Read · src/main.ts",
        observedAt: "2026-01-01T00:00:03.000Z",
        metadata: {
          liveType: "tool.started",
          tool: { name: "Read", detail: "src/main.ts", toolUseId: "toolu_read_1" },
        },
      }),
    ],
  });

  expect(projection.timeline).toHaveLength(0);
  expect(projection.agents[0]?.timeline).toHaveLength(1);
  expect(projection.agents[0]?.timeline[0]?.id).toBe("tool_read");
  expect(projection.diagnostics).toEqual([]);
});

test("buildThreadRunProjection replays parent-linked tools after agent.started", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "running",
    attempts: [attempt],
    agents: [],
    events: [
      event({
        id: "tool_read",
        sequence: 1,
        eventType: "tool.started",
        scope: "agent",
        role: "explore",
        parentToolUseId: "toolu_delegate",
        message: "Tool: Read · src/main.ts",
        observedAt: "2026-01-01T00:00:02.000Z",
      }),
      event({
        id: "agent_started",
        sequence: 2,
        eventType: "agent.started",
        scope: "agent",
        role: "explore",
        agentId: "explore_a",
        parentToolUseId: "toolu_delegate",
        message: "Subagent explore started",
        observedAt: "2026-01-01T00:00:01.000Z",
      }),
    ],
  });

  expect(projection.timeline).toHaveLength(0);
  expect(projection.diagnostics).toEqual([]);
  expect(projection.agents).toHaveLength(1);
  expect(projection.agents[0]?.agentId).toBe("explore_a");
  expect(projection.agents[0]?.timeline).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "tool_read",
        agentId: "explore_a",
        text: "Tool: Read · src/main.ts",
      }),
    ]),
  );
});

test("buildThreadRunProjection replays pending tools after stream-delayed mission link", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "running",
    attempts: [attempt],
    agents: [agent({ agentId: "explore_a", role: "explore" })],
    events: [
      event({
        id: "agent_started",
        sequence: 1,
        eventType: "agent.started",
        scope: "agent",
        role: "explore",
        agentId: "explore_a",
        message: "Subagent explore started",
        observedAt: "2026-01-01T00:00:01.000Z",
      }),
      event({
        id: "tool_read",
        sequence: 2,
        eventType: "tool.started",
        scope: "agent",
        role: "explore",
        parentToolUseId: "call_00_delegate",
        message: "Tool: Read · src/main.ts",
        observedAt: "2026-01-01T00:00:02.000Z",
      }),
      event({
        id: "mission",
        sequence: 3,
        eventType: "message.final",
        scope: "agent",
        role: "explore",
        agentId: "explore_a",
        parentToolUseId: "call_00_delegate",
        message: "@mission explore: scan src",
        observedAt: "2026-01-01T00:00:03.000Z",
      }),
    ],
  });

  expect(projection.timeline).toHaveLength(0);
  expect(projection.diagnostics).toEqual([]);
  expect(projection.agents[0]?.timeline).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "tool_read",
        agentId: "explore_a",
        text: "Tool: Read · src/main.ts",
      }),
    ]),
  );
});

test("buildThreadRunProjection surfaces role-only agent events as missing_agent_id", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "running",
    attempts: [attempt],
    agents: [agent({ agentId: "coder_a" }), agent({ agentId: "coder_b" })],
    events: [event({ id: "e1", sequence: 1, role: "coder", message: "Role-only event" })],
  });

  expect(projection.diagnostics[0]?.code).toBe("missing_agent_id");
  expect(projection.agents.every((row) => row.timeline.length === 0)).toBe(true);
});

test("buildThreadRunProjection resolves role-only explore events for a unique subagent", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "completed",
    attempts: [{ ...attempt, status: "completed", endedAt: "2026-01-01T00:00:10.000Z" }],
    agents: [
      agent({
        agentId: "explore_a",
        role: "explore",
        status: "stopped",
        parentToolUseId: "call_delegate",
        startedAt: "2026-01-01T00:00:02.000Z",
        endedAt: "2026-01-01T00:00:08.000Z",
      }),
    ],
    events: [
      event({
        id: "early_progress",
        sequence: 1,
        eventType: "tool.started",
        scope: "agent",
        role: "explore",
        message: "Tool: Read · src/auth.ts",
        observedAt: "2026-01-01T00:00:01.995Z",
      }),
    ],
  });

  expect(projection.diagnostics).toEqual([]);
  expect(projection.agents[0]?.timeline).toMatchObject([
    {
      id: "early_progress",
      role: "explore",
      agentId: "explore_a",
    },
  ]);
});

test("buildThreadRunProjection resolves agent-scoped events via parentToolUseId", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "completed",
    attempts: [{ ...attempt, status: "completed", endedAt: "2026-01-01T00:00:06.000Z" }],
    agents: [
      agent({
        agentId: "explore_a",
        role: "explore",
        status: "stopped",
        parentToolUseId: "toolu_explore",
        startedAt: "2026-01-01T00:00:01.000Z",
        endedAt: "2026-01-01T00:00:05.000Z",
      }),
    ],
    events: [
      event({
        id: "linked",
        sequence: 1,
        eventType: "tool.started",
        scope: "agent",
        role: "explore",
        parentToolUseId: "toolu_explore",
        message: "Tool: WebFetch · weather.com.cn",
        observedAt: "2026-01-01T00:00:03.000Z",
      }),
    ],
  });

  expect(projection.diagnostics).toEqual([]);
  expect(projection.agents[0]?.timeline).toMatchObject([
    {
      id: "linked",
      role: "explore",
      agentId: "explore_a",
      text: "Tool: WebFetch · weather.com.cn",
    },
  ]);
});

test("buildThreadRunProjection separates main and agent timeline scopes", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "running",
    attempts: [attempt],
    agents: [agent({ agentId: "coder_a" })],
    events: [
      event({
        id: "main",
        sequence: 1,
        eventType: "thread.status",
        scope: "main",
        role: "planner",
        message: "Executing",
      }),
      event({
        id: "agent",
        sequence: 2,
        scope: "agent",
        role: "coder",
        agentId: "coder_a",
        message: "Reading",
      }),
      event({
        id: "both",
        sequence: 3,
        eventType: "api.error",
        scope: "both",
        role: "coder",
        agentId: "coder_a",
        message: "HTTP 502",
      }),
    ],
  });

  expect(projection.timeline.map((row) => row.id)).toEqual(["main", "both"]);
  expect(projection.agents[0]?.timeline.map((row) => row.id)).toEqual(["agent", "both"]);
});

test("buildThreadRunProjection does not treat array index as a main timeline agentId", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "running",
    attempts: [attempt],
    agents: [],
    events: [
      event({
        id: "tool-main",
        sequence: 9,
        eventType: "tool.started",
        scope: "main",
        role: "planner",
        message: "Tool: WebSearch",
      }),
    ],
  });

  expect(projection.timeline[0]).toMatchObject({
    id: "tool-main",
    role: "planner",
    text: "Tool: WebSearch",
  });
  expect(projection.timeline[0]?.agentId).toBeUndefined();
});

test("buildThreadRunProjection derives request span timing from stream events", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "running",
    attempts: [attempt],
    agents: [agent({ agentId: "coder_a" })],
    events: [
      event({
        id: "placeholder",
        sequence: 1,
        role: "coder",
        agentId: "coder_a",
        requestId: "msgreq_provider_1",
        streamKey: "thr_projection:coder_a:coder",
        streamState: "placeholder",
        message: "",
        observedAt: "2026-01-01T00:00:01.000Z",
      }),
      event({
        id: "first",
        sequence: 2,
        role: "coder",
        agentId: "coder_a",
        requestId: "msgreq_provider_1",
        streamKey: "thr_projection:coder_a:coder",
        streamState: "streaming",
        message: "Hello",
        observedAt: "2026-01-01T00:00:02.500Z",
      }),
      event({
        id: "final",
        sequence: 3,
        role: "coder",
        agentId: "coder_a",
        requestId: "msgreq_provider_1",
        streamKey: "thr_projection:coder_a:coder",
        streamState: "finalized",
        message: "Hello",
        observedAt: "2026-01-01T00:00:03.000Z",
      }),
    ],
  });

  expect(projection.requestSpans[0]).toMatchObject({
    requestId: "msgreq_provider_1",
    ownerAgentId: "coder_a",
    status: "completed",
    startedAt: "2026-01-01T00:00:01.000Z",
    firstTokenAt: "2026-01-01T00:00:02.500Z",
    endedAt: "2026-01-01T00:00:03.000Z",
  });
});

test("buildThreadRunProjection attaches usage and context by agentId", () => {
  const billing: ThreadBillingSnapshot = {
    totalTokens: { input: 10, output: 5, cacheRead: 0, cacheCreation: 0 },
    sourceReportedCostUsd: 0,
    plannerTokenCostUsd: 0,
    ecoCostUsd: 0.01,
    savedUsd: 0,
    savedPct: 0,
    pricingResolved: true,
    subagents: [
      {
        agentId: "coder_a",
        role: "coder",
        status: "active",
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        contextOccupied: 200,
        contextLimit: 1000,
        ecoCostUsd: 0.01,
        modelId: "model-a",
      },
    ],
  };
  const context: ThreadContextSnapshot = {
    occupied: 200,
    limit: 1000,
    occupancyPct: 20,
    limitsResolved: true,
    segments: [],
    updatedAt: 1,
    instances: [
      {
        agentId: "coder_a",
        role: "coder",
        occupied: 200,
        limit: 1000,
        occupancyPct: 20,
        limitsResolved: true,
        segments: [],
        modelId: "model-a",
        updatedAt: 1,
      },
    ],
  };

  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "running",
    attempts: [attempt],
    agents: [agent({ agentId: "coder_a" })],
    events: [],
    billing,
    context,
  });

  expect(projection.agents[0]?.usage?.modelId).toBe("model-a");
  expect(projection.agents[0]?.usage?.inputTokens).toBe(10);
  expect(projection.agents[0]?.context?.occupancyPct).toBe(20);
});

test("buildThreadRunProjection keeps planner thinking and subagent narrative separate", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "running",
    attempts: [attempt],
    agents: [agent({ agentId: "coder_a" })],
    events: [
      event({
        id: "thinking",
        sequence: 1,
        eventType: "thinking.delta",
        scope: "main",
        role: "thinking",
        message: "Planning",
      }),
      event({
        id: "coder-message",
        sequence: 2,
        eventType: "message.delta",
        scope: "agent",
        role: "coder",
        agentId: "coder_a",
        message: "Editing src/App.tsx",
      }),
    ],
  });

  expect(projection.timeline.map((row) => row.id)).toEqual(["thinking"]);
  expect(projection.agents[0]?.timeline.map((row) => row.id)).toEqual(["coder-message"]);
});

test("buildThreadRunProjection surfaces API failures to main feed and agent details", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "failed",
    attempts: [{ ...attempt, status: "failed", endedAt: "2026-01-01T00:00:03.000Z" }],
    agents: [agent({ agentId: "coder_a", status: "stopped", endedAt: "2026-01-01T00:00:03.000Z" })],
    events: [
      event({
        id: "request",
        sequence: 1,
        eventType: "request.started",
        scope: "agent",
        role: "coder",
        agentId: "coder_a",
        requestId: "req_1",
        observedAt: "2026-01-01T00:00:01.000Z",
      }),
      event({
        id: "api-error",
        sequence: 2,
        eventType: "api.error",
        scope: "both",
        role: "coder",
        agentId: "coder_a",
        requestId: "req_1",
        message: "HTTP 502",
        metadata: { apiError: { statusCode: 502, message: "Bad gateway" } },
        observedAt: "2026-01-01T00:00:02.000Z",
      }),
    ],
  });

  expect(projection.timeline.map((row) => row.id)).toEqual(["api-error"]);
  expect(projection.agents[0]?.timeline.map((row) => row.id)).toEqual(["request", "api-error"]);
  expect(projection.requestSpans[0]).toMatchObject({
    requestId: "req_1",
    ownerAgentId: "coder_a",
    status: "failed",
    error: "Bad gateway",
  });
});

test("buildThreadRunProjection tracks retry attempts and terminal request states", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "failed",
    attempts: [{ ...attempt, status: "failed", endedAt: "2026-01-01T00:00:03.000Z" }, retryAttempt],
    agents: [agent({ agentId: "coder_a" })],
    events: [
      event({
        id: "request-1-start",
        sequence: 1,
        eventType: "request.started",
        scope: "main",
        role: "planner",
        requestId: "req_1",
        observedAt: "2026-01-01T00:00:01.000Z",
      }),
      event({
        id: "request-1-failed",
        sequence: 2,
        eventType: "request.failed",
        scope: "main",
        role: "planner",
        requestId: "req_1",
        message: "HTTP 529",
        observedAt: "2026-01-01T00:00:02.000Z",
      }),
      event({
        id: "retry",
        sequence: 3,
        eventType: "request.retry_scheduled",
        scope: "main",
        role: "planner",
        message: "准备重试",
        observedAt: "2026-01-01T00:00:03.000Z",
      }),
      event({
        id: "request-2-start",
        sequence: 4,
        eventType: "request.started",
        scope: "main",
        role: "planner",
        requestId: "req_2",
        observedAt: "2026-01-01T00:00:04.000Z",
      }),
      event({
        id: "request-2-cancelled",
        sequence: 5,
        eventType: "request.cancelled",
        scope: "main",
        role: "planner",
        requestId: "req_2",
        observedAt: "2026-01-01T00:00:05.000Z",
      }),
    ],
  });

  expect(projection.thread.currentAttemptId).toBe("attempt_2");
  expect(projection.requestSpans.map((span) => span.status)).toEqual(["failed", "cancelled"]);
  expect(
    projection.requestSpans.some(
      (span) => span.status === "waiting_first_token" || span.status === "streaming",
    ),
  ).toBe(false);
  expect(projection.timeline.map((row) => row.id)).toEqual([
    "request-1-start",
    "request-1-failed",
    "retry",
    "request-2-start",
    "request-2-cancelled",
  ]);
});

test("buildThreadRunProjection keeps a single span after provider request id rekey", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "completed",
    attempts: [{ ...attempt, status: "completed", endedAt: "2026-01-01T00:00:04.000Z" }],
    agents: [],
    events: [
      event({
        id: "request-start",
        sequence: 1,
        eventType: "request.started",
        scope: "main",
        role: "planner",
        requestId: "msgreq_provider_123",
        observedAt: "2026-01-01T00:00:01.000Z",
      }),
      event({
        id: "message-delta",
        sequence: 2,
        eventType: "message.delta",
        scope: "main",
        role: "planner",
        requestId: "msgreq_provider_123",
        streamState: "streaming",
        message: "Hello",
        observedAt: "2026-01-01T00:00:02.000Z",
      }),
      event({
        id: "message-final",
        sequence: 3,
        eventType: "message.final",
        scope: "main",
        role: "planner",
        requestId: "msgreq_provider_123",
        streamState: "finalized",
        message: "Hello world",
        observedAt: "2026-01-01T00:00:03.000Z",
      }),
    ],
  });

  expect(projection.requestSpans).toHaveLength(1);
  expect(projection.requestSpans[0]).toMatchObject({
    requestId: "msgreq_provider_123",
    status: "completed",
  });
  expect(projection.diagnostics.some((row) => row.code === "request_span_left_open")).toBe(false);
});

test("buildThreadRunProjection diagnoses request spans left open after terminal status", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "completed",
    attempts: [{ ...attempt, status: "completed", endedAt: "2026-01-01T00:00:03.000Z" }],
    agents: [],
    events: [
      event({
        id: "request",
        sequence: 1,
        eventType: "request.started",
        scope: "main",
        role: "planner",
        requestId: "req_open",
        observedAt: "2026-01-01T00:00:01.000Z",
      }),
    ],
  });

  expect(projection.requestSpans[0]?.status).toBe("completed");
  expect(projection.requestSpans[0]?.endedAt).toBe("2026-01-01T00:00:01.000Z");
  expect(projection.diagnostics.some((row) => row.code === "request_span_left_open")).toBe(true);
});

test("buildThreadRunProjection closes open request spans for stopped agents", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "running",
    attempts: [attempt],
    agents: [
      agent({
        agentId: "coder_done",
        status: "stopped",
        endedAt: "2026-01-01T00:00:05.000Z",
        updatedAt: "2026-01-01T00:00:05.000Z",
      }),
    ],
    events: [
      event({
        id: "request-start",
        sequence: 1,
        eventType: "request.started",
        scope: "agent",
        role: "coder",
        agentId: "coder_done",
        requestId: "req_coder",
        observedAt: "2026-01-01T00:00:02.000Z",
      }),
      event({
        id: "tool",
        sequence: 2,
        eventType: "tool.started",
        scope: "agent",
        role: "coder",
        agentId: "coder_done",
        message: "Tool: Bash · git diff",
        observedAt: "2026-01-01T00:00:03.000Z",
      }),
    ],
    nowMs: Date.parse("2026-01-01T00:00:08.000Z"),
  });

  expect(projection.requestSpans[0]).toMatchObject({
    requestId: "req_coder",
    status: "completed",
    ownerAgentId: "coder_done",
    endedAt: "2026-01-01T00:00:05.000Z",
  });
});

test("buildThreadRunProjection closes span with explicit request.completed", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "completed",
    attempts: [{ ...attempt, status: "completed", endedAt: "2026-01-01T00:00:04.000Z" }],
    agents: [],
    events: [
      event({
        id: "request-start",
        sequence: 1,
        eventType: "request.started",
        scope: "main",
        role: "planner",
        requestId: "req_closed",
        observedAt: "2026-01-01T00:00:01.000Z",
      }),
      event({
        id: "message-delta",
        sequence: 2,
        eventType: "message.delta",
        scope: "main",
        role: "planner",
        requestId: "req_closed",
        streamState: "streaming",
        message: "Hello",
        observedAt: "2026-01-01T00:00:02.000Z",
      }),
      event({
        id: "request-completed",
        sequence: 3,
        eventType: "request.completed",
        scope: "main",
        role: "planner",
        requestId: "req_closed",
        message: "模型请求完成",
        observedAt: "2026-01-01T00:00:03.000Z",
      }),
    ],
  });

  expect(projection.requestSpans).toHaveLength(1);
  expect(projection.requestSpans[0]).toMatchObject({
    requestId: "req_closed",
    status: "completed",
    endedAt: "2026-01-01T00:00:03.000Z",
  });
  expect(projection.diagnostics.some((row) => row.code === "request_span_left_open")).toBe(false);
});

test("buildThreadRunProjection anchors span end on narrative finalize when request.completed arrives late", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "completed",
    attempts: [{ ...attempt, status: "completed", endedAt: "2026-01-01T00:00:10.000Z" }],
    agents: [],
    events: [
      event({
        id: "request-start",
        sequence: 1,
        eventType: "request.started",
        scope: "main",
        role: "planner",
        requestId: "req_late_terminal",
        observedAt: "2026-01-01T00:00:01.000Z",
      }),
      event({
        id: "message-delta",
        sequence: 2,
        eventType: "message.delta",
        scope: "main",
        role: "planner",
        requestId: "req_late_terminal",
        streamState: "streaming",
        message: "Hello",
        observedAt: "2026-01-01T00:00:02.000Z",
      }),
      event({
        id: "message-final",
        sequence: 3,
        eventType: "message.final",
        scope: "main",
        role: "planner",
        requestId: "req_late_terminal",
        streamState: "finalized",
        message: "Hello world",
        observedAt: "2026-01-01T00:00:04.000Z",
      }),
      event({
        id: "request-completed",
        sequence: 4,
        eventType: "request.completed",
        scope: "main",
        role: "planner",
        requestId: "req_late_terminal",
        message: "模型请求完成",
        observedAt: "2026-01-01T00:00:09.000Z",
      }),
    ],
  });

  expect(projection.requestSpans[0]).toMatchObject({
    requestId: "req_late_terminal",
    status: "completed",
    firstTokenAt: "2026-01-01T00:00:02.000Z",
    endedAt: "2026-01-01T00:00:04.000Z",
  });
});

test("buildThreadRunProjection anchors first token and span end on narrative stream, not thinking finalize", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "completed",
    attempts: [{ ...attempt, status: "completed", endedAt: "2026-01-01T00:00:12.000Z" }],
    agents: [],
    events: [
      event({
        id: "request-start",
        sequence: 1,
        eventType: "request.started",
        scope: "main",
        role: "planner",
        requestId: "req_think",
        observedAt: "2026-01-01T00:00:01.000Z",
      }),
      event({
        id: "thinking-delta",
        sequence: 2,
        eventType: "thinking.delta",
        scope: "main",
        role: "thinking",
        requestId: "req_think",
        streamState: "streaming",
        message: "reasoning…",
        observedAt: "2026-01-01T00:00:02.000Z",
      }),
      event({
        id: "thinking-final",
        sequence: 3,
        eventType: "thinking.final",
        scope: "main",
        role: "thinking",
        requestId: "req_think",
        streamState: "finalized",
        message: "reasoning done",
        observedAt: "2026-01-01T00:00:03.000Z",
      }),
      event({
        id: "message-delta",
        sequence: 4,
        eventType: "message.delta",
        scope: "main",
        role: "planner",
        requestId: "req_think",
        streamState: "streaming",
        message: "Hello",
        observedAt: "2026-01-01T00:00:08.000Z",
      }),
      event({
        id: "message-final",
        sequence: 5,
        eventType: "message.final",
        scope: "main",
        role: "planner",
        requestId: "req_think",
        streamState: "finalized",
        message: "Hello world",
        observedAt: "2026-01-01T00:00:10.000Z",
      }),
      event({
        id: "request-completed",
        sequence: 6,
        eventType: "request.completed",
        scope: "main",
        role: "planner",
        requestId: "req_think",
        observedAt: "2026-01-01T00:00:11.000Z",
      }),
    ],
  });

  expect(projection.requestSpans[0]).toMatchObject({
    requestId: "req_think",
    status: "completed",
    startedAt: "2026-01-01T00:00:01.000Z",
    firstTokenAt: "2026-01-01T00:00:08.000Z",
    endedAt: "2026-01-01T00:00:10.000Z",
  });
});

test("buildThreadRunProjection ignores duplicate request.started after streaming begins", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "completed",
    attempts: [{ ...attempt, status: "completed", endedAt: "2026-01-01T00:00:05.000Z" }],
    agents: [],
    events: [
      event({
        id: "request-start",
        sequence: 1,
        eventType: "request.started",
        scope: "main",
        role: "planner",
        requestId: "req_dup",
        observedAt: "2026-01-01T00:00:01.000Z",
      }),
      event({
        id: "message-delta",
        sequence: 2,
        eventType: "message.delta",
        scope: "main",
        role: "planner",
        requestId: "req_dup",
        streamState: "streaming",
        message: "Hello",
        observedAt: "2026-01-01T00:00:02.000Z",
      }),
      event({
        id: "request-dup",
        sequence: 3,
        eventType: "request.started",
        scope: "main",
        role: "planner",
        requestId: "req_dup",
        observedAt: "2026-01-01T00:00:02.500Z",
      }),
      event({
        id: "request-completed",
        sequence: 4,
        eventType: "request.completed",
        scope: "main",
        role: "planner",
        requestId: "req_dup",
        observedAt: "2026-01-01T00:00:04.000Z",
      }),
    ],
  });

  expect(projection.requestSpans[0]).toMatchObject({
    requestId: "req_dup",
    status: "completed",
    endedAt: "2026-01-01T00:00:04.000Z",
  });
  expect(projection.diagnostics.some((row) => row.code === "request_span_left_open")).toBe(false);
});

test("buildThreadRunProjection suppresses persisted SDK message replay after finalization", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_sdk_replay",
    status: "idle",
    attempts: [],
    agents: [],
    events: [
      event({
        id: "first-placeholder",
        sequence: 1,
        scope: "main",
        role: "planner",
        eventType: "message.delta",
        streamState: "placeholder",
        streamKey: "thr_sdk_replay:planner:block:text:1",
        message: "",
        metadata: { sdkMessageId: "msg_same", sdkStreamBlockKey: "text:1" },
      }),
      event({
        id: "first-final",
        sequence: 2,
        scope: "main",
        role: "planner",
        eventType: "message.final",
        streamState: "finalized",
        streamKey: "thr_sdk_replay:planner:block:text:1",
        message: "只显示一次。",
        metadata: { sdkMessageId: "msg_same", sdkStreamBlockKey: "text:1" },
      }),
      event({
        id: "replayed-placeholder",
        sequence: 3,
        scope: "main",
        role: "planner",
        eventType: "message.delta",
        streamState: "placeholder",
        streamKey: "thr_sdk_replay:planner:block:text:2",
        message: "",
        metadata: { sdkMessageId: "msg_same", sdkStreamBlockKey: "text:2" },
      }),
      event({
        id: "replayed-final",
        sequence: 4,
        scope: "main",
        role: "planner",
        eventType: "message.final",
        streamState: "finalized",
        streamKey: "thr_sdk_replay:planner:block:text:2",
        message: "只显示一次。",
        metadata: { sdkMessageId: "msg_same", sdkStreamBlockKey: "text:2" },
      }),
    ],
  });

  expect(projection.sourceEventCount).toBe(4);
  expect(projection.timeline.map((item) => item.id)).toEqual(["first-placeholder", "first-final"]);
});

test("buildThreadRunProjection ignores persisted metrics-only usage events", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "running",
    attempts: [attempt],
    agents: [],
    events: [
      event({
        id: "usage-badge",
        sequence: 1,
        eventType: "thread.status",
        scope: "agent",
        role: "architect",
        message: "↑565 ↓146",
        observedAt: "2026-01-01T00:00:02.000Z",
        metadata: { liveType: "thread.usage_updated" },
      }),
    ],
  });

  expect(projection.diagnostics).toEqual([]);
  expect(projection.agents).toEqual([]);
});

test("buildThreadRunProjection does not diagnose missing prefixes in bounded history", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_partial_history",
    status: "idle",
    attempts: [],
    agents: [],
    historyComplete: false,
    events: [
      event({
        id: "thinking-final-tail",
        sequence: 1001,
        eventType: "thinking.final",
        scope: "main",
        requestId: "request_before_window",
        streamState: "finalized",
        message: "",
      }),
    ],
  });

  expect(projection.diagnostics).toEqual([]);
  expect(projection.requestSpans[0]?.status).toBe("waiting_first_token");
});

test("buildThreadRunProjection surfaces nickname and taskName from agent.started metadata", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "running",
    attempts: [attempt],
    agents: [agent({ agentId: "coder_a", parentToolUseId: "toolu_a" })],
    events: [
      event({
        id: "started-path",
        sequence: 1,
        eventType: "agent.started",
        scope: "both",
        role: "coder",
        agentId: "coder_a",
        message: "Subagent coder started",
        metadata: {
          agentPath: "/root/implement_drawer",
          delegationPrompt: "实现抽屉",
        },
      }),
      event({
        id: "started-nick",
        sequence: 2,
        eventType: "agent.started",
        scope: "both",
        role: "coder",
        agentId: "coder_a",
        message: "Subagent coder started",
        metadata: {
          agentNickname: "Goodall",
        },
      }),
    ],
    nowMs: Date.parse("2026-01-01T00:00:05.000Z"),
  });

  expect(projection.agents[0]).toMatchObject({
    agentId: "coder_a",
    taskName: "implement_drawer",
    nickname: "Goodall",
    delegationPrompt: "实现抽屉",
  });
});

test("buildThreadRunProjection promotes orphan agent-scoped messages to main feed", () => {
  const mainCodexId = "019fef91-eeca-76b2-a55e-688fffb375fe";
  const realGeneral = "019fefa5-e3f3-7cc3-a1e7-7f4977521642";
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "completed",
    message: "执行完成。",
    attempts: [{ ...attempt, status: "completed", endedAt: "2026-01-01T00:00:10.000Z" }],
    agents: [
      agent({
        agentId: realGeneral,
        role: "general",
        parentToolUseId: "call_general",
        status: "stopped",
        endedAt: "2026-01-01T00:00:09.000Z",
      }),
    ],
    events: [
      event({
        id: "m_plan",
        sequence: 1,
        scope: "main",
        role: "assistant",
        eventType: "message.final",
        message: "并行修改已全部落定，开始最终串行验收。",
      }),
      event({
        id: "m_orphan_progress",
        sequence: 2,
        scope: "agent",
        role: "general",
        agentId: mainCodexId,
        eventType: "message.final",
        message: "类型检查已通过。",
      }),
      event({
        id: "m_orphan_final",
        sequence: 3,
        scope: "agent",
        role: "general",
        agentId: mainCodexId,
        eventType: "message.final",
        message: "已完成积分红包同步链路迁移。",
      }),
      // Inverted child-turn completion must not mint a phantom main-thread agent card.
      event({
        id: "m_orphan_stop",
        sequence: 4,
        scope: "agent",
        role: "general",
        agentId: mainCodexId,
        parentToolUseId: "call_ghost",
        eventType: "agent.stopped",
        message: "Subagent general completed",
        metadata: { subagentChildTurn: true },
      }),
      event({
        id: "m_real_general",
        sequence: 5,
        scope: "agent",
        role: "general",
        agentId: realGeneral,
        eventType: "message.final",
        message: "最终审计未发现未解决的阻断项。",
      }),
    ],
    nowMs: Date.parse("2026-01-01T00:00:10.000Z"),
  });

  const mainTexts = projection.timeline
    .filter((item) => item.eventType === "message.final")
    .map((item) => item.text);
  expect(mainTexts).toContain("并行修改已全部落定，开始最终串行验收。");
  expect(mainTexts).toContain("类型检查已通过。");
  expect(mainTexts).toContain("已完成积分红包同步链路迁移。");
  expect(mainTexts).not.toContain("最终审计未发现未解决的阻断项。");

  const promoted = projection.timeline.find((item) => item.text === "已完成积分红包同步链路迁移。");
  expect(promoted).toMatchObject({ scope: "main", role: "assistant" });

  expect(projection.agents).toHaveLength(1);
  expect(projection.agents[0]?.agentId).toBe(realGeneral);
  expect(projection.agents[0]?.timeline.map((item) => item.text)).toContain("最终审计未发现未解决的阻断项。");
  expect(projection.agents.some((row) => row.agentId === mainCodexId)).toBe(false);
});

test("ACP nested Agent tool mints a subagent card timeline from agent.started + attributed deltas", () => {
  const sessionId = "8d2ccc48-session";
  const toolUseId = "call-agent-a";
  const subAgentId = `acp-sub:${toolUseId}`;
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "running",
    attempts: [attempt],
    agents: [
      agent({
        agentId: subAgentId,
        role: "general-purpose",
        parentToolUseId: toolUseId,
        startedAt: "2026-01-01T00:00:02.000Z",
      }),
    ],
    events: [
      event({
        id: "tool_start",
        sequence: 1,
        scope: "main",
        role: "tool",
        agentId: sessionId,
        eventType: "tool.started",
        message: "Tool: Agent",
        metadata: { tool: { name: "Agent", toolUseId } },
      }),
      event({
        id: "agent_start",
        sequence: 2,
        scope: "agent",
        role: "general-purpose",
        agentId: subAgentId,
        parentToolUseId: toolUseId,
        eventType: "agent.started",
        message: "Subagent general-purpose started",
      }),
      event({
        id: "sub_out",
        sequence: 3,
        scope: "agent",
        role: "general-purpose",
        agentId: subAgentId,
        parentToolUseId: toolUseId,
        eventType: "message.delta",
        message: "1+1 = 2",
        metadata: { parent_tool_use_id: toolUseId, liveType: "acp.subagent_output" },
      }),
    ],
    nowMs: Date.parse("2026-01-01T00:00:05.000Z"),
  });

  expect(projection.agents).toHaveLength(1);
  expect(projection.agents[0]).toMatchObject({
    agentId: subAgentId,
    kind: "subagent",
    parentToolUseId: toolUseId,
  });
  expect(projection.agents[0]?.timeline.some((item) => item.text === "1+1 = 2")).toBe(true);
  expect(projection.timeline.some((item) => item.eventType === "tool.started")).toBe(true);
});
