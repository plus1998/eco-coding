import type { BillingUsageSource, ThreadBillingSnapshot } from "../shared/ipc";
import type { SubagentMetricsEntry } from "./subagent-metrics-registry";
import type { UsageLedgerBillingProjection } from "./billing-projector";
import { isSubagentBillingRole } from "./billing-orchestration";

export type BillingProjectionReconciliationSeverity = "error" | "info";

export type BillingProjectionReconciliationIssueType =
  | "missing_projection_snapshot"
  | "missing_legacy_billing"
  | "primary_source_mismatch"
  | "synthetic_sdk_primary"
  | "token_mismatch"
  | "cost_mismatch"
  | "subagent_missing_projection"
  | "subagent_missing_metrics"
  | "subagent_token_mismatch"
  | "subagent_cost_mismatch"
  | "unattributed_usage"
  | "unresolved_usage";

export interface BillingProjectionReconciliationIssue {
  type: BillingProjectionReconciliationIssueType;
  severity: BillingProjectionReconciliationSeverity;
  field?: string;
  source?: BillingUsageSource;
  agentId?: string;
  projectionValue?: number | string;
  legacyValue?: number | string;
  delta?: number;
  count?: number;
}

export interface BillingProjectionReconciliationResult {
  ok: boolean;
  issues: BillingProjectionReconciliationIssue[];
}

const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheCreation"] as const;
const TOKEN_FIELD_TO_SUBAGENT = {
  input: "inputTokens",
  output: "outputTokens",
  cacheRead: "cacheReadTokens",
  cacheCreation: "cacheCreationTokens",
} as const;
const COST_EPSILON = 0.000001;

export function reconcileBillingProjectionWithLegacy(
  projection: UsageLedgerBillingProjection,
  legacy: ThreadBillingSnapshot | undefined,
  input: {
    subagentMetrics?: readonly SubagentMetricsEntry[];
  } = {},
): BillingProjectionReconciliationResult {
  const issues: BillingProjectionReconciliationIssue[] = [];
  if (!legacy) {
    issues.push({ type: "missing_legacy_billing", severity: "error" });
  }
  if (!projection.snapshot) {
    issues.push({ type: "missing_projection_snapshot", severity: "error" });
  }
  if (!legacy || !projection.snapshot) {
    return buildResult(issues);
  }

  comparePrimarySource(projection.snapshot, legacy, issues);
  compareThreadTokens(projection.snapshot, legacy, issues);
  compareThreadCosts(projection.snapshot, legacy, issues);
  compareSubagentMetrics(projection, input.subagentMetrics ?? [], issues);

  if (projection.unattributedEvents.length > 0) {
    issues.push({
      type: "unattributed_usage",
      severity: "error",
      count: projection.unattributedEvents.length,
    });
  }
  if (projection.unresolvedEventCount > 0) {
    issues.push({
      type: "unresolved_usage",
      severity: "error",
      count: projection.unresolvedEventCount,
    });
  }

  return buildResult(issues);
}

export function summarizeBillingProjectionReconciliation(
  result: BillingProjectionReconciliationResult,
): Record<string, unknown> {
  return {
    ok: result.ok,
    issues: result.issues.map((issue) => ({
      type: issue.type,
      severity: issue.severity,
      ...(issue.field && { field: issue.field }),
      ...(issue.source && { source: issue.source }),
      ...(issue.agentId && { agentId: issue.agentId }),
      ...(issue.delta !== undefined && { delta: issue.delta }),
      ...(issue.count !== undefined && { count: issue.count }),
      ...(issue.projectionValue !== undefined && { projectionValue: issue.projectionValue }),
      ...(issue.legacyValue !== undefined && { legacyValue: issue.legacyValue }),
    })),
  };
}

function comparePrimarySource(
  projection: ThreadBillingSnapshot,
  legacy: ThreadBillingSnapshot,
  issues: BillingProjectionReconciliationIssue[],
): void {
  if (projection.primarySource === legacy.primarySource) {
    if (hasSyntheticSdkCompatibilityBreakdown(projection, legacy)) {
      issues.push({
        type: "synthetic_sdk_primary",
        severity: "info",
        source: projection.primarySource,
        projectionValue: projection.primarySource,
        legacyValue: "sdk",
      });
    }
    return;
  }
  if (legacy.primarySource === "sdk" && projection.primarySource && isSyntheticSdkPrimary(projection, legacy)) {
    issues.push({
      type: "synthetic_sdk_primary",
      severity: "info",
      source: projection.primarySource,
      projectionValue: projection.primarySource,
      legacyValue: "sdk",
    });
    return;
  }
  issues.push({
    type: "primary_source_mismatch",
    severity: "error",
    ...(projection.primarySource && { projectionValue: projection.primarySource }),
    ...(legacy.primarySource && { legacyValue: legacy.primarySource }),
  });
}

function compareThreadTokens(
  projection: ThreadBillingSnapshot,
  legacy: ThreadBillingSnapshot,
  issues: BillingProjectionReconciliationIssue[],
): void {
  for (const field of TOKEN_FIELDS) {
    const projectionValue = projection.totalTokens[field];
    const legacyValue = legacy.totalTokens[field];
    if (projectionValue !== legacyValue) {
      issues.push({
        type: "token_mismatch",
        severity: "error",
        field,
        projectionValue,
        legacyValue,
        delta: projectionValue - legacyValue,
      });
    }
  }
}

function compareThreadCosts(
  projection: ThreadBillingSnapshot,
  legacy: ThreadBillingSnapshot,
  issues: BillingProjectionReconciliationIssue[],
): void {
  compareCost("ecoCostUsd", projection.ecoCostUsd, legacy.ecoCostUsd, issues);
  compareCost(
    "plannerTokenCostUsd",
    projection.plannerTokenCostUsd,
    legacy.plannerTokenCostUsd,
    issues,
  );
  compareCost("otelCostUsd", projection.otelCostUsd, legacy.otelCostUsd, issues);
}

function compareSubagentMetrics(
  projection: UsageLedgerBillingProjection,
  metrics: readonly SubagentMetricsEntry[],
  issues: BillingProjectionReconciliationIssue[],
): void {
  const projectedSubagents = new Set(
    Object.values(projection.byAgent)
      .filter((agent) => agent.kind === "subagent" || isSubagentBillingRole(agent.role))
      .map((agent) => agent.agentId),
  );
  const metricsWithUsage = metrics.filter((entry) => subagentUsageTotal(entry) > 0 || entry.ecoCostUsd > 0);
  for (const entry of metricsWithUsage) {
    const projected = projection.byAgent[entry.agentId];
    if (!projected) {
      issues.push({
        type: "subagent_missing_projection",
        severity: "error",
        agentId: entry.agentId,
      });
      continue;
    }
    for (const field of TOKEN_FIELDS) {
      const subagentField = TOKEN_FIELD_TO_SUBAGENT[field];
      const projectionValue = projected[subagentField];
      const legacyValue = entry.usage[subagentField];
      if (projectionValue !== legacyValue) {
        issues.push({
          type: "subagent_token_mismatch",
          severity: "error",
          agentId: entry.agentId,
          field,
          projectionValue,
          legacyValue,
          delta: projectionValue - legacyValue,
        });
      }
    }
    compareCost("subagent.ecoCostUsd", projected.ecoCostUsd, entry.ecoCostUsd, issues, entry.agentId);
    projectedSubagents.delete(entry.agentId);
  }

  for (const agentId of projectedSubagents) {
    const projected = projection.byAgent[agentId];
    if (!projected || agentUsageTotal(projected) === 0) {
      continue;
    }
    issues.push({
      type: "subagent_missing_metrics",
      severity: "error",
      agentId,
    });
  }
}

function compareCost(
  field: string,
  projectionValue: number,
  legacyValue: number,
  issues: BillingProjectionReconciliationIssue[],
  agentId?: string,
): void {
  const delta = projectionValue - legacyValue;
  if (Math.abs(delta) <= COST_EPSILON) {
    return;
  }
  issues.push({
    type: agentId ? "subagent_cost_mismatch" : "cost_mismatch",
    severity: "error",
    field,
    projectionValue,
    legacyValue,
    delta,
    ...(agentId && { agentId }),
  });
}

function isSyntheticSdkPrimary(
  projection: ThreadBillingSnapshot,
  legacy: ThreadBillingSnapshot,
): boolean {
  return hasSyntheticSdkCompatibilityBreakdown(projection, legacy);
}

function hasSyntheticSdkCompatibilityBreakdown(
  projection: ThreadBillingSnapshot,
  legacy: ThreadBillingSnapshot,
): boolean {
  const projectionPrimary = projection.primarySource
    ? projection.sourceBreakdown?.[projection.primarySource]
    : undefined;
  const legacySdk = legacy.sourceBreakdown?.sdk;
  if (!projectionPrimary || !legacySdk) {
    return false;
  }
  return TOKEN_FIELDS.every((field) => projectionPrimary.totalTokens[field] === legacySdk.totalTokens[field]);
}

function buildResult(
  issues: BillingProjectionReconciliationIssue[],
): BillingProjectionReconciliationResult {
  return {
    ok: issues.every((issue) => issue.severity === "info"),
    issues,
  };
}

function subagentUsageTotal(entry: SubagentMetricsEntry): number {
  return (
    entry.usage.inputTokens +
    entry.usage.outputTokens +
    entry.usage.cacheReadTokens +
    entry.usage.cacheCreationTokens
  );
}

function agentUsageTotal(entry: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): number {
  return entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheCreationTokens;
}
