import { expect, test } from "bun:test";
import { buildThreadRunProjection } from "../src/main/thread-run-projection";
import type { AgentInstanceRecord, RunAttemptRecord } from "../src/main/usage-ledger";
import type {
  ThreadBillingSnapshot,
  ThreadContextSnapshot,
  ThreadRunEvent,
} from "../src/shared/ipc";

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

test("buildThreadRunProjection surfaces ambiguous role-only agent events as diagnostics", () => {
  const projection = buildThreadRunProjection({
    threadId: "thr_projection",
    status: "running",
    attempts: [attempt],
    agents: [agent({ agentId: "coder_a" }), agent({ agentId: "coder_b" })],
    events: [event({ id: "e1", sequence: 1, role: "coder", message: "Role-only event" })],
  });

  expect(projection.diagnostics[0]?.code).toBe("ambiguous_subagent_role");
  expect(projection.agents.every((row) => row.timeline.length === 0)).toBe(true);
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
        streamKey: "thr_projection:coder_a:coder",
        streamState: "finalized",
        message: "Hello",
        observedAt: "2026-01-01T00:00:03.000Z",
      }),
    ],
  });

  expect(projection.requestSpans[0]).toMatchObject({
    requestId: "stream:thr_projection:coder_a:coder",
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
    otelCostUsd: 0,
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
    attempts: [
      { ...attempt, status: "failed", endedAt: "2026-01-01T00:00:03.000Z" },
      retryAttempt,
    ],
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

  expect(projection.requestSpans[0]?.status).toBe("waiting_first_token");
  expect(projection.diagnostics.some((row) => row.code === "request_span_left_open")).toBe(true);
});
