import { expect, test } from "bun:test";
import { emptyCostBreakdown } from "@eco/runtime";
import type {
  SubagentMetricsPersistenceRecord,
  SubagentMetricsPersistenceStore,
  UpsertSubagentMetricsPersistenceInput,
} from "../src/main/subagent-metrics-persistence";
import { SubagentMetricsStoreFacade } from "../src/main/subagent-metrics-registry-persistence";

const record: SubagentMetricsPersistenceRecord = {
  threadId: "thr_registry_persistence",
  agentId: "agent_coder",
  role: "coder",
  status: "stopped",
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 10,
  cacheCreationTokens: 5,
  contextOccupied: 135,
  contextLimit: 100_000,
  ecoCostUsd: 0.01,
  ecoCostBreakdown: emptyCostBreakdown(),
  modelId: "haiku",
  lastRequestKey: "sdk-result:event_1",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function createStoreStub(rows: SubagentMetricsPersistenceRecord[]) {
  const upserts: Array<{
    threadId: string;
    input: UpsertSubagentMetricsPersistenceInput;
  }> = [];
  const cleared: string[] = [];
  const store: SubagentMetricsPersistenceStore = {
    listSubagentMetrics: () => rows,
    upsertSubagentMetrics: (threadId, input) => {
      upserts.push({ threadId, input });
    },
    clearSubagentMetrics: (threadId) => {
      cleared.push(threadId);
    },
  };
  return { store, upserts, cleared };
}

test("SubagentMetricsStoreFacade restores entries and legacy usage contributions", () => {
  const { store } = createStoreStub([record]);
  const facade = new SubagentMetricsStoreFacade(store);

  const restored = facade.restoreThread("thr_registry_persistence");

  expect(restored).toEqual([
    {
      entry: {
        agentId: "agent_coder",
        role: "coder",
        status: "stopped",
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 10,
          cacheCreationTokens: 5,
        },
        contextOccupied: 135,
        contextLimit: 100_000,
        ecoCostUsd: 0.01,
        ecoCostBreakdown: emptyCostBreakdown(),
        modelId: "haiku",
        lastRequestKey: "sdk-result:event_1",
        updatedAt: Date.parse(record.updatedAt),
      },
      legacyUsageContribution: {
        agentId: "agent_coder",
        role: "coder",
        requestKey: "sdk-result:event_1",
        modelId: "haiku",
      },
    },
  ]);
});

test("SubagentMetricsStoreFacade persists entries through store mapper", () => {
  const { store, upserts } = createStoreStub([]);
  const facade = new SubagentMetricsStoreFacade(store);
  const [restored] = new SubagentMetricsStoreFacade(createStoreStub([record]).store).restoreThread(
    "thr_registry_persistence",
  );

  expect(restored).toBeDefined();
  if (!restored) {
    throw new Error("expected restored subagent metrics entry");
  }
  facade.persistEntry("thr_registry_persistence", restored.entry);

  expect(upserts).toEqual([
    {
      threadId: "thr_registry_persistence",
      input: {
        agentId: "agent_coder",
        role: "coder",
        status: "stopped",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 10,
        cacheCreationTokens: 5,
        contextOccupied: 135,
        contextLimit: 100_000,
        ecoCostUsd: 0.01,
        ecoCostBreakdown: emptyCostBreakdown(),
        modelId: "haiku",
        lastRequestKey: "sdk-result:event_1",
      },
    },
  ]);
});

test("SubagentMetricsStoreFacade clears thread metrics through store", () => {
  const { store, cleared } = createStoreStub([]);
  const facade = new SubagentMetricsStoreFacade(store);

  facade.clearThread("thr_registry_persistence");

  expect(cleared).toEqual(["thr_registry_persistence"]);
});
