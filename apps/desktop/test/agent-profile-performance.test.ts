import { expect, test } from "bun:test";
import { buildAgentProfilePerformanceSnapshots } from "../src/main/agent-profile-performance";
import type { OrchestrationProfile, ThreadBillingSnapshot, ThreadSummary } from "../src/shared/ipc";

function profile(input: Partial<OrchestrationProfile> & { id: string; name: string }): OrchestrationProfile {
  return {
    id: input.id,
    name: input.name,
    preset: input.preset ?? "research",
    mainAgent: {
      agentKey: "main",
      name: "Main Agent",
      domain: "research",
      systemPromptPreset: "custom",
      prompt: "Coordinate.",
      modelRef: { providerId: "anthropic", modelId: "main-model" },
      tools: { allowed: ["Agent"], disallowed: [] },
      skills: [],
    },
    agents: [],
    strategy: input.strategy ?? { kind: "fixed", steps: [] },
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: input.source ?? "user",
    ...(input.sourceRouteProfileId && { sourceRouteProfileId: input.sourceRouteProfileId }),
  };
}

function thread(input: Partial<ThreadSummary> & { id: string; profileId: string }): ThreadSummary {
  return {
    id: input.id,
    title: input.title ?? input.id,
    prompt: "Run profile.",
    workspacePath: "/workspace",
    status: input.status ?? "completed",
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-01-01T00:00:02.000Z",
    message: input.message ?? "Done.",
    runtimeConfig: {
      routeProfileId: input.profileId,
      orchestrationMode: "manual",
      subagentEnabled: {
        explore: true,
        architect: true,
        coder: true,
        reviewer: true,
        tester: true,
      },
    },
  };
}

function billing(input: Partial<ThreadBillingSnapshot> = {}): ThreadBillingSnapshot {
  return {
    totalTokens: {
      input: input.totalTokens?.input ?? 100,
      output: input.totalTokens?.output ?? 20,
      cacheRead: input.totalTokens?.cacheRead ?? 5,
      cacheCreation: input.totalTokens?.cacheCreation ?? 1,
    },
    otelCostUsd: input.otelCostUsd ?? 0,
    plannerTokenCostUsd: input.plannerTokenCostUsd ?? 0,
    ecoCostUsd: input.ecoCostUsd ?? 0.01,
    savedUsd: input.savedUsd ?? 0,
    savedPct: input.savedPct ?? 0,
    pricingResolved: input.pricingResolved ?? true,
    ...(input.byModel && { byModel: input.byModel }),
    ...(input.workflowSteps && { workflowSteps: input.workflowSteps }),
  };
}

test("buildAgentProfilePerformanceSnapshots aggregates configured and historical profiles", () => {
  const configured = profile({ id: "profile_research", name: "Research Desk" });
  const idle = profile({ id: "profile_idle", name: "Unused Profile", preset: "writing" });
  const billings = new Map<string, ThreadBillingSnapshot>([
    [
      "thr_done",
      billing({
        ecoCostUsd: 0.03,
        totalTokens: { input: 300, output: 60, cacheRead: 10, cacheCreation: 2 },
        byModel: [
          {
            modelId: "research-model",
            roles: ["coder"],
            inputTokens: 300,
            outputTokens: 60,
            cacheReadTokens: 10,
            cacheCreationTokens: 2,
            ecoCostUsd: 0.03,
            reportedCostUsd: 0,
          },
        ],
        workflowSteps: [
          {
            stepId: "research",
            agentKey: "researcher",
            outputKey: "research_notes",
            attempt: 1,
            batchIndex: 0,
            inputTokens: 200,
            outputTokens: 40,
            cacheReadTokens: 8,
            cacheCreationTokens: 1,
            ecoCostUsd: 0.02,
            modelIds: ["research-model"],
          },
        ],
      }),
    ],
    ["thr_failed", billing({ ecoCostUsd: 0.01 })],
    ["thr_deleted_profile", billing({ ecoCostUsd: 0.02 })],
  ]);

  const snapshots = buildAgentProfilePerformanceSnapshots({
    profiles: [configured, idle],
    threads: [
      thread({
        id: "thr_done",
        profileId: "profile_research",
        title: "Completed research",
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:02.000Z",
      }),
      thread({
        id: "thr_failed",
        profileId: "profile_research",
        status: "failed",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:04.000Z",
      }),
      thread({
        id: "thr_deleted_profile",
        profileId: "profile_deleted",
        status: "blocked",
      }),
    ],
    getBillingSnapshot: (threadId) => billings.get(threadId),
  });

  const research = snapshots.find((snapshot) => snapshot.profileId === "profile_research");
  expect(research).toMatchObject({
    profileName: "Research Desk",
    source: "configured",
    runCount: 2,
    completedCount: 1,
    failedCount: 1,
    successRatePct: 50,
    avgDurationMs: 3000,
    ecoCostUsd: 0.04,
    totalTokens: 498,
    modelIds: ["research-model"],
  });
  expect(research?.workflowSteps).toEqual([
    {
      stepId: "research",
      agentKey: "researcher",
      outputKey: "research_notes",
      runCount: 1,
      inputTokens: 200,
      outputTokens: 40,
      cacheReadTokens: 8,
      cacheCreationTokens: 1,
      totalTokens: 249,
      ecoCostUsd: 0.02,
      modelIds: ["research-model"],
    },
  ]);
  expect(research?.recentRuns.map((run) => run.threadId)).toEqual(["thr_failed", "thr_done"]);

  expect(snapshots.find((snapshot) => snapshot.profileId === "profile_idle")).toMatchObject({
    profileName: "Unused Profile",
    runCount: 0,
  });
  expect(snapshots.find((snapshot) => snapshot.selectionId === "profile_deleted")).toMatchObject({
    source: "historical",
    profileName: "已删除 Profile · profile_deleted",
    runCount: 1,
    blockedCount: 1,
  });
});
