import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConversationStore } from "../src/main/conversation-store";
import { SubagentMetricsRegistry } from "../src/main/subagent-metrics-registry";
import { emptyCostBreakdown } from "@eco/runtime";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

test.skipIf(!sqliteAvailable)("resolves agent via parent tool_use_id and persists metrics", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-subagent-metrics-"));
  const store = await createConversationStore(path.join(dir, "eco.sqlite"));
  const registry = new SubagentMetricsRegistry(store);
  const threadId = "thr_subagent_metrics";

  registry.noteTaskToolUse(threadId, "toolu_task_1");
  registry.onSubagentStart(threadId, { agentId: "agent_explore_a", role: "explore" });

  const resolved = registry.resolveAgentId(threadId, {
    role: "explore",
    parentToolUseId: "toolu_task_1",
  });
  expect(resolved).toBe("agent_explore_a");

  registry.recordSdkUsage(threadId, {
    role: "explore",
    agentId: "agent_explore_a",
    usage: {
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheCreationTokens: 10,
    },
    contextOccupied: 1060,
    contextLimit: 200_000,
    billing: {
      ecoCostUsd: 0.01,
      plannerTokenCostUsd: 0,
      ecoBreakdown: emptyCostBreakdown(),
      plannerBreakdown: emptyCostBreakdown(),
      pricingResolved: false,
    },
    modelId: "claude-test",
    requestKey: "sdk-result:evt_1",
  });

  const rows = store.listSubagentMetrics(threadId);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.agent_id).toBe("agent_explore_a");
  expect(rows[0]?.input_tokens).toBe(1000);
  expect(rows[0]?.eco_cost_usd).toBe(0.01);

  registry.onSubagentStop(threadId, { agentId: "agent_explore_a", role: "explore" });
  const restored = new SubagentMetricsRegistry(store);
  restored.restoreFromStore(threadId);
  const entries = restored.listEntries(threadId);
  expect(entries[0]?.status).toBe("stopped");
  expect(entries[0]?.usage.inputTokens).toBe(1000);
});

test("resolveAgentId maps parent tool_use_id even when event role is planner", () => {
  const store = { listSubagentMetrics: () => [], upsertSubagentMetrics: () => {} } as never;
  const registry = new SubagentMetricsRegistry(store);
  const threadId = "thr_parent_planner";
  registry.noteTaskToolUse(threadId, "toolu_task_2");
  registry.onSubagentStart(threadId, { agentId: "agent_explore_b", role: "explore" });
  expect(
    registry.resolveAgentId(threadId, {
      role: "planner",
      parentToolUseId: "toolu_task_2",
    }),
  ).toBe("agent_explore_b");
});

test.skipIf(!sqliteAvailable)("falls back to sole active subagent for role", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-subagent-resolve-"));
  const store = await createConversationStore(path.join(dir, "eco.sqlite"));
  const registry = new SubagentMetricsRegistry(store);
  const threadId = "thr_resolve";

  registry.onSubagentStart(threadId, { agentId: "agent_coder_a", role: "coder" });
  expect(registry.resolveAgentId(threadId, { role: "coder" })).toBe("agent_coder_a");
});
