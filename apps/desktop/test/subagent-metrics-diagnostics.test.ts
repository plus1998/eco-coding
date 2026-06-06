import { expect, test } from "bun:test";
import { SubagentMetricsDiagnostics } from "../src/main/subagent-metrics-diagnostics";

function createDiagnosticsCapture() {
  const records: Array<{ topic: string; fields: Record<string, unknown> }> = [];
  return {
    records,
    diagnostics: new SubagentMetricsDiagnostics((topic, fields) => {
      records.push({ topic, fields });
    }),
  };
}

test("SubagentMetricsDiagnostics formats lifecycle diagnostics", () => {
  const { diagnostics, records } = createDiagnosticsCapture();

  diagnostics.logLifecycle({
    threadId: "thr_1234567890abcdef",
    event: "start",
    role: "coder",
    agentId: "agent_1234567890abcdef",
    activeCount: 2,
    toolUseLinks: 1,
  });

  expect(records).toEqual([
    {
      topic: "subagent.lifecycle",
      fields: {
        threadId: "7890abcdef",
        event: "start",
        role: "coder",
        agentId: "567890abcdef",
        activeCount: 2,
        toolUseLinks: 1,
      },
    },
  ]);
});

test("SubagentMetricsDiagnostics formats task tool diagnostics", () => {
  const { diagnostics, records } = createDiagnosticsCapture();

  diagnostics.logTaskTool({
    threadId: "thr_task_tool",
    toolUseId: "toolu_1234567890abcdef",
    role: "explore",
    pending: true,
    pendingCount: 3,
  });

  expect(records).toEqual([
    {
      topic: "subagent.task_tool",
      fields: {
        threadId: "task_tool",
        toolUseId: "567890abcdef",
        role: "explore",
        pending: true,
        pendingCount: 3,
      },
    },
  ]);
});

test("SubagentMetricsDiagnostics formats resolve miss diagnostics", () => {
  const { diagnostics, records } = createDiagnosticsCapture();

  diagnostics.logResolveMiss({
    threadId: "thr_resolve_miss",
    role: "coder",
    reason: "parent_tool_use_unmapped",
    parentToolUseId: "toolu_1234567890abcdef",
    activeAgentIds: ["agent_1234567890abcdef", "agent_short"],
    mappedParents: 4,
  });

  expect(records).toEqual([
    {
      topic: "subagent.resolve_miss",
      fields: {
        threadId: "solve_miss",
        role: "coder",
        reason: "parent_tool_use_unmapped",
        parentToolUseId: "567890abcdef",
        activeAgents: ["567890abcdef", "agent_short"],
        mappedParents: 4,
      },
    },
  ]);
});

test("SubagentMetricsDiagnostics formats usage dedupe diagnostics", () => {
  const { diagnostics, records } = createDiagnosticsCapture();

  diagnostics.logUsageDedupe({
    threadId: "thr_usage_dedupe",
    role: "coder",
    agentId: "agent_1234567890abcdef",
    requestKey: "sdk-result:event_1",
    modelId: "haiku",
  });

  expect(records).toEqual([
    {
      topic: "subagent.usage_dedupe",
      fields: {
        threadId: "age_dedupe",
        role: "coder",
        agentId: "567890abcdef",
        requestKey: "sdk-result:event_1",
        modelId: "haiku",
      },
    },
  ]);
});
