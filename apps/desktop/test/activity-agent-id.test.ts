import { expect, test } from "bun:test";
import { inferActivityRole } from "@eco/runtime/sdk";
import { SubagentMetricsRegistry } from "../src/main/subagent-metrics-registry";
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
  const registry = new SubagentMetricsRegistry({} as never);
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
