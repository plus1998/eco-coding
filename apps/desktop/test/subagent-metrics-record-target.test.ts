import { expect, test } from "bun:test";
import type { AgentRole } from "../src/shared/ipc";
import {
  resolveSubagentMetricsRecordTarget,
  type SubagentMetricsRecordTargetResolver,
} from "../src/main/subagent-metrics-record-target";

function resolver(
  input: {
    resolve?: (request: {
      role: AgentRole;
      subagentAgentId?: string;
      parentToolUseId?: string;
    }) => string | undefined;
    roleFor?: (agentId: string) => AgentRole | undefined;
    resolveCalls?: Array<{ role: AgentRole; subagentAgentId?: string; parentToolUseId?: string }>;
    roleCalls?: string[];
  } = {},
): SubagentMetricsRecordTargetResolver {
  return {
    resolveAgentId: (_threadId, request) => {
      input.resolveCalls?.push(request);
      return input.resolve?.(request);
    },
    roleForAgentId: (_threadId, agentId) => {
      input.roleCalls?.push(agentId);
      return input.roleFor?.(agentId);
    },
  };
}

test("resolveSubagentMetricsRecordTarget returns resolved subagent role and agent", () => {
  const target = resolveSubagentMetricsRecordTarget({
    threadId: "thr_metrics_target",
    role: "planner",
    resolver: resolver({
      resolve: () => "agent_coder",
      roleFor: () => "coder",
    }),
    parentToolUseId: "toolu_parent",
  });

  expect(target).toEqual({ agentId: "agent_coder", role: "coder" });
});

test("resolveSubagentMetricsRecordTarget forwards explicit agent and parent tool use", () => {
  const resolveCalls: Array<{
    role: AgentRole;
    subagentAgentId?: string;
    parentToolUseId?: string;
  }> = [];

  resolveSubagentMetricsRecordTarget({
    threadId: "thr_metrics_target",
    role: "reviewer",
    resolver: resolver({
      resolveCalls,
      resolve: () => "agent_reviewer",
      roleFor: () => "reviewer",
    }),
    agentId: "agent_reviewer",
    parentToolUseId: "toolu_parent",
  });

  expect(resolveCalls).toEqual([
    {
      role: "reviewer",
      subagentAgentId: "agent_reviewer",
      parentToolUseId: "toolu_parent",
    },
  ]);
});

test("resolveSubagentMetricsRecordTarget skips unresolved agents without role lookup", () => {
  const roleCalls: string[] = [];

  const target = resolveSubagentMetricsRecordTarget({
    threadId: "thr_metrics_target",
    role: "coder",
    resolver: resolver({ roleCalls }),
  });

  expect(target).toBeUndefined();
  expect(roleCalls).toEqual([]);
});

test("resolveSubagentMetricsRecordTarget rejects non-subagent registry roles", () => {
  const target = resolveSubagentMetricsRecordTarget({
    threadId: "thr_metrics_target",
    role: "coder",
    resolver: resolver({
      resolve: () => "agent_planner_like",
      roleFor: () => "planner",
    }),
  });

  expect(target).toBeUndefined();
});
