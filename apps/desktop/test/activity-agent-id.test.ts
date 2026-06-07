import { expect, test } from "bun:test";
import { inferActivityRole } from "@eco/runtime/sdk";
import { SubagentMetricsRegistry } from "../src/main/subagent-metrics-registry";
import type { SubagentMetricsPersistenceStore } from "../src/main/subagent-metrics-persistence";
import { activityStreamKey, resolveActivityAgentId } from "../src/main/activity-agent-id";

test("resolveActivityAgentId prefers distinct subagent session id", () => {
  const agentId = resolveActivityAgentId(
    "thr_1",
    {
      type: "tool.started",
      role: "coder",
      agentId: "session_coder_1",
      payload: {
        type: "tool_use",
        tool_name: "Read",
        parent_tool_use_id: "tool_parent_1",
        subagent_type: "coder",
      },
    },
    { plannerSessionId: "session_planner" },
  );
  expect(agentId).toBe("session_coder_1");
});

test("resolveActivityAgentId falls back to parent tool use mapping", () => {
  const registry = new SubagentMetricsRegistry(metricsStoreStub);
  registry.noteTaskToolUse("thr_1", "toolu_task_1");
  registry.linkToolUseToAgent("thr_1", "toolu_task_1", "agent_coder_a");

  const agentId = resolveActivityAgentId(
    "thr_1",
    {
      type: "message.delta",
      role: "planner",
      agentId: "session_planner",
      payload: {
        type: "eco_stream",
        blockKind: "text",
        text: "hi",
        parent_tool_use_id: "toolu_task_1",
        subagent_type: "coder",
      },
    },
    {
      plannerSessionId: "session_planner",
      metricsRegistry: registry,
    },
  );

  expect(agentId).toBe("agent_coder_a");
  expect(inferActivityRole({
    type: "message.delta",
    role: "planner",
    payload: {
      type: "eco_stream",
      blockKind: "text",
      subagent_type: "coder",
    },
  })).toBe("coder");
});

test("activityStreamKey isolates parallel subagent streams", () => {
  expect(activityStreamKey("thr_1", "agent_a", "coder")).toBe("thr_1:agent_a");
  expect(activityStreamKey("thr_1", undefined, "planner")).toBe("thr_1:planner");
});

const metricsStoreStub: SubagentMetricsPersistenceStore = {
  listSubagentMetrics: () => [],
  upsertSubagentMetrics: () => {},
  clearSubagentMetrics: () => {},
};

test("resolveActivityAgentId falls back to sole active subagent without parent", () => {
  const registry = new SubagentMetricsRegistry(metricsStoreStub);
  registry.onSubagentStart("thr_1", { agentId: "agent_coder_solo", role: "coder" });

  const agentId = resolveActivityAgentId(
    "thr_1",
    {
      type: "tool.started",
      role: "tool",
      payload: {
        type: "tool_use",
        tool_name: "Read",
        subagent_type: "coder",
      },
    },
    { metricsRegistry: registry },
  );

  expect(agentId).toBe("agent_coder_solo");
});

test("resolveActivityAgentId falls back to sole active dynamic subagent", () => {
  const registry = new SubagentMetricsRegistry(metricsStoreStub);
  registry.onSubagentStart("thr_1", { agentId: "agent_researcher_solo", role: "researcher" });

  const agentId = resolveActivityAgentId(
    "thr_1",
    {
      type: "tool.started",
      role: "researcher",
      payload: {
        type: "tool_use",
        tool_name: "WebSearch",
      },
    },
    { metricsRegistry: registry },
  );

  expect(agentId).toBe("agent_researcher_solo");
});

test("resolveActivityAgentId resolves parallel coders via parent tool use", () => {
  const registry = new SubagentMetricsRegistry(metricsStoreStub);
  registry.noteTaskToolUse("thr_1", "toolu_task_a");
  registry.onSubagentStart("thr_1", { agentId: "agent_coder_a", role: "coder" });
  registry.noteTaskToolUse("thr_1", "toolu_task_b");
  registry.onSubagentStart("thr_1", { agentId: "agent_coder_b", role: "coder" });

  const agentA = resolveActivityAgentId(
    "thr_1",
    {
      type: "tool.started",
      role: "coder",
      payload: {
        type: "tool_use",
        tool_name: "Read",
        parent_tool_use_id: "toolu_task_a",
        subagent_type: "coder",
      },
    },
    { metricsRegistry: registry },
  );
  const agentB = resolveActivityAgentId(
    "thr_1",
    {
      type: "tool.started",
      role: "coder",
      payload: {
        type: "tool_use",
        tool_name: "Read",
        parent_tool_use_id: "toolu_task_b",
        subagent_type: "coder",
      },
    },
    { metricsRegistry: registry },
  );

  expect(agentA).toBe("agent_coder_a");
  expect(agentB).toBe("agent_coder_b");
});

test("resolveActivityAgentId maps parent tool use when activity role is tool", () => {
  const registry = new SubagentMetricsRegistry(metricsStoreStub);
  registry.noteTaskToolUse("thr_1", "toolu_task_1");
  registry.linkToolUseToAgent("thr_1", "toolu_task_1", "agent_coder_a");

  const agentId = resolveActivityAgentId(
    "thr_1",
    {
      type: "tool.started",
      role: "tool",
      payload: {
        type: "tool_use",
        tool_name: "Read",
        parent_tool_use_id: "toolu_task_1",
      },
    },
    { metricsRegistry: registry },
  );

  expect(agentId).toBe("agent_coder_a");
});

test("resolveActivityAgentId accepts distinct session id registered in metrics", () => {
  const registry = new SubagentMetricsRegistry(metricsStoreStub);
  registry.onSubagentStart("thr_1", { agentId: "agent_coder_solo", role: "coder" });

  const agentId = resolveActivityAgentId(
    "thr_1",
    {
      type: "tool.started",
      role: "tool",
      agentId: "agent_coder_solo",
      payload: {
        type: "tool_use",
        tool_name: "Read",
      },
    },
    { plannerSessionId: "session_planner", metricsRegistry: registry },
  );

  expect(agentId).toBe("agent_coder_solo");
});
