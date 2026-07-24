import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatCostUsd, formatRoleModelLabel, formatUsageBadge, shortenModelId } from "@eco/runtime/usage";
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
import { SUBAGENT_ROLE_SHORT } from "../shared/subagent-roles";
import {
  type RuntimeAgentDisplayNames,
  formatRuntimeRoleModelLabel,
  resolveRuntimeAgentName,
} from "./runtime-agent-display";
import { i18n } from "./i18n";

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
    return i18n.t("usage.mainSession");
  }
  return agentId.slice(-8);
}

function attributionStatusLabel(
  status: ThreadUsageLedgerEventView["attributionStatus"],
): string {
  if (status === "pending") {
    return i18n.t("usage.pending");
  }
  if (status === "unattributed") {
    return i18n.t("usage.unattributed");
  }
  return "";
}

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
    <span
      className={className}
      title={reportedCostUsd !== undefined ? i18n.t("usage.costTitle") : undefined}
    >
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
  const name =
    resolveRuntimeAgentName(role, agentDisplayNames) ??
    SUBAGENT_ROLE_SHORT[role] ??
    formatRoleModelLabel(role);
  return agentId ? `${name} · #${agentId.slice(-8)}` : name;
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
                ? i18n.t("usage.ecoCost", {
                    label: formatRuntimeRoleModelLabel(
                      row.role,
                      row.modelId,
                      agentDisplayNames,
                    ),
                  })
                : i18n.t("usage.ecoCost", { label: row.label })
            }
          >
            <span className="usage-breakdown-label">
              {`${resolveRuntimeAgentName(row.role, agentDisplayNames) ?? row.label}${
                row.kind === "unattributed"
                  ? ` · ${i18n.t("usage.unattributed")}`
                  : row.kind === "pending"
                    ? ` · ${i18n.t("usage.pending")}`
                    : ""
              }`}
            </span>
            <span className="usage-breakdown-tokens" title={i18n.t("billing.tokenTitle")}>
              {row.tokenBadge}
            </span>
            <BillingCostCell ecoCostUsd={row.ecoCostUsd} />
          </li>
        ))}
        {subagents.map((row) => (
          <li
            key={row.agentId}
            className="usage-breakdown-row"
            title={formatUsageBreakdownAgentLabel(row.role, row.agentId, agentDisplayNames)}
          >
            <span className="usage-breakdown-label">
              {formatUsageBreakdownAgentLabel(row.role, row.agentId, agentDisplayNames)}
            </span>
            <span className="usage-breakdown-tokens" title={i18n.t("billing.tokenTitle")}>
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
          <span className="usage-breakdown-tokens" title={i18n.t("billing.tokenTitle")}>
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
  const attributionLabel = attributionStatusLabel(event.attributionStatus);
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
    modelShort ? i18n.t("usage.model", { model: modelShort }) : undefined,
    event.agentId
      ? `agent ${formatLedgerEventAgentLabel(event)}`
      : i18n.t("usage.noAgent"),
    ledgerEventRouteRoleDiffers(event)
      ? i18n.t("usage.route", { role: routeRoleLabel })
      : undefined,
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
            {i18n.t("usage.model", { model: modelShort })}
          </span>
        ) : null}
        {event.agentId ? (
          <span className="usage-breakdown-event-agent">agent {formatLedgerEventAgentLabel(event)}</span>
        ) : (
          <span className="usage-breakdown-event-no-agent">{i18n.t("usage.noAgent")}</span>
        )}
        {ledgerEventRouteRoleDiffers(event) ? (
          <span
            className="usage-breakdown-event-route"
            title={i18n.t("usage.proxyRoute", { role: routeRoleLabel })}
          >
            {i18n.t("usage.route", { role: routeRoleLabel })}
          </span>
        ) : null}
        {attributionLabel ? (
          <span className={`usage-breakdown-event-status usage-breakdown-event-status-${event.attributionStatus}`}>
            {attributionLabel}
          </span>
        ) : null}
      </span>
      <span className="usage-breakdown-tokens" title={i18n.t("billing.tokenTitle")}>
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
    return <p className="usage-breakdown-events-empty">{i18n.t("usage.noEvents")}</p>;
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
        <p className="usage-breakdown-events-empty">{i18n.t("usage.noPrimaryEvents")}</p>
        {sortedShadow.length > 0 ? (
          <ExpandableBillingSection
            title={i18n.t("usage.validationSource")}
            summary={i18n.t("usage.shadowSummary", { count: sortedShadow.length })}
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
    i18n.t("usage.primaryCount", { count: sortedPrimary.length }),
    primaryBadge,
    tokensMatch
      ? i18n.t("usage.matchesTotal")
      : i18n.t("usage.totalMismatch", {
          primary: primaryTotals.total,
          snapshot: snapshotTokens,
        }),
  ];
  if (pendingCount > 0) {
    footerParts.push(i18n.t("usage.pendingCount", { count: pendingCount }));
  }
  if (unattributedCount > 0) {
    footerParts.push(i18n.t("usage.unattributedCount", { count: unattributedCount }));
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
        title={i18n.t("usage.primaryHint")}
      >
        {footerParts.join(" · ")}
      </p>
      {sortedShadow.length > 0 ? (
        <ExpandableBillingSection
          title={i18n.t("usage.validationSource")}
          summary={i18n.t("usage.shadowSummary", { count: sortedShadow.length })}
          className="usage-breakdown-shadow-events"
        >
          <p className="usage-breakdown-events-hint">
            {i18n.t("usage.shadowHint")}
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
        aria-selected={view === "model"}
        className={view === "model" ? "active" : undefined}
        onClick={() => onChange("model")}
      >
        {i18n.t("usage.byModel")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "agent"}
        className={view === "agent" ? "active" : undefined}
        onClick={() => onChange("agent")}
      >
        {i18n.t("usage.byAgent")}
      </button>
      {showEvents ? (
        <button
          type="button"
          role="tab"
          aria-selected={view === "events"}
          className={view === "events" ? "active" : undefined}
          onClick={() => onChange("events")}
        >
          {i18n.t("usage.events")}
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
  useTranslation();
  const breakdown = useMemo(() => buildBillingTokenBreakdown(billing), [billing]);
  const [view, setView] = useState<BreakdownView>("model");
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
    const summaryRows = breakdown.byModel.length > 0 ? breakdown.byModel : breakdown.byAgent;
    const summary = summaryRows.map((row) => `${row.label} ${row.tokenBadge}`).join(" · ");

    return (
      <div className="usage-breakdown usage-breakdown-compact">
        <button
          type="button"
          className="usage-breakdown-compact-trigger"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="usage-breakdown-compact-title">{i18n.t("usage.cumulative")}</span>
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

  const summaryRows = breakdown.byModel.length > 0 ? breakdown.byModel : breakdown.byAgent;
  const summary = summaryRows.map((row) => `${row.label} ${row.tokenBadge}`).join(" · ");

  return (
    <ExpandableBillingSection
      title={i18n.t("usage.details")}
      summary={summary}
      defaultExpanded
    >
      <ViewToggle view={view} onChange={setView} compact={false} showEvents={showEvents} />
      {breakdownBody}
    </ExpandableBillingSection>
  );
}
