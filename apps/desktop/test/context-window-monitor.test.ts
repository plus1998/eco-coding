import { expect, test } from "bun:test";
import { effectiveContextLimit } from "@eco/runtime";
import { ContextWindowMonitor } from "../src/main/context-window-monitor";
import type { ModelsDevPricingCache } from "../src/main/models-dev-pricing-cache";

function mockCache(limit = 100_000, resolved = true): ModelsDevPricingCache {
  return {
    resolveContextLimit: async () => ({
      limit,
      limitsResolved: resolved,
    }),
  } as ModelsDevPricingCache;
}

function effectiveLimit(catalogLimit: number): number {
  return effectiveContextLimit(catalogLimit);
}

function roleAwareMockCache(): ModelsDevPricingCache {
  return {
    resolveContextLimit: async (_baseUrl: string, modelId: string) => ({
      limit: modelId === "coder-model" ? 40_000 : 100_000,
      limitsResolved: true,
    }),
  } as ModelsDevPricingCache;
}

test("shouldCompact when above threshold", async () => {
  const monitor = new ContextWindowMonitor(mockCache(100_000));
  await monitor.updateFromUsage(
    "t1",
    {
      inputTokens: 90_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
    { modelId: "claude-sonnet", providerBaseUrl: "https://api.anthropic.com" },
  );
  expect(monitor.shouldCompact("t1")).toBe(true);
});

test("markCompactCompleted resets occupancy and cooldown", async () => {
  const monitor = new ContextWindowMonitor(mockCache());
  await monitor.updateFromUsage("t1", {
    inputTokens: 90_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  });
  monitor.markCompactCompleted("t1", 20_000);
  expect(monitor.getSnapshot("t1")?.occupied).toBe(20_000);
  expect(monitor.shouldCompact("t1")).toBe(false);
});

test("prefers planner display while retaining subagent role snapshots", async () => {
  const monitor = new ContextWindowMonitor(mockCache());
  await monitor.updateFromUsage(
    "t1",
    { inputTokens: 500_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { role: "planner" },
  );
  await monitor.updateFromUsage(
    "t1",
    { inputTokens: 80_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { role: "coder" },
  );
  const snapshot = monitor.getSnapshot("t1");
  expect(snapshot?.occupied).toBe(500_000);
  expect(snapshot?.displayRole).toBe("planner");
  expect(snapshot?.roles.map((role) => role.role)).toEqual(["planner", "coder"]);
  expect(snapshot?.roles.find((role) => role.role === "coder")?.occupied).toBe(80_000);
});

test("resolves context limits per role model", async () => {
  const monitor = new ContextWindowMonitor(roleAwareMockCache());
  await monitor.updateFromUsage(
    "t1",
    { inputTokens: 20_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { role: "planner", modelId: "planner-model", providerBaseUrl: "https://api.example" },
  );
  await monitor.updateFromUsage(
    "t1",
    { inputTokens: 20_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { role: "coder", modelId: "coder-model", providerBaseUrl: "https://api.example" },
  );
  const snapshot = monitor.getSnapshot("t1");
  expect(snapshot?.roles.find((role) => role.role === "planner")?.limit).toBe(effectiveLimit(100_000));
  expect(snapshot?.roles.find((role) => role.role === "coder")?.limit).toBe(effectiveLimit(40_000));
});

test("shouldCompact ignores high subagent occupancy", async () => {
  const monitor = new ContextWindowMonitor(mockCache(100_000));
  await monitor.updateFromUsage(
    "t1",
    { inputTokens: 10_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { role: "planner", modelId: "planner-model", providerBaseUrl: "https://api.example" },
  );
  await monitor.updateFromUsage(
    "t1",
    { inputTokens: 95_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { role: "coder", modelId: "coder-model", providerBaseUrl: "https://api.example" },
  );
  expect(monitor.shouldCompact("t1")).toBe(false);
});

test("clearSubagentRoles preserves planner and drops stale child windows", async () => {
  const monitor = new ContextWindowMonitor(mockCache(100_000));
  await monitor.updateFromUsage(
    "t1",
    { inputTokens: 10_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { role: "planner" },
  );
  await monitor.updateFromUsage(
    "t1",
    { inputTokens: 50_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { role: "explore" },
  );
  await monitor.updateFromUsage(
    "t1",
    { inputTokens: 70_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { role: "coder", agentId: "coder-1" },
  );

  const snapshot = monitor.clearSubagentRoles("t1");

  expect(snapshot?.roles.map((role) => role.role)).toEqual(["planner"]);
  expect(snapshot?.occupied).toBe(10_000);
  expect(snapshot?.instances).toEqual([]);
});

test("restores multi-role context snapshots", () => {
  const monitor = new ContextWindowMonitor(mockCache());
  monitor.restoreFromContextSnapshot("t1", {
    occupied: 10_000,
    limit: 100_000,
    occupancyPct: 10,
    limitsResolved: true,
    displayRole: "planner",
    segments: [],
    roles: [
      {
        role: "planner",
        occupied: 10_000,
        limit: 100_000,
        occupancyPct: 10,
        limitsResolved: true,
        segments: [],
      },
      {
        role: "coder",
        occupied: 30_000,
        limit: 40_000,
        occupancyPct: 75,
        limitsResolved: true,
        modelId: "coder-model",
        segments: [],
      },
    ],
    instances: [
      {
        agentId: "coder-agent-1",
        role: "coder",
        occupied: 12_000,
        limit: 40_000,
        occupancyPct: 30,
        limitsResolved: true,
        modelId: "coder-model",
        segments: [],
        updatedAt: Date.now(),
      },
    ],
    updatedAt: Date.now(),
  });
  const snapshot = monitor.getSnapshot("t1");
  expect(snapshot?.displayRole).toBe("planner");
  expect(snapshot?.roles.find((role) => role.role === "coder")?.modelId).toBe("coder-model");
  expect(snapshot?.instances?.[0]?.agentId).toBe("coder-agent-1");
});

test("tracks concurrent coder instances by agentId", async () => {
  const monitor = new ContextWindowMonitor(mockCache(100_000));
  await monitor.updateFromUsage(
    "t1",
    { inputTokens: 22_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { role: "coder", agentId: "coder-agent-1" },
  );
  await monitor.updateFromUsage(
    "t1",
    { inputTokens: 31_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { role: "coder", agentId: "coder-agent-2" },
  );

  const snapshot = monitor.getSnapshot("t1");
  expect(snapshot?.instances?.map((entry) => entry.agentId)).toEqual([
    "coder-agent-2",
    "coder-agent-1",
  ]);
  expect(snapshot?.instances?.map((entry) => entry.occupied)).toEqual([31_000, 22_000]);
});

test("dedupes assistant usage by messageId", async () => {
  const monitor = new ContextWindowMonitor(mockCache());
  await monitor.updateFromUsage(
    "t1",
    { inputTokens: 50_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { messageId: "msg-1" },
  );
  await monitor.updateFromUsage(
    "t1",
    { inputTokens: 30_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { messageId: "msg-1" },
  );
  expect(monitor.getSnapshot("t1")?.occupied).toBe(50_000);
});

test("updateOccupied sets planner occupancy from /context header", async () => {
  const monitor = new ContextWindowMonitor(mockCache());
  await monitor.updateFromUsage(
    "t1",
    { inputTokens: 36_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { role: "planner", modelId: "planner-model", providerBaseUrl: "https://api.example" },
  );
  await monitor.updateOccupied("t1", "planner", 76_000);
  expect(monitor.getSnapshot("t1")?.roles.find((role) => role.role === "planner")?.occupied).toBe(76_000);
});

test("shouldCompact uses effective context limit", async () => {
  const monitor = new ContextWindowMonitor(mockCache(200_000));
  const limit = effectiveLimit(200_000);
  await monitor.updateFromUsage(
    "t1",
    {
      inputTokens: Math.round(limit * 0.86),
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
    { role: "planner", modelId: "planner-model", providerBaseUrl: "https://api.example" },
  );
  expect(monitor.shouldCompact("t1")).toBe(true);
});
