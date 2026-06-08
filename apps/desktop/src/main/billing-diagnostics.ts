import type {
  ThreadBillingDiagnostic,
  ThreadBillingDiagnosticSeverity,
  ThreadBillingDiagnosticType,
  ThreadBillingSnapshot,
} from "../shared/ipc";
import type {
  BillingProjectionReconciliationIssue,
  BillingProjectionReconciliationResult,
} from "./billing-projector-reconciliation";

export function withBillingDiagnostics(
  billing: ThreadBillingSnapshot,
  input: {
    projectionReconciliation?: BillingProjectionReconciliationResult | undefined;
  } = {},
): ThreadBillingSnapshot {
  const diagnostics = buildBillingDiagnostics(billing, input.projectionReconciliation);
  return diagnostics.length > 0 ? { ...billing, diagnostics } : billing;
}

export function buildBillingDiagnostics(
  billing: ThreadBillingSnapshot,
  projectionReconciliation?: BillingProjectionReconciliationResult | undefined,
): ThreadBillingDiagnostic[] {
  const diagnostics: ThreadBillingDiagnostic[] = [];
  if (!billing.pricingResolved) {
    diagnostics.push({
      type: "pricing_unresolved",
      severity: "warning",
      message: "部分模型未匹配 models.dev 单价，成本估算可能不完整。",
    });
  }
  for (const issue of projectionReconciliation?.issues ?? []) {
    diagnostics.push(diagnosticFromProjectionIssue(issue));
  }
  return dedupeDiagnostics(diagnostics);
}

function diagnosticFromProjectionIssue(
  issue: BillingProjectionReconciliationIssue,
): ThreadBillingDiagnostic {
  const base = {
    severity: issue.severity === "error" ? "error" : ("info" as ThreadBillingDiagnosticSeverity),
    ...(issue.source && { source: issue.source }),
    ...(issue.agentId && { agentId: issue.agentId }),
    ...(issue.field && { field: issue.field }),
    ...(issue.delta !== undefined && { delta: issue.delta }),
    ...(issue.count !== undefined && { count: issue.count }),
  };

  switch (issue.type) {
    case "missing_projection_snapshot":
    case "missing_legacy_billing":
      return {
        ...base,
        type: "projection_missing",
        message:
          issue.type === "missing_projection_snapshot"
            ? "Usage ledger 暂时无法生成计费投影，已回退到 legacy 计费。"
            : "缺少 legacy 计费快照，暂时无法校验 ledger 投影。",
      };
    case "primary_source_mismatch":
      return {
        ...base,
        severity: "warning",
        type: "primary_source_mismatch",
        message: "计费主来源与 legacy 快照不一致，当前展示已回退到校验通过的来源。",
      };
    case "synthetic_sdk_primary":
      return {
        ...base,
        type: "primary_source_mismatch",
        message: "SDK 主账来自兼容合成路径，已按等价 token 校验通过。",
      };
    case "token_mismatch":
      return {
        ...base,
        type: "token_mismatch",
        message: `计费 token 校验不一致：${issue.field ?? "unknown"} 相差 ${formatDelta(issue.delta)}。`,
      };
    case "cost_mismatch":
      return {
        ...base,
        type: "cost_mismatch",
        message: `计费成本校验不一致：${issue.field ?? "unknown"} 相差 ${formatCostDelta(issue.delta)}。`,
      };
    case "subagent_missing_projection":
    case "subagent_missing_metrics":
    case "subagent_token_mismatch":
    case "subagent_cost_mismatch":
      return {
        ...base,
        type: "subagent_metrics_mismatch",
        message: subagentDiagnosticMessage(issue),
      };
    case "unattributed_usage":
      return {
        ...base,
        type: "unattributed_usage",
        message: `${issue.count ?? 1} 条用量未归因到 Agent，分 Agent 成本可能不完整。`,
      };
    case "unresolved_usage":
      return {
        ...base,
        severity: "warning",
        type: "unresolved_usage",
        message: `${issue.count ?? 1} 条用量缺少可解析单价，成本估算可能偏低。`,
      };
  }
}

function subagentDiagnosticMessage(issue: BillingProjectionReconciliationIssue): string {
  switch (issue.type) {
    case "subagent_missing_projection":
      return `子代理 ${issue.agentId ?? "unknown"} 缺少 ledger 计费投影。`;
    case "subagent_missing_metrics":
      return `子代理 ${issue.agentId ?? "unknown"} 缺少 metrics 快照，子代理面板可能不完整。`;
    case "subagent_token_mismatch":
      return `子代理 ${issue.agentId ?? "unknown"} token 校验不一致：${issue.field ?? "unknown"} 相差 ${formatDelta(issue.delta)}。`;
    case "subagent_cost_mismatch":
      return `子代理 ${issue.agentId ?? "unknown"} 成本校验不一致：${issue.field ?? "unknown"} 相差 ${formatCostDelta(issue.delta)}。`;
    default:
      return "子代理计费校验不一致。";
  }
}

function formatDelta(delta: number | undefined): string {
  if (delta === undefined) {
    return "unknown";
  }
  return delta > 0 ? `+${delta}` : String(delta);
}

function formatCostDelta(delta: number | undefined): string {
  if (delta === undefined) {
    return "unknown";
  }
  const sign = delta > 0 ? "+" : "";
  return `${sign}$${delta.toFixed(6)}`;
}

function dedupeDiagnostics(
  diagnostics: readonly ThreadBillingDiagnostic[],
): ThreadBillingDiagnostic[] {
  const seen = new Set<string>();
  const output: ThreadBillingDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.type,
      diagnostic.severity,
      diagnostic.source ?? "",
      diagnostic.agentId ?? "",
      diagnostic.field ?? "",
      diagnostic.message,
    ].join("\u001f");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(diagnostic);
  }
  return output;
}
