import { expect, test } from "bun:test";
import {
  applyCodexSubagentLifecycleEvent,
  type CodexSubagentLifecycleServices,
} from "../src/main/codex-subagent-lifecycle";
import type { ThreadRunEvent, ThreadRunEventType } from "../src/shared/thread-run-events";

function event(eventType: ThreadRunEventType): ThreadRunEvent {
  return {
    id: `event-${eventType}`,
    threadId: "thread-1",
    sequence: 1,
    eventType,
    scope: "agent",
    streamState: "none",
    message: "",
    observedAt: "2026-07-24T00:00:00.000Z",
    role: "general",
    agentId: "agent-1",
    requestId: "request-2",
  };
}

function services(status: string | undefined = "stopped") {
  const calls: string[] = [];
  const lifecycleServices: CodexSubagentLifecycleServices = {
    getAgentState: () => (status ? { status, parentToolUseId: "parent-tool-1" } : undefined),
    resolvePhase: () => "execution",
    startSession: () => calls.push("startSession"),
    stopSession: () => calls.push("stopSession"),
    startMetrics: () => calls.push("startMetrics"),
    stopMetrics: () => calls.push("stopMetrics"),
    startAgent: (input) => calls.push(`startAgent:${input.parentToolUseId ?? ""}`),
    stopAgent: () => calls.push("stopAgent"),
    abandonAgent: () => calls.push("abandonAgent"),
  };
  return { calls, lifecycleServices };
}

test("a new request reactivates a stopped Codex subagent without another agent.started event", () => {
  const input = services("stopped");

  expect(applyCodexSubagentLifecycleEvent(event("request.started"), input.lifecycleServices)).toBe(true);
  expect(input.calls).toEqual(["startSession", "startMetrics", "startAgent:parent-tool-1"]);
});

test("a new request does not start an already active Codex subagent twice", () => {
  const input = services("active");

  expect(applyCodexSubagentLifecycleEvent(event("request.started"), input.lifecycleServices)).toBe(false);
  expect(input.calls).toEqual([]);
});

test("terminal output alone does not reactivate a stopped Codex subagent", () => {
  const input = services("stopped");

  expect(applyCodexSubagentLifecycleEvent(event("tool.completed"), input.lifecycleServices)).toBe(false);
  expect(applyCodexSubagentLifecycleEvent(event("message.final"), input.lifecycleServices)).toBe(false);
  expect(input.calls).toEqual([]);
});

test("a reused Codex subagent can return to stopped after reactivation", () => {
  const input = services("active");

  expect(applyCodexSubagentLifecycleEvent(event("agent.stopped"), input.lifecycleServices)).toBe(true);
  expect(input.calls).toEqual(["stopSession", "stopMetrics", "stopAgent"]);
});
