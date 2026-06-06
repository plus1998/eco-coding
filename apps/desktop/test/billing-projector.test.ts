import { expect, test } from "bun:test";
import { computeRequestBilling, type ParsedUsage } from "@eco/runtime";
import {
  projectBillingFromUsageLedger,
} from "../src/main/billing-projector";
import {
  buildSdkUsageLedgerEvents,
  buildSingleUsageLedgerEvent,
} from "../src/main/usage-ledger-adapters";
import type { AgentInstanceRecord } from "../src/main/usage-ledger";

const sonnetRates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
const haikuRates = { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 };

function billingFor(usage: ParsedUsage, actualRates = haikuRates) {
  return computeRequestBilling(usage, actualRates, sonnetRates);
}

test("projectBillingFromUsageLedger builds SDK primary without duplicating request total cost", () => {
  const sonnetUsage = { inputTokens: 10_000, outputTokens: 1_000, cacheReadTokens: 0, cacheCreationTokens: 0 };
  const haikuUsage = { inputTokens: 20_000, outputTokens: 2_000, cacheReadTokens: 0, cacheCreationTokens: 0 };
  const events = buildSdkUsageLedgerEvents({
    threadId: "thr_projector",
    role: "planner",
    requestKey: "sdk-result:multi",
    totalCostUsd: 0.19,
    models: [
      {
        role: "planner",
        modelId: "sonnet",
        usage: sonnetUsage,
        computedBilling: billingFor(sonnetUsage, sonnetRates),
      },
      {
        role: "coder",
        modelId: "haiku",
        usage: haikuUsage,
        computedBilling: billingFor(haikuUsage, haikuRates),
      },
    ],
  });

  const projection = projectBillingFromUsageLedger({ events, plannerModelLabel: "sonnet" });

  expect(projection.snapshot?.primarySource).toBe("sdk");
  expect(projection.snapshot?.totalTokens.input).toBe(30_000);
  expect(projection.snapshot?.sourceBreakdown?.sdk?.reportedCostUsd).toBe(0.19);
  expect(projection.snapshot?.byRole?.coder?.inputTokens).toBe(20_000);
  expect(projection.snapshot?.byModel?.map((entry) => entry.modelId).sort()).toEqual(["haiku", "sonnet"]);
  expect(projection.snapshot?.ecoCostUsd).toBeCloseTo(0.069, 4);
  expect(projection.snapshot?.plannerTokenCostUsd).toBeCloseTo(0.135, 4);
});

test("projectBillingFromUsageLedger projects agent subagent and run attempt totals", () => {
  const usage = { inputTokens: 10_000, outputTokens: 1_000, cacheReadTokens: 0, cacheCreationTokens: 0 };
  const events = [
    buildSingleUsageLedgerEvent({
      threadId: "thr_projector",
      role: "coder",
      source: "proxy",
      sourceEventId: "proxy:coder:req_1",
      requestKey: "proxy:coder:req_1",
      usage,
      computedBilling: billingFor(usage),
      runAttemptId: "attempt_1",
      agentId: "agent_coder",
      parentToolUseId: "toolu_parent",
      modelId: "haiku",
      reportedCostUsd: 0.02,
    }),
  ];
  const agents: AgentInstanceRecord[] = [
    {
      threadId: "thr_projector",
      agentId: "agent_coder",
      role: "coder",
      kind: "subagent",
      status: "stopped",
      runAttemptId: "attempt_1",
      parentAgentId: "planner:attempt_1",
      parentToolUseId: "toolu_parent",
      missionKey: "implement",
      todoId: "todo-1",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
    },
  ];

  const projection = projectBillingFromUsageLedger({ events, agents });

  expect(projection.byAgent.agent_coder?.inputTokens).toBe(10_000);
  expect(projection.byAgent.agent_coder?.parentToolUseId).toBe("toolu_parent");
  expect(projection.byAgent.agent_coder?.reportedCostUsd).toBe(0.02);
  expect(projection.byRunAttempt.attempt_1?.inputTokens).toBe(10_000);
  expect(projection.byRunAttempt.attempt_1?.reportedCostUsd).toBe(0.02);
  expect(projection.snapshot?.subagents?.[0]?.agentId).toBe("agent_coder");
  expect(projection.snapshot?.subagents?.[0]?.status).toBe("stopped");
  expect(projection.snapshot?.subagents?.[0]?.modelId).toBe("haiku");
});

test("projectBillingFromUsageLedger exposes unattributed unresolved usage", () => {
  const event = buildSingleUsageLedgerEvent({
    threadId: "thr_projector",
    role: "coder",
    source: "otel",
    sourceEventId: "otel:unattributed",
    usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0 },
    modelId: "unknown-model",
  });

  const projection = projectBillingFromUsageLedger({ events: [event] });

  expect(projection.unattributedEvents).toHaveLength(1);
  expect(projection.unresolvedEventCount).toBe(1);
  expect(projection.snapshot?.pricingResolved).toBe(false);
  expect(projection.snapshot?.ecoCostUsd).toBe(0);
});

test("projectBillingFromUsageLedger can compute billing with a rate resolver", () => {
  const event = buildSingleUsageLedgerEvent({
    threadId: "thr_projector",
    role: "coder",
    source: "proxy",
    sourceEventId: "proxy:resolver",
    usage: { inputTokens: 10_000, outputTokens: 1_000, cacheReadTokens: 0, cacheCreationTokens: 0 },
    modelId: "haiku",
    agentId: "agent_coder",
  });

  const projection = projectBillingFromUsageLedger({
    events: [event],
    resolveRates: () => ({ actualRates: haikuRates, plannerRates: sonnetRates }),
  });

  expect(projection.unresolvedEventCount).toBe(0);
  expect(projection.snapshot?.ecoCostUsd).toBeCloseTo(0.012, 4);
  expect(projection.snapshot?.plannerTokenCostUsd).toBeCloseTo(0.045, 4);
});

test("projectBillingFromUsageLedger keeps partial and context events out of billable totals", () => {
  const partial = buildSingleUsageLedgerEvent({
    threadId: "thr_projector",
    role: "coder",
    source: "sdk",
    sourceEventId: "sdk-stream:partial-1",
    usageKind: "request_partial",
    usage: { inputTokens: 10_000, outputTokens: 1_000, cacheReadTokens: 0, cacheCreationTokens: 0 },
    computedBilling: billingFor({ inputTokens: 10_000, outputTokens: 1_000, cacheReadTokens: 0, cacheCreationTokens: 0 }),
    agentId: "agent_coder",
    modelId: "haiku",
  });
  const context = buildSingleUsageLedgerEvent({
    threadId: "thr_projector",
    role: "planner",
    source: "sdk",
    sourceEventId: "compact:1",
    usageKind: "context",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    agentId: "planner_1",
  });

  const projection = projectBillingFromUsageLedger({ events: [partial, context] });

  expect(projection.snapshot).toBeUndefined();
  expect(projection.unsettledPartialEvents).toEqual([partial]);
  expect(projection.contextEvents).toEqual([context]);
  expect(projection.byAgent).toEqual({});
});
