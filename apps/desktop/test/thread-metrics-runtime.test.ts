import { expect, test } from "bun:test";
import type { ParsedUsage } from "@eco/runtime";
import type { ThreadContextSnapshot } from "../src/shared/ipc";
import type { ThreadMetricsRecord } from "../src/main/conversation-store";
import { ThreadUsageAccumulator } from "../src/main/thread-usage-accumulator";
import {
  buildPersistedThreadMetrics,
  flushThreadMetrics,
  persistThreadMetrics,
  restoreThreadMetricsFromStore,
  type PersistedThreadMetricsInput,
} from "../src/main/thread-metrics-runtime";
import type { UsageContextUpdateMonitor } from "../src/main/usage-context-effects";

const sonnetRates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

function usage(inputTokens = 1_000): ParsedUsage {
  return { inputTokens, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

function contextSnapshot(occupied = 1_000): ThreadContextSnapshot {
  return {
    occupied,
    limit: 100_000,
    occupancyPct: 1,
    limitsResolved: true,
    segments: [],
    updatedAt: 1,
  };
}

function serializedUsageState() {
  const accumulator = new ThreadUsageAccumulator();
  accumulator.recordUsage({
    threadId: "thr_metrics",
    role: "planner",
    delta: usage(),
    actualRates: sonnetRates,
    plannerRates: sonnetRates,
    requestKey: "request_1",
  });
  const serialized = accumulator.serializeState("thr_metrics");
  if (!serialized) {
    throw new Error("expected serialized usage state");
  }
  return serialized;
}

test("restoreThreadMetricsFromStore restores accumulator context and hydrates subagent context", () => {
  const serialized = serializedUsageState();
  const context = contextSnapshot();
  const records: ThreadMetricsRecord[] = [
    {
      threadId: "thr_metrics",
      accumulator: serialized,
      context,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const restoredAccumulator: unknown[] = [];
  const restoredContext: unknown[] = [];
  const restoredSubagents: string[] = [];
  const contextUpdates: Array<{ threadId: string; usage: ParsedUsage; options: unknown }> = [];
  const contextMonitor: UsageContextUpdateMonitor = {
    async updateFromUsage(threadId, nextUsage, options) {
      contextUpdates.push({ threadId, usage: nextUsage, options });
      return undefined as Awaited<ReturnType<UsageContextUpdateMonitor["updateFromUsage"]>>;
    },
  };

  restoreThreadMetricsFromStore({
    store: {
      listThreadMetrics: () => records,
    },
    accumulator: {
      restoreState: (threadId, data) => restoredAccumulator.push({ threadId, data }),
    },
    contextSnapshots: {
      restoreSnapshot: (threadId, snapshot) => restoredContext.push({ threadId, snapshot }),
    },
    subagentMetrics: {
      restoreFromStore: (threadId) => restoredSubagents.push(threadId),
      listEntries: () => [
        {
          agentId: "agent_coder",
          role: "coder",
          usage: usage(500),
          contextOccupied: 500,
          modelId: "haiku",
        },
        {
          agentId: "agent_empty",
          role: "coder",
          usage: usage(0),
          contextOccupied: 0,
        },
      ],
    },
    contextMonitor,
  });

  expect(restoredAccumulator).toHaveLength(1);
  expect(restoredContext).toEqual([{ threadId: "thr_metrics", snapshot: context }]);
  expect(restoredSubagents).toEqual(["thr_metrics"]);
  expect(contextUpdates).toHaveLength(1);
  expect(contextUpdates[0]).toMatchObject({
    threadId: "thr_metrics",
    options: {
      role: "coder",
      agentId: "agent_coder",
      modelId: "haiku",
    },
  });
});

test("buildPersistedThreadMetrics and persistThreadMetrics preserve snapshot shape", () => {
  const serialized = serializedUsageState();
  const context = contextSnapshot(2_000);
  const saved: Array<{ threadId: string; input: PersistedThreadMetricsInput }> = [];
  const services = {
    store: {
      saveThreadMetrics: (threadId: string, input: PersistedThreadMetricsInput) => {
        saved.push({ threadId, input });
      },
    },
    accumulator: {
      serializeState: () => serialized,
    },
    contextSnapshots: {
      getDisplaySnapshot: () => context,
    },
  };

  expect(buildPersistedThreadMetrics(services, "thr_metrics")).toEqual({
    accumulator: serialized,
    context,
  });
  persistThreadMetrics(services, "thr_metrics");

  expect(saved).toEqual([
    {
      threadId: "thr_metrics",
      input: {
        accumulator: serialized,
        context,
      },
    },
  ]);
});

test("flushThreadMetrics saves persisted and live threads with metrics", () => {
  const serialized = serializedUsageState();
  const context = contextSnapshot(3_000);
  const saved: string[] = [];
  const records: ThreadMetricsRecord[] = [
    { threadId: "thr_persisted", updatedAt: "2026-01-01T00:00:00.000Z" },
    { threadId: "thr_empty", updatedAt: "2026-01-01T00:00:00.000Z" },
  ];

  flushThreadMetrics({
    store: {
      listThreadMetrics: () => records,
      listThreads: () => [{ id: "thr_live" }, { id: "thr_empty" }],
      saveThreadMetrics: (threadId) => {
        saved.push(threadId);
      },
    },
    accumulator: {
      serializeState: (threadId) => (threadId === "thr_persisted" ? serialized : undefined),
    },
    contextSnapshots: {
      getDisplaySnapshot: (threadId) => (threadId === "thr_live" ? context : undefined),
    },
  });

  expect(saved).toEqual(["thr_persisted", "thr_live"]);
});
