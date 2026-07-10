import { expect, test } from "bun:test";
import { reconcileSdkAgentTerminalEvent } from "../src/main/sdk-agent-terminal-reconciliation";

test("AgentOutput reconciles exact parent identity while terminal usage remains diagnostics-only", () => {
  const links: Array<{ parentToolUseId: string; agentId: string }> = [];
  const settlements: Array<Record<string, unknown>> = [];
  const diagnostics: Array<{ topic: string; fields: Record<string, unknown> }> = [];
  const handled = reconcileSdkAgentTerminalEvent(
    "thr_agent_output",
    {
      type: "agent.completed",
      agentId: "agent_general_output",
      role: "general-purpose",
      payload: {
        type: "agent_output",
        status: "completed",
        agentId: "agent_general_output",
        tool_use_id: "call_general_output",
        totalTokens: 700,
        totalToolUseCount: 4,
        totalDurationMs: 5000,
        usage: { input_tokens: 600, output_tokens: 100 },
      },
    },
    {
      linkParentToolUse(parentToolUseId, agentId) {
        links.push({ parentToolUseId, agentId });
      },
      settlePendingByParent(input) {
        settlements.push(input);
        return 1;
      },
      logDiagnostic: (topic, fields) => diagnostics.push({ topic, fields }),
    },
  );

  expect(handled).toBe(true);
  expect(links).toEqual([{ parentToolUseId: "call_general_output", agentId: "agent_general_output" }]);
  expect(settlements).toEqual([
    {
      agentId: "agent_general_output",
      role: "general-purpose",
      parentToolUseId: "call_general_output",
    },
  ]);
  expect(diagnostics.at(-1)).toMatchObject({
    topic: "subagent.agent_output_reconciliation",
    fields: {
      status: "reconciled",
      terminalTotalTokens: 700,
      settledUsageCount: 1,
      billingUsageApplied: false,
    },
  });
});

test("AgentOutput identity conflict is explicit and does not mutate attribution", () => {
  let mutationCount = 0;
  const diagnostics: Array<{ topic: string; fields: Record<string, unknown> }> = [];
  const handled = reconcileSdkAgentTerminalEvent(
    "thr_agent_output_conflict",
    {
      type: "agent.completed",
      agentId: "agent_event",
      role: "general-purpose",
      payload: {
        type: "agent_output",
        status: "completed",
        agentId: "agent_payload",
        tool_use_id: "call_conflict",
      },
    },
    {
      linkParentToolUse() {
        mutationCount += 1;
      },
      settlePendingByParent() {
        mutationCount += 1;
        return 0;
      },
      logDiagnostic: (topic, fields) => diagnostics.push({ topic, fields }),
    },
  );

  expect(handled).toBe(true);
  expect(mutationCount).toBe(0);
  expect(diagnostics.at(-1)).toMatchObject({
    topic: "subagent.agent_output_reconciliation",
    fields: {
      status: "identity_conflict",
      eventAgentId: "agent_event",
      payloadAgentId: "agent_payload",
      billingUsageApplied: false,
    },
  });
});
