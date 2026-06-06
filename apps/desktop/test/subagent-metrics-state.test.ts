import { expect, test } from "bun:test";
import {
  createEmptySubagentMetricsEntry,
  SubagentMetricsState,
} from "../src/main/subagent-metrics-state";

test("SubagentMetricsState tracks active role indexes through start and stop", () => {
  const state = new SubagentMetricsState();

  const started = state.start({ agentId: "agent_coder_a", role: "coder" }, 100);
  expect(started.entry.status).toBe("active");
  expect(started.activeCount).toBe(1);
  expect(state.activeAgentIds("coder")).toEqual(["agent_coder_a"]);
  expect(state.roleForAgentId("agent_coder_a")).toBe("coder");

  const stopped = state.stop({ agentId: "agent_coder_a", role: "coder" }, 200);
  expect(stopped.entry?.status).toBe("stopped");
  expect(stopped.entry?.updatedAt).toBe(200);
  expect(stopped.activeCount).toBe(0);
  expect(state.activeAgentIds("coder")).toEqual([]);
  expect(state.agentIdsForRole("coder")).toEqual(["agent_coder_a"]);
});

test("SubagentMetricsState records context without changing billing usage", () => {
  const state = new SubagentMetricsState();

  const entry = state.recordContext(
    "agent_reviewer_a",
    "reviewer",
    {
      contextOccupied: 3200,
      contextLimit: 100_000,
      modelId: "claude-test",
      requestKey: "sdk-result:evt_context",
    },
    300,
  );

  expect(entry.usage.inputTokens).toBe(0);
  expect(entry.usage.outputTokens).toBe(0);
  expect(entry.ecoCostUsd).toBe(0);
  expect(entry.contextOccupied).toBe(3200);
  expect(entry.contextLimit).toBe(100_000);
  expect(entry.modelId).toBe("claude-test");
  expect(entry.lastRequestKey).toBe("sdk-result:evt_context");

  state.recordContext("agent_reviewer_a", "reviewer", { contextOccupied: 3600 }, 400);
  expect(entry.contextOccupied).toBe(3600);
  expect(entry.contextLimit).toBe(100_000);
  expect(entry.modelId).toBe("claude-test");
  expect(entry.updatedAt).toBe(400);
});

test("SubagentMetricsState restores entries and lists latest first", () => {
  const state = new SubagentMetricsState();
  const active = createEmptySubagentMetricsEntry("agent_tester_active", "tester", "active", 500);
  const stopped = createEmptySubagentMetricsEntry("agent_coder_done", "coder", "stopped", 700);

  state.restore(active);
  state.restore(stopped);

  expect(state.activeAgentIds("tester")).toEqual(["agent_tester_active"]);
  expect(state.activeAgentIds("coder")).toEqual([]);
  expect(state.listEntries().map((entry) => entry.agentId)).toEqual([
    "agent_coder_done",
    "agent_tester_active",
  ]);
});
