import { expect, test } from "bun:test";
import { AGENT_AUDIT_EXPORT_SCHEMA, buildAgentAuditExportArchive } from "../src/main/agent-audit-export";
import type { OrchestrationProfile, ThreadBillingSnapshot, ThreadSummary } from "../src/shared/ipc";

const profile: OrchestrationProfile = {
  id: "profile_research",
  name: "Research Desk",
  preset: "research",
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
  strategy: { kind: "fixed", steps: [] },
  version: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  source: "user",
};

const thread: ThreadSummary = {
  id: "thr_audit",
  title: "Audit thread",
  prompt: "Run an auditable workflow.",
  workspacePath: "/workspace",
  status: "completed",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:02.000Z",
  message: "Done.",
  runtimeConfig: {
    routeProfileId: "profile_research",
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

const billing: ThreadBillingSnapshot = {
  totalTokens: { input: 100, output: 20, cacheRead: 0, cacheCreation: 0 },
  otelCostUsd: 0,
  plannerTokenCostUsd: 0.02,
  ecoCostUsd: 0.01,
  savedUsd: 0.01,
  savedPct: 50,
  pricingResolved: true,
};

test("buildAgentAuditExportArchive writes structured audit data", () => {
  const archive = buildAgentAuditExportArchive({
    exportedAt: "2026-01-01T00:00:03.000Z",
    appVersion: "0.0.0-test",
    threads: [thread],
    profiles: [profile],
    agentTemplates: [],
    profilePerformance: [
      {
        profileId: "profile_research",
        selectionId: "profile_research",
        profileName: "Research Desk",
        preset: "research",
        strategyKind: "fixed",
        source: "configured",
        runCount: 1,
        completedCount: 1,
        failedCount: 0,
        blockedCount: 0,
        idleCount: 0,
        activeCount: 0,
        successRatePct: 100,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 120,
        ecoCostUsd: 0.01,
        avgCostUsd: 0.01,
        latestRunAt: "2026-01-01T00:00:02.000Z",
        modelIds: [],
        workflowSteps: [],
        recentRuns: [],
      },
    ],
    getThreadBilling: () => billing,
    getThreadRunProjection: () => undefined,
    listThreadActivity: () => [{ id: "activity_1", role: "planner", message: "Started." }],
    listRunAttempts: () => [
      {
        threadId: "thr_audit",
        attemptId: "attempt_1",
        phase: "execution",
        retryIndex: 0,
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:02.000Z",
      },
    ],
    listAgentInstances: () => [],
    listUsageLedgerEvents: () => [
      {
        id: "ule_1",
        idempotencyKey: "sdk:req",
        threadId: "thr_audit",
        source: "sdk",
        sourceEventId: "sdk:req",
        usageKind: "request_final",
        role: "planner",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        observedAt: "2026-01-01T00:00:02.000Z",
        attribution: { status: "unattributed", reason: "test" },
      },
    ],
  });

  expect(archive.schema).toBe(AGENT_AUDIT_EXPORT_SCHEMA);
  expect(archive.summary).toEqual({
    threadCount: 1,
    profileCount: 1,
    agentTemplateCount: 0,
  });
  expect(archive.threads[0]?.profile).toMatchObject({
    profileId: "profile_research",
    selectionId: "profile_research",
    name: "Research Desk",
    strategyKind: "fixed",
  });
  expect(archive.threads[0]?.billing?.ecoCostUsd).toBe(0.01);
  expect(archive.threads[0]?.activity).toHaveLength(1);
  expect(archive.threads[0]?.usageLedgerEvents[0]?.source).toBe("sdk");
});
