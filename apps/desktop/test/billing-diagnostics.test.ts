import { expect, test } from "bun:test";
import { buildBillingDiagnostics, withBillingDiagnostics } from "../src/main/billing-diagnostics";
import type { ThreadBillingSnapshot } from "../src/shared/ipc";
import type { BillingProjectionReconciliationResult } from "../src/main/billing-projector-reconciliation";

function billing(input: Partial<ThreadBillingSnapshot> = {}): ThreadBillingSnapshot {
  return {
    totalTokens: input.totalTokens ?? { input: 100, output: 20, cacheRead: 0, cacheCreation: 0 },
    sourceReportedCostUsd: input.sourceReportedCostUsd ?? 0,
    plannerTokenCostUsd: input.plannerTokenCostUsd ?? 0.01,
    ecoCostUsd: input.ecoCostUsd ?? 0.005,
    savedUsd: input.savedUsd ?? 0.005,
    savedPct: input.savedPct ?? 50,
    pricingResolved: input.pricingResolved ?? true,
    ...(input.primarySource && { primarySource: input.primarySource }),
    ...(input.sourceBreakdown && { sourceBreakdown: input.sourceBreakdown }),
  };
}

test("buildBillingDiagnostics reports unresolved pricing", () => {
  const diagnostics = buildBillingDiagnostics(billing({ pricingResolved: false }));

  expect(diagnostics).toEqual([
    expect.objectContaining({
      type: "pricing_unresolved",
      severity: "warning",
    }),
  ]);
});

test("withBillingDiagnostics attaches projection reconciliation drift", () => {
  const reconciliation: BillingProjectionReconciliationResult = {
    ok: false,
    issues: [
      {
        type: "token_mismatch",
        severity: "error",
        field: "input",
        projectionValue: 100,
        legacyValue: 120,
        delta: -20,
      },
      {
        type: "subagent_cost_mismatch",
        severity: "error",
        agentId: "agent_researcher",
        field: "subagent.ecoCostUsd",
        projectionValue: 0.01,
        legacyValue: 0.02,
        delta: -0.01,
      },
    ],
  };

  const snapshot = withBillingDiagnostics(billing(), { projectionReconciliation: reconciliation });

  expect(snapshot.diagnostics).toEqual([
    expect.objectContaining({
      type: "token_mismatch",
      severity: "error",
      field: "input",
      delta: -20,
    }),
    expect.objectContaining({
      type: "subagent_metrics_mismatch",
      severity: "error",
      agentId: "agent_researcher",
      delta: -0.01,
    }),
  ]);
});

test("buildBillingDiagnostics scopes unattributed counts to proxy primary ledger", () => {
  const diagnostics = buildBillingDiagnostics(billing(), undefined, [
    {
      id: "evt_proxy_unattr",
      threadId: "thr_diag",
      source: "proxy",
      role: "researcher",
      inputTokens: 4000,
      outputTokens: 300,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      observedAt: "2026-01-01T00:00:00.000Z",
      attribution: { status: "unattributed", reason: "pending_agent_settlement_timeout" },
      sourceEventId: "proxy:researcher:1",
    },
    {
      id: "evt_sdk_unattr",
      threadId: "thr_diag",
      source: "sdk",
      role: "researcher",
      inputTokens: 90000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      observedAt: "2026-01-01T00:00:01.000Z",
      attribution: { status: "unattributed", reason: "agent_id_missing" },
      sourceEventId: "sdk:researcher:1",
    },
  ]);

  expect(diagnostics).toEqual([
    expect.objectContaining({
      type: "unattributed_usage",
      count: 1,
      message: expect.stringContaining("主账有 1 笔 Proxy"),
    }),
  ]);
  expect(diagnostics[0]?.message).toContain("校验源另有 1 笔");
});

test("buildBillingDiagnostics reports shadow-only unattributed as info", () => {
  const diagnostics = buildBillingDiagnostics(billing(), undefined, [
    {
      id: "evt_sdk_unattr",
      threadId: "thr_diag",
      source: "sdk",
      role: "researcher",
      inputTokens: 90000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      observedAt: "2026-01-01T00:00:01.000Z",
      attribution: { status: "unattributed", reason: "agent_id_missing" },
      sourceEventId: "sdk:researcher:1",
    },
  ]);

  expect(diagnostics).toEqual([
    expect.objectContaining({
      type: "shadow_reconciliation",
      severity: "info",
      count: 1,
      message: expect.stringContaining("可忽略"),
    }),
  ]);
});
