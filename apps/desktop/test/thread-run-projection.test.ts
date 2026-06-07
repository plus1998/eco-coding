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
