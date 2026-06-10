import type { ThreadBillingDiagnostic, ThreadBillingSnapshot } from "./ipc";

export interface BillingOpenBoundaryNote {
  id: string;
  message: string;
}

function sourceTokenTotal(
  entry: NonNullable<ThreadBillingSnapshot["sourceBreakdown"]>[string] | undefined,
): number {
  if (!entry) {
    return 0;
  }
  const tokens = entry.totalTokens;
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
}

function hasBillingUsage(billing: ThreadBillingSnapshot): boolean {
  const total = billing.totalTokens;
  return (
    total.input + total.output + total.cacheRead + total.cacheCreation > 0 || billing.ecoCostUsd > 0
  );
}

function hasPrimaryAttributionWarning(diagnostics: readonly ThreadBillingDiagnostic[]): boolean {
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "warning" &&
      (diagnostic.type === "unattributed_usage" || diagnostic.type === "pending_attribution"),
  );
}

/** Human-readable notes for open billing boundaries (B14–B17) that may apply to this thread. */
export function collectBillingOpenBoundaryNotes(billing: ThreadBillingSnapshot): BillingOpenBoundaryNote[] {
  if (!hasBillingUsage(billing)) {
    return [];
  }

  const notes: BillingOpenBoundaryNote[] = [];
  const sources = billing.sourceBreakdown;
  const proxyTokens = sourceTokenTotal(sources?.proxy);
  const otelTokens = sourceTokenTotal(sources?.otel);
  const sdkTokens = sourceTokenTotal(sources?.sdk);
  const hasProxy = proxyTokens > 0;
  const hasSdkOtel = otelTokens > 0 || sdkTokens > 0;
  const diagnostics = billing.diagnostics ?? [];

  if (!hasProxy && hasSdkOtel) {
    notes.push({
      id: "B17",
      message:
        "未检测到 Proxy 计费事件：请确认 Agent baseUrl 指向本地 Proxy，否则用量可能仅来自 OTel/SDK 且难以逐笔归属。",
    });
  }

  if (hasPrimaryAttributionWarning(diagnostics)) {
    notes.push({
      id: "B16",
      message:
        "部分主账请求未能经 Proxy 路由或未及时归属 agent：将显式失败或记入未归属桶，不会静默错账。",
    });
    notes.push({
      id: "B14",
      message:
        "部分内部路径（如 context headroom）可能仍使用裸 upstream model id，不经 alias/Proxy，明细可能与 Proxy 主账存在缺口。",
    });
  }

  return notes;
}
