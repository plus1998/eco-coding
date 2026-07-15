import { formatCostUsd, formatTokenCount, formatUsageBadge } from "@eco/runtime/usage";
import type { ThreadBillingSnapshot, ThreadContextSnapshot, ThreadStatus } from "../shared/ipc";
import {
  billingEmptyHint,
  contextCardPlaceholder,
  shouldShowThreadUsagePanels,
} from "../shared/thread-usage-summary";
import type { ThreadUsageSummary } from "./WorkspaceFloatingCards";
import { ThreadInfoFloatStack } from "./ThreadInfoPanel";
import type { RuntimeAgentDisplayNames } from "./runtime-agent-display";
import type { RuntimeAgentThemes } from "./runtime-agent-theme";

function hasBillingData(billing?: ThreadBillingSnapshot): billing is ThreadBillingSnapshot {
  if (!billing) {
    return false;
  }
  const total =
    billing.totalTokens.input +
    billing.totalTokens.output +
    billing.totalTokens.cacheRead +
    billing.totalTokens.cacheCreation;
  return (
    total > 0 ||
    billing.sourceReportedCostUsd > 0 ||
    billing.plannerTokenCostUsd > 0 ||
    billing.ecoCostUsd > 0
  );
}

function formatCacheCostSuffix(billing: ThreadBillingSnapshot): {
  label: string;
  title: string;
} | null {
  const breakdown = billing.ecoCostBreakdown;
  const cacheRead = billing.totalTokens.cacheRead;
  const cacheCreation = billing.totalTokens.cacheCreation;
  if (!breakdown || (cacheRead <= 0 && cacheCreation <= 0)) {
    return null;
  }
  const cacheUsd = breakdown.cacheReadUsd + breakdown.cacheCreationUsd;
  const cachePct = billing.ecoCostUsd > 0 ? (cacheUsd / billing.ecoCostUsd) * 100 : 0;
  const detail: string[] = [];
  if (cacheRead > 0) {
    detail.push(`读 ${formatTokenCount(cacheRead)}`);
  }
  if (cacheCreation > 0) {
    detail.push(`写 ${formatTokenCount(cacheCreation)}`);
  }
  return {
    label: `${formatCostUsd(cacheUsd)}（${cachePct.toFixed(0)}%）`,
    title: `缓存费用（models.dev cache_read / cache_write）${detail.join(" · ")}`,
  };
}

export interface ComposerThreadUsagePillsProps {
  threadId?: string;
  threadStatus?: ThreadStatus;
  usageSummary?: ThreadUsageSummary;
  contextCompactionInFlight?: boolean;
  autoCompactSuspended?: boolean;
  promptCacheInvalidated?: boolean;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  agentThemes?: RuntimeAgentThemes;
}

export function ComposerThreadUsagePills({
  threadId,
  threadStatus,
  usageSummary,
  contextCompactionInFlight = false,
  autoCompactSuspended = false,
  promptCacheInvalidated = false,
  agentDisplayNames,
  agentThemes,
}: ComposerThreadUsagePillsProps) {
  const billing = usageSummary?.billing;
  const tokenBadge = billing
    ? formatUsageBadge({
        inputTokens: billing.totalTokens.input,
        outputTokens: billing.totalTokens.output,
        cacheReadTokens: billing.totalTokens.cacheRead,
        cacheCreationTokens: billing.totalTokens.cacheCreation,
      })
    : null;
  const plannerLabel = billing?.plannerModelLabel?.split(" · ")[0] ?? "主模型";
  const cacheCostSuffix = billing ? formatCacheCostSuffix(billing) : null;
  const showUsagePanels = shouldShowThreadUsagePanels(threadStatus);
  const showBilling = hasBillingData(billing);
  const showBillingSection = showUsagePanels && (showBilling || threadStatus !== undefined);

  if (!showBillingSection && !showUsagePanels) {
    return null;
  }

  return (
    <div className="composer-footer-usage">
      <ThreadInfoFloatStack
        variant="composer"
        {...(threadId !== undefined && { threadId })}
        showBillingSection={showBillingSection}
        {...(billing !== undefined && { billing })}
        {...(threadStatus !== undefined && { threadStatus })}
        tokenBadge={tokenBadge}
        plannerLabel={plannerLabel}
        cacheCostSuffix={cacheCostSuffix}
        showBilling={showBilling}
        {...(usageSummary?.context !== undefined && { context: usageSummary.context })}
        contextPlaceholder={contextCardPlaceholder(threadStatus)}
        contextCompactionInFlight={contextCompactionInFlight}
        autoCompactSuspended={autoCompactSuspended}
        promptCacheInvalidated={promptCacheInvalidated}
        {...(agentDisplayNames && { agentDisplayNames })}
        {...(agentThemes && { agentThemes })}
      />
    </div>
  );
}
