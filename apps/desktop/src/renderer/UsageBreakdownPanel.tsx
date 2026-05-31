import { ChevronDown } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { formatCostUsd, formatRoleModelLabel } from "@eco/runtime";
import { buildBillingTokenBreakdown } from "../shared/billing-token-breakdown";
import type { ThreadBillingSnapshot } from "../shared/ipc";

type BreakdownView = "agent" | "model";

interface UsageBreakdownPanelProps {
  billing?: ThreadBillingSnapshot;
  variant: "full" | "compact";
}

export function ExpandableBillingSection({
  title,
  summary,
  children,
  className,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);

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
}: {
  view: BreakdownView;
  breakdown: NonNullable<ReturnType<typeof buildBillingTokenBreakdown>>;
  compact: boolean;
}) {
  if (view === "agent") {
    return (
      <ul className={`usage-breakdown-list${compact ? " usage-breakdown-list-compact" : ""}`}>
        {breakdown.byAgent.map((row) => (
          <li key={row.role} className="usage-breakdown-row" title={`${row.label} · 经济编程费用`}>
            <span className="usage-breakdown-label">{row.label}</span>
            <span className="usage-breakdown-tokens" title="↑ 输入 ↓ 输出 ⊙ 缓存">
              {row.tokenBadge}
            </span>
            <span className="usage-breakdown-cost">{formatCostUsd(row.ecoCostUsd)}</span>
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
          title={`${row.label} · ${row.roles.map((role) => formatRoleModelLabel(role)).join("、")}`}
        >
          <span className="usage-breakdown-label">{row.label}</span>
          <span className="usage-breakdown-tokens" title="↑ 输入 ↓ 输出 ⊙ 缓存">
            {row.tokenBadge}
          </span>
          <span className="usage-breakdown-cost">{formatCostUsd(row.ecoCostUsd)}</span>
        </li>
      ))}
    </ul>
  );
}

function ViewToggle({
  view,
  onChange,
  compact,
}: {
  view: BreakdownView;
  onChange: (view: BreakdownView) => void;
  compact: boolean;
}) {
  return (
    <div className={`usage-breakdown-toggle${compact ? " usage-breakdown-toggle-compact" : ""}`} role="tablist">
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
    </div>
  );
}

export function UsageBreakdownPanel({ billing, variant }: UsageBreakdownPanelProps) {
  const breakdown = useMemo(() => buildBillingTokenBreakdown(billing), [billing]);
  const [view, setView] = useState<BreakdownView>("agent");
  const [expanded, setExpanded] = useState(false);
  const compact = variant === "compact";

  if (!breakdown) {
    return null;
  }

  if (compact) {
    const summaryRows = breakdown.byAgent.length > 0 ? breakdown.byAgent : breakdown.byModel;
    const summary = summaryRows
      .map((row) => `${row.label} ${row.tokenBadge}`)
      .join(" · ");

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
          <ChevronDown size={14} className={expanded ? "usage-breakdown-chevron open" : "usage-breakdown-chevron"} aria-hidden />
        </button>
        {expanded ? (
          <div className="usage-breakdown-compact-body">
            <ViewToggle view={view} onChange={setView} compact />
            <BreakdownRows view={view} breakdown={breakdown} compact />
          </div>
        ) : null}
      </div>
    );
  }

  const summaryRows = breakdown.byAgent.length > 0 ? breakdown.byAgent : breakdown.byModel;
  const summary = summaryRows.map((row) => `${row.label} ${row.tokenBadge}`).join(" · ");

  return (
    <ExpandableBillingSection title="用量明细" summary={summary}>
      <ViewToggle view={view} onChange={setView} compact={false} />
      <BreakdownRows view={view} breakdown={breakdown} compact={false} />
    </ExpandableBillingSection>
  );
}
