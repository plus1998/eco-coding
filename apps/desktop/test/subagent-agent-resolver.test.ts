import { expect, test } from "bun:test";
import { resolveSubagentAgentId } from "../src/main/subagent-agent-resolver";

test("resolveSubagentAgentId prefers explicit agent id", () => {
  expect(
    resolveSubagentAgentId({
      role: "planner",
      explicitAgentId: " agent_explicit ",
      linkedParentAgentId: "agent_parent",
      hasThreadState: false,
    }),
  ).toEqual({ agentId: "agent_explicit" });
});

test("resolveSubagentAgentId maps linked parent tool use before role checks", () => {
  expect(
    resolveSubagentAgentId({
      role: "planner",
      parentToolUseId: "toolu_task",
      linkedParentAgentId: "agent_explore",
      hasThreadState: true,
    }),
  ).toEqual({ agentId: "agent_explore" });
});

test("resolveSubagentAgentId skips non-subagent roles without a parent link", () => {
  expect(
    resolveSubagentAgentId({
      role: "planner",
      hasThreadState: true,
      activeAgentIds: ["agent_planner_like"],
    }),
  ).toEqual({});
});

test("resolveSubagentAgentId reports missing thread state", () => {
  expect(
    resolveSubagentAgentId({
      role: "coder",
      hasThreadState: false,
    }),
  ).toEqual({ missReason: "no_thread_state", activeAgentIds: [] });
});

test("resolveSubagentAgentId falls back to the sole active agent for the role", () => {
  expect(
    resolveSubagentAgentId({
      role: "coder",
      hasThreadState: true,
      activeAgentIds: ["agent_coder_a"],
    }),
  ).toEqual({ agentId: "agent_coder_a" });
});

test("resolveSubagentAgentId treats multiple active agents as ambiguous", () => {
  expect(
    resolveSubagentAgentId({
      role: "coder",
      hasThreadState: true,
      activeAgentIds: ["agent_coder_a", "agent_coder_b"],
    }),
  ).toEqual({
    missReason: "ambiguous_multiple_active",
    activeAgentIds: ["agent_coder_a", "agent_coder_b"],
  });
});

test("resolveSubagentAgentId treats an unmapped parent with multiple active agents as parent miss", () => {
  expect(
    resolveSubagentAgentId({
      role: "coder",
      parentToolUseId: "toolu_task",
      hasThreadState: true,
      activeAgentIds: ["agent_coder_a", "agent_coder_b"],
    }),
  ).toEqual({
    missReason: "parent_tool_use_unmapped",
    activeAgentIds: ["agent_coder_a", "agent_coder_b"],
  });
});

test("resolveSubagentAgentId falls back to the sole stopped agent for the role", () => {
  expect(
    resolveSubagentAgentId({
      role: "reviewer",
      hasThreadState: true,
      activeAgentIds: [],
      stoppedAgentIdsForRole: ["agent_reviewer_done"],
    }),
  ).toEqual({ agentId: "agent_reviewer_done" });
});

test("resolveSubagentAgentId reports no active subagent when no fallback is available", () => {
  expect(
    resolveSubagentAgentId({
      role: "tester",
      hasThreadState: true,
      activeAgentIds: [],
      stoppedAgentIdsForRole: [],
    }),
  ).toEqual({ missReason: "no_active_subagent", activeAgentIds: [] });
});
