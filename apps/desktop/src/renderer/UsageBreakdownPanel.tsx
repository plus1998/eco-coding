import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { formatCostUsd, formatRoleModelLabel, formatUsageBadge, shortenModelId } from "@eco/runtime";
import { buildAgentViewRows, buildBillingTokenBreakdown } from "../shared/billing-token-breakdown";
import {
  ledgerEventRouteRoleDiffers,
  partitionLedgerEventsForDisplay,
  resolveBillingPrimarySource,
  resolveLedgerEventBillingRole,
  snapshotTokenTotal,
  sortLedgerEventsNewestFirst,
  sumLedgerEventTokens,
} from "../shared/ledger-events-display";
import type {
  ThreadBillingSnapshot,
  ThreadSubagentBillingSnapshot,
  ThreadUsageLedgerEventView,
} from "../shared/ipc";
import {
  type RuntimeAgentDisplayNames,
  formatRuntimeRoleModelLabel,
  resolveRuntimeAgentName,
} from "./runtime-agent-display";

type BreakdownView = "agent" | "model" | "events";

interface UsageBreakdownPanelProps {
  billing?: ThreadBillingSnapshot;
  threadId?: string;
  variant: "full" | "compact";
  agentDisplayNames?: RuntimeAgentDisplayNames;
}

function formatLedgerEventAgentLabel(event: ThreadUsageLedgerEventView): string | undefined {
  if (!event.agentId) {
    return undefined;
  }
  const agentId = event.agentId.trim();
  if (!agentId) {
    return undefined;
  }
  if (agentId === event.billingRole || agentId === "planner") {
    return "主会话";
  }
  return agentId.slice(0, 8);
}

const ATTRIBUTION_STATUS_LABELS: Record<ThreadUsageLedgerEventView["attributionStatus"], string> = {
  attributed: "",
  pending: "待归属",
  unattributed: "未归属",
};

export function BillingCostCell({
  ecoCostUsd,
  reportedCostUsd,
  className = "usage-breakdown-cost",
	}: {
	  ecoCostUsd: number;
	  reportedCostUsd?: number | undefined;
	  className?: string;
	}) {
  return (
    <span className={className} title={reportedCostUsd !== undefined ? "经济编程 / 来源报告" : undefined}>
      {formatCostUsd(ecoCostUsd)}
      {reportedCostUsd !== undefined && reportedCostUsd > 0 ? (
        <span className="usage-breakdown-cost-reported"> / {formatCostUsd(reportedCostUsd)}</span>
      ) : null}
    </span>
  );
}

export function formatUsageBreakdownAgentLabel(
  role: string,
  agentId: string | undefined,
  agentDisplayNames?: RuntimeAgentDisplayNames,
): string {
  const name = resolveRuntimeAgentName(role, agentDisplayNames) ?? formatRoleModelLabel(role);
  return agentId ? `${name} · ${agentId.slice(0, 8)}` : name;
}

export function ExpandableBillingSection({
  title,
  summary,
  children,
  className,
  defaultExpanded,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
  className?: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);

  return (
    <div className={["usage-breakdown-expandable", className].filter(Boolean).join(" ")}>
      <button
        type="button"
        className="usage-breakdown-expand-trigger"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="usage-breakdown-expand-title">{title}</span>
        {!expanded && summary ? <span className="usage-breakdown-expand-summary">{summary}</span> : null}
        <ChevronDown
          size={14}
          className={expanded ? "usage-breakdown-chevron open" : "usage-breakdown-chevron"}
          aria-hidden
        />
      </button>
      {expanded ? <div className="usage-breakdown-expand-body">{children}</div> : null}
    </div>
  );
}

function BreakdownRows({
  view,
  breakdown,
  compact,
  subagents = [],
  agentDisplayNames,
}: {
  view: BreakdownView;
  breakdown: NonNullable<ReturnType<typeof buildBillingTokenBreakdown>>;
  compact: boolean;
  subagents?: ThreadSubagentBillingSnapshot[];
  agentDisplayNames?: RuntimeAgentDisplayNames;
}) {
  if (view === "agent") {
    const agentRows = buildAgentViewRows(breakdown.byAgent, subagents);

    return (
      <ul className={`usage-breakdown-list${compact ? " usage-breakdown-list-compact" : ""}`}>
        {agentRows.map((row) => (
          <li
            key={`${row.role}:${row.kind}`}
            className="usage-breakdown-row"
            title={
              row.modelId
                ? `${formatRuntimeRoleModelLabel(row.role, row.modelId, agentDisplayNames)} · 经济编程费用`
                : `${row.label} · 经济编程费用`
            }
          >
            <span className="usage-breakdown-label">
              {`${resolveRuntimeAgentName(row.role, agentDisplayNames) ?? row.label}${
                row.kind === "unattributed"
                  ? " · 未归属"
                  : row.kind === "pending"
                    ? " · 待归属"
                    : ""
              }`}
            </span>
            <span className="usage-breakdown-tokens" title="↑ 输入 ↓ 输出 ⊙ 缓存">
              {row.tokenBadge}
            </span>
            <BillingCostCell ecoCostUsd={row.ecoCostUsd} />
          </li>
        ))}
        {subagents.map((row) => (
          <li key={row.agentId} className="usage-breakdown-row" title={`子代理 ${row.agentId}`}>
            <span className="usage-breakdown-label">
              {formatUsageBreakdownAgentLabel(row.role, row.agentId, agentDisplayNames)}
            </span>
            <span className="usage-breakdown-tokens" title="↑ 输入 ↓ 输出 ⊙ 缓存">
              {formatUsageBadge({
                inputTokens: row.inputTokens,
                outputTokens: row.outputTokens,
                cacheReadTokens: row.cacheReadTokens,
                cacheCreationTokens: row.cacheCreationTokens,
              })}
            </span>
            <BillingCostCell ecoCostUsd={row.ecoCostUsd} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className={`usage-breakdown-list${compact ? " usage-breakdown-list-compact" : ""}`}>
      {breakdown.byModel.map((row) => (
        <li
          key={row.modelId}
          className="usage-breakdown-row"
          title={`${row.label} · ${row.roles
            .map((role) => resolveRuntimeAgentName(role, agentDisplayNames) ?? formatRoleModelLabel(role))
            .join("、")}`}
        >
          <span className="usage-breakdown-label">{row.label}</span>
          <span className="usage-breakdown-tokens" title="↑ 输入 ↓ 输出 ⊙ 缓存">
            {row.tokenBadge}
          </span>
          <BillingCostCell ecoCostUsd={row.ecoCostUsd} reportedCostUsd={row.reportedCostUsd} />
        </li>
      ))}
    </ul>
  );
}

function LedgerEventRow({
  event,
  agentDisplayNames,
  showSource,
}: {
  event: ThreadUsageLedgerEventView;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  showSource?: boolean;
}) {
  const attributionLabel = ATTRIBUTION_STATUS_LABELS[event.attributionStatus];
  const billingRole = resolveLedgerEventBillingRole(event);
  const roleLabel =
    resolveRuntimeAgentName(billingRole, agentDisplayNames) ?? formatRoleModelLabel(billingRole);
  const routeRoleLabel =
    resolveRuntimeAgentName(event.routeRole, agentDisplayNames) ??
    formatRoleModelLabel(event.routeRole);
  const modelLabel = event.aliasModelId ?? event.modelId;
  const modelShort = modelLabel ? shortenModelId(modelLabel) : undefined;
  const detailParts = [
    roleLabel,
    modelShort ? `模型 ${modelShort}` : undefined,
    event.agentId ? `agent ${formatLedgerEventAgentLabel(event)}` : "无 agent",
    ledgerEventRouteRoleDiffers(event) ? `路由 ${routeRoleLabel}` : undefined,
    attributionLabel || undefined,
    event.attributionReason,
    showSource ? event.source : undefined,
  ].filter(Boolean);

  return (
    <li
      className={[
        "usage-breakdown-row",
        event.attributionStatus !== "attributed" ? `usage-breakdown-row-${event.attributionStatus}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={detailParts.join(" · ")}
    >
      <span className="usage-breakdown-label">
        <span className="usage-breakdown-event-role">{roleLabel}</span>
        {modelShort ? (
          <span className="usage-breakdown-event-model" title={modelLabel}>
            模型 {modelShort}
          </span>
        ) : null}
        {event.agentId ? (
          <span className="usage-breakdown-event-agent">agent {formatLedgerEventAgentLabel(event)}</span>
        ) : (
          <span className="usage-breakdown-event-no-agent">无 agent</span>
        )}
        {ledgerEventRouteRoleDiffers(event) ? (
          <span className="usage-breakdown-event-route" title={`Proxy 路由角色：${routeRoleLabel}`}>
            路由 {routeRoleLabel}
          </span>
        ) : null}
        {attributionLabel ? (
          <span className={`usage-breakdown-event-status usage-breakdown-event-status-${event.attributionStatus}`}>
            {attributionLabel}
          </span>
        ) : null}
      </span>
      <span className="usage-breakdown-tokens" title="↑ 输入 ↓ 输出 ⊙ 缓存">
        {formatUsageBadge({
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadTokens: event.cacheReadTokens,
          cacheCreationTokens: event.cacheCreationTokens,
        })}
      </span>
      {showSource ? <span className="usage-breakdown-event-source">{event.source}</span> : null}
    </li>
  );
}

function LedgerEventList({
  events,
  compact,
  agentDisplayNames,
  showSource,
  scrollable = false,
}: {
  events: ThreadUsageLedgerEventView[];
  compact: boolean;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  showSource?: boolean;
  scrollable?: boolean;
}) {
  const list = (
    <ul className={`usage-breakdown-list usage-breakdown-events${compact ? " usage-breakdown-list-compact" : ""}`}>
      {events.map((event) => (
        <LedgerEventRow
          key={event.id}
          event={event}
          {...(agentDisplayNames && { agentDisplayNames })}
          {...(showSource && { showSource })}
        />
      ))}
    </ul>
  );

  if (!scrollable) {
    return list;
  }

  return <div className="usage-breakdown-events-scroll">{list}</div>;
}

function LedgerEventRows({
  events,
  billing,
  compact,
  agentDisplayNames,
}: {
  events: ThreadUsageLedgerEventView[];
  billing?: ThreadBillingSnapshot;
  compact: boolean;
  agentDisplayNames?: RuntimeAgentDisplayNames;
}) {
  if (events.length === 0) {
    return <p className="usage-breakdown-events-empty">暂无逐笔账本记录。</p>;
  }

  const primarySource = resolveBillingPrimarySource(billing);
  const { primaryEvents, shadowEvents } = partitionLedgerEventsForDisplay(events, primarySource);
  const sortedPrimary = sortLedgerEventsNewestFirst(primaryEvents);
  const sortedShadow = sortLedgerEventsNewestFirst(shadowEvents);
  const primaryTotals = sumLedgerEventTokens(sortedPrimary);
  const snapshotTokens = billing ? snapshotTokenTotal(billing) : primaryTotals.total;
  const tokensMatch = primaryTotals.total === snapshotTokens;
  const pendingCount = sortedPrimary.filter((event) => event.attributionStatus === "pending").length;
  const unattributedCount = sortedPrimary.filter(
    (event) => event.attributionStatus === "unattributed",
  ).length;

  if (sortedPrimary.length === 0) {
    return (
      <>
        <p className="usage-breakdown-events-empty">主账暂无逐笔记录。</p>
        {sortedShadow.length > 0 ? (
          <ExpandableBillingSection
            title="校验源"
            summary={`${sortedShadow.length} 笔 SDK/OTel，不计入主账`}
            className="usage-breakdown-shadow-events"
          >
            <LedgerEventList
              events={sortedShadow}
              compact={compact}
              scrollable
              showSource
              {...(agentDisplayNames && { agentDisplayNames })}
            />
          </ExpandableBillingSection>
        ) : null}
      </>
    );
  }

  const primaryBadge = formatUsageBadge(primaryTotals);
  const footerParts = [
    `主账 ${sortedPrimary.length} 笔`,
    primaryBadge,
    tokensMatch ? "与顶部合计一致" : `主账合计 ${primaryTotals.total}，顶部 ${snapshotTokens}`,
  ];
  if (pendingCount > 0) {
    footerParts.push(`${pendingCount} 笔待归属`);
  }
  if (unattributedCount > 0) {
    footerParts.push(`${unattributedCount} 笔无 agent`);
  }

  return (
    <>
      <LedgerEventList
        events={sortedPrimary}
        compact={compact}
        scrollable
        {...(agentDisplayNames && { agentDisplayNames })}
      />
      <p
        className={[
          "usage-breakdown-events-footer",
          tokensMatch ? "usage-breakdown-events-footer-ok" : "usage-breakdown-events-footer-warn",
        ].join(" ")}
        title="逐笔默认仅展示主账来源（通常为 Proxy），与按 Agent/按模型视图同一口径"
      >
        {footerParts.join(" · ")}
      </p>
      {sortedShadow.length > 0 ? (
        <ExpandableBillingSection
          title="校验源"
          summary={`${sortedShadow.length} 笔 SDK/OTel shadow，不计入主账`}
          className="usage-breakdown-shadow-events"
        >
          <p className="usage-breakdown-events-hint">
            以下为对账校验记录，每条请求可能重复出现在 Proxy / SDK / OTel；仅主账计入顶部用量。
          </p>
          <LedgerEventList
            events={sortedShadow}
            compact={compact}
            scrollable
            showSource
            {...(agentDisplayNames && { agentDisplayNames })}
          />
        </ExpandableBillingSection>
      ) : null}
    </>
  );
}

function ViewToggle({
  view,
  onChange,
  compact,
  showEvents,
}: {
  view: BreakdownView;
  onChange: (view: BreakdownView) => void;
  compact: boolean;
  showEvents: boolean;
}) {
  return (
    <div
      className={`usage-breakdown-toggle${compact ? " usage-breakdown-toggle-compact" : ""}`}
      role="tablist"
    >
      <button
        type="button"
        role="tab"
        aria-selected={view === "agent"}
        className={view === "agent" ? "active" : undefined}
        onClick={() => onChange("agent")}
      >
        按 Agent
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "model"}
        className={view === "model" ? "active" : undefined}
        onClick={() => onChange("model")}
      >
        按模型
      </button>
      {showEvents ? (
        <button
          type="button"
          role="tab"
          aria-selected={view === "events"}
          className={view === "events" ? "active" : undefined}
          onClick={() => onChange("events")}
        >
          逐笔
        </button>
      ) : null}
    </div>
  );
}

export function UsageBreakdownPanel({
  billing,
  threadId,
  variant,
  agentDisplayNames,
}: UsageBreakdownPanelProps) {
  const breakdown = useMemo(() => buildBillingTokenBreakdown(billing), [billing]);
  const [view, setView] = useState<BreakdownView>("agent");
  const [expanded, setExpanded] = useState(false);
  const [ledgerEvents, setLedgerEvents] = useState<ThreadUsageLedgerEventView[]>([]);
  const compact = variant === "compact";
  const showEvents = Boolean(threadId && window.eco?.listUsageLedgerEvents);

  useEffect(() => {
    if (!threadId || !window.eco?.listUsageLedgerEvents) {
      setLedgerEvents([]);
      return;
    }
    let cancelled = false;
    void window.eco.listUsageLedgerEvents(threadId).then((events) => {
      if (!cancelled) {
        setLedgerEvents(events);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [threadId, billing]);

  if (!breakdown) {
    return null;
  }

  const subagents = billing?.subagents ?? [];
  const breakdownBody =
    view === "events" ? (
      <LedgerEventRows
        events={ledgerEvents}
        {...(billing && { billing })}
        compact={compact}
        {...(agentDisplayNames && { agentDisplayNames })}
      />
    ) : (
      <BreakdownRows
        view={view}
        breakdown={breakdown}
        compact={compact}
        subagents={subagents}
        {...(agentDisplayNames && { agentDisplayNames })}
      />
    );

  if (compact) {
    const summaryRows = breakdown.byAgent.length > 0 ? breakdown.byAgent : breakdown.byModel;
    const summary = summaryRows.map((row) => `${row.label} ${row.tokenBadge}`).join(" · ");

    return (
      <div className="usage-breakdown usage-breakdown-compact">
        <button
          type="button"
          className="usage-breakdown-compact-trigger"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="usage-breakdown-compact-title">累计用量</span>
          <span className="usage-breakdown-compact-summary">{summary}</span>
          <ChevronDown
            size={14}
            className={expanded ? "usage-breakdown-chevron open" : "usage-breakdown-chevron"}
            aria-hidden
          />
        </button>
        {expanded ? (
          <div className="usage-breakdown-compact-body">
            <ViewToggle view={view} onChange={setView} compact showEvents={showEvents} />
            {breakdownBody}
          </div>
        ) : null}
      </div>
    );
  }

  const summaryRows = breakdown.byAgent.length > 0 ? breakdown.byAgent : breakdown.byModel;
  const summary = summaryRows.map((row) => `${row.label} ${row.tokenBadge}`).join(" · ");

  return (
    <ExpandableBillingSection title="用量明细" summary={summary} defaultExpanded>
      <ViewToggle view={view} onChange={setView} compact={false} showEvents={showEvents} />
      {breakdownBody}
    </ExpandableBillingSection>
  );
}
