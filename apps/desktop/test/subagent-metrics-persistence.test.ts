import { expect, test } from "bun:test";
import { emptyCostBreakdown } from "@eco/runtime";
import {
  buildSubagentUsageContributionKey,
  subagentMetricsEntryFromPersistenceRecord,
  subagentMetricsEntryToPersistenceInput,
  type SubagentMetricsPersistenceRecord,
} from "../src/main/subagent-metrics-persistence";

const record: SubagentMetricsPersistenceRecord = {
  threadId: "thr_metrics",
  agentId: "agent_coder",
  role: "coder",
  status: "active",
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 10,
  cacheCreationTokens: 5,
  contextOccupied: 135,
  contextLimit: 100_000,
  ecoCostUsd: 0.01,
  ecoCostBreakdown: emptyCostBreakdown(),
  modelId: "haiku",
  lastRequestKey: "proxy:coder:req_1",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("subagent metrics persistence maps records and upsert inputs", () => {
  const entry = subagentMetricsEntryFromPersistenceRecord(record);

  expect(entry).toMatchObject({
    agentId: "agent_coder",
    role: "coder",
    status: "active",
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
    },
    contextOccupied: 135,
    contextLimit: 100_000,
    ecoCostUsd: 0.01,
    modelId: "haiku",
    lastRequestKey: "proxy:coder:req_1",
  });
  expect(entry.updatedAt).toBe(Date.parse(record.updatedAt));
  expect(subagentMetricsEntryToPersistenceInput(entry)).toEqual({
    agentId: "agent_coder",
    role: "coder",
    status: "active",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 10,
    cacheCreationTokens: 5,
    contextOccupied: 135,
    contextLimit: 100_000,
    ecoCostUsd: 0.01,
    ecoCostBreakdown: emptyCostBreakdown(),
    modelId: "haiku",
    lastRequestKey: "proxy:coder:req_1",
  });
});

test("buildSubagentUsageContributionKey is stable by agent role request and model", () => {
  expect(
    buildSubagentUsageContributionKey(
      { requestKey: "sdk-result:event_1", modelId: "haiku" },
      { agentId: "agent_coder", role: "coder" },
    ),
  ).toBe("agent_coder\u001fcoder\u001fsdk-result:event_1\u001fhaiku");
  expect(
    buildSubagentUsageContributionKey(
      { requestKey: "sdk-result:event_1", usage: { modelId: "sonnet" } },
      { agentId: "agent_coder", role: "coder" },
    ),
  ).toBe("agent_coder\u001fcoder\u001fsdk-result:event_1\u001fsonnet");
});
