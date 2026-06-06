import { expect, test } from "bun:test";
import { computeRequestBilling, type ParsedUsage } from "@eco/runtime";
import { ThreadUsageAccumulator } from "../src/main/thread-usage-accumulator";
import {
  InMemoryUsageLedger,
  type AgentInstanceRecord,
  type UsageLedgerEvent,
} from "../src/main/usage-ledger";
import {
  UsageLedgerCoordinator,
  type UsageLedgerCoordinatorStore,
} from "../src/main/usage-ledger-coordinator";
import { buildSingleUsageLedgerEvent } from "../src/main/usage-ledger-adapters";
import type { SubagentMetricsEntry } from "../src/main/subagent-metrics-registry";

const sonnetRates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
const haikuRates = { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 };

function usage(inputTokens = 10_000): ParsedUsage {
  return { inputTokens, outputTokens: 1_000, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

function createCoordinator(existingMetrics: SubagentMetricsEntry[] = []) {
  const ledger = new InMemoryUsageLedger();
  const logs: Array<{ topic: string; fields: Record<string, unknown> }> = [];
  const store: UsageLedgerCoordinatorStore = {
    appendUsageLedgerEvent(event: UsageLedgerEvent) {
      return ledger.appendUsageEvent(event).inserted;
    },
    listUsageLedgerEvents(threadId: string) {
      return ledger.listUsageEvents(threadId);
    },
    listAgentInstances(threadId: string): AgentInstanceRecord[] {
      return ledger.listAgentInstances(threadId);
    },
  };
  const coordinator = new UsageLedgerCoordinator({
    store,
    metrics: {
      listEntries: () => existingMetrics,
    },
    logDiag: (topic, fields) => logs.push({ topic, fields }),
    logDiagThrottled: (_key, topic, fields) => logs.push({ topic, fields }),
    writeError: (message) => {
      throw new Error(message);
    },
  });
  return { coordinator, ledger, logs };
}

test("UsageLedgerCoordinator flushes async partial writes before interrupted settlement", async () => {
  const { coordinator, ledger, logs } = createCoordinator();
  const partial = buildSingleUsageLedgerEvent({
    threadId: "thr_coord",
    role: "coder",
    source: "sdk",
    sourceEventId: "sdk-stream:event_1",
    usageKind: "request_partial",
    usage: usage(),
    computedBilling: computeRequestBilling(usage(), haikuRates, sonnetRates),
    runAttemptId: "attempt_1",
    agentId: "agent_coder",
    requestKey: "sdk-stream:event_1",
    modelId: "haiku",
  });

  coordinator.trackUsageUpdate(
    "thr_coord",
    Promise.resolve().then(() => {
      coordinator.appendEvents([partial]);
    }),
  );
  coordinator.queueInterruptedStreamSettlement("thr_coord", "attempt_1", "cancelled");

  await coordinator.flushUsageUpdates("thr_coord");

  const events = ledger.listUsageEvents("thr_coord");
  const finalEvents = events.filter((event) => event.usageKind === "request_final");
  expect(events.some((event) => event.usageKind === "request_partial")).toBe(true);
  expect(finalEvents).toHaveLength(1);
  expect(finalEvents[0]?.metadata).toMatchObject({
    settlement: "interrupted_stream_partial",
    settledFromEventId: partial.id,
    runStatus: "cancelled",
  });
  expect(logs).toContainEqual(
    expect.objectContaining({
      topic: "usage_ledger.partial_settlement",
    }),
  );

  await coordinator.flushUsageUpdates("thr_coord");
  expect(ledger.listUsageEvents("thr_coord").filter((event) => event.usageKind === "request_final")).toHaveLength(1);
});

test("UsageLedgerCoordinator enriches billing snapshots from ledger projection", () => {
  const { coordinator } = createCoordinator();
  const delta = usage();
  coordinator.appendEvents([
    buildSingleUsageLedgerEvent({
      threadId: "thr_projection",
      role: "coder",
      source: "proxy",
      sourceEventId: "proxy:coder:req_1",
      requestKey: "proxy:coder:req_1",
      usage: delta,
      computedBilling: computeRequestBilling(delta, haikuRates, sonnetRates),
      runAttemptId: "attempt_1",
      agentId: "agent_coder",
      modelId: "haiku",
    }),
  ]);

  const legacyBilling = new ThreadUsageAccumulator().recordUsage({
    threadId: "thr_projection",
    role: "coder",
    source: "proxy",
    delta,
    actualRates: haikuRates,
    plannerRates: sonnetRates,
    modelId: "haiku",
    requestKey: "proxy:coder:req_1",
  });
  const enriched = coordinator.enrichBillingSnapshot("thr_projection", legacyBilling);

  expect(enriched.subagents).toHaveLength(1);
  expect(enriched.subagents?.[0]).toMatchObject({
    agentId: "agent_coder",
    role: "coder",
    inputTokens: 10_000,
    outputTokens: 1_000,
    modelId: "haiku",
  });
});
