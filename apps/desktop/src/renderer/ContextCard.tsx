import { formatRoleModelLabel, formatTokenCount } from "@eco/runtime";
import { ChevronDown, X } from "lucide-react";
import { useState } from "react";
import type { AgentRole, ThreadContextSnapshot, ThreadRoleContextSnapshot } from "../shared/ipc";

interface ContextCardProps {
  context?: ThreadContextSnapshot;
  placeholder?: string;
  /** When false, hide the card if there is no snapshot yet. */
  showWhenEmpty?: boolean;
  onDismiss?: () => void;
}

function formatContextK(value: number): string {
  if (value < 1000) {
    return String(value);
  }
  if (value < 1_000_000) {
    const rounded = value / 1000;
    return rounded >= 100 ? `${Math.round(rounded)}K` : `${rounded.toFixed(1)}K`;
  }
  return `${(value / 1_000_000).toFixed(1)}M`;
}

function pctClass(pct: number): string {
  if (pct >= 95) {
    return "context-card-pct context-card-pct-critical";
  }
  if (pct >= 85) {
    return "context-card-pct context-card-pct-warn";
  }
  return "context-card-pct";
}

function formatOccupancyLabel(pct: number): string {
  if (pct >= 100) {
    return "100% 已满";
  }
  if (pct >= 95) {
    return `${pct}% 接近上限`;
  }
  if (pct >= 85) {
    return `${pct}% 即将触顶`;
  }
  return `${pct}% 已用`;
}

function contextRoles(context: ThreadContextSnapshot): ThreadRoleContextSnapshot[] {
  if (context.roles && context.roles.length > 0) {
    return context.roles;
  }
  return [
    {
      role: context.displayRole ?? "planner",
      occupied: context.occupied,
      limit: context.limit,
      occupancyPct: context.occupancyPct,
      limitsResolved: context.limitsResolved,
      ...(context.modelId && { modelId: context.modelId }),
      segments: context.segments,
      ...(context.maxOutputTokens !== undefined && { maxOutputTokens: context.maxOutputTokens }),
    },
  ];
}

function resolvePlannerSnapshot(
  context: ThreadContextSnapshot,
  roles: ThreadRoleContextSnapshot[],
): ThreadRoleContextSnapshot {
  const fromRoles = roles.find((role) => role.role === "planner");
  if (fromRoles) {
    return fromRoles;
  }
  return {
    role: "planner",
    occupied: context.occupied,
    limit: context.limit,
    occupancyPct: context.occupancyPct,
    limitsResolved: context.limitsResolved,
    ...(context.modelId && { modelId: context.modelId }),
    segments: context.segments,
    ...(context.maxOutputTokens !== undefined && { maxOutputTokens: context.maxOutputTokens }),
  };
}

function hasDetailedBreakdown(role: ThreadRoleContextSnapshot): boolean {
  const visibleSegments = role.segments.filter((segment) => segment.tokens > 0);
  return (
    visibleSegments.length > 1 ||
    visibleSegments.some((segment) => segment.key !== "conversation" || segment.label !== "会话占用")
  );
}

function ContextRoleBody({
  role,
  detailsOpen,
  showRefreshing,
}: {
  role: ThreadRoleContextSnapshot;
  detailsOpen: boolean;
  showRefreshing?: boolean;
}) {
  const visibleSegments = role.segments.filter((segment) => segment.tokens > 0);
  const occupied = role.occupied;
  const limit = role.limit;
  const segmentTotal = visibleSegments.reduce((sum, segment) => sum + segment.tokens, 0);
  const freeTokens = Math.max(limit - occupied, 0);
  const detailed = hasDetailedBreakdown(role);
  const roleLabel = formatRoleModelLabel(role.role, role.modelId);

  return (
    <>
      <div className="context-card-summary">
        <span className={pctClass(role.occupancyPct)}>{formatOccupancyLabel(role.occupancyPct)}</span>
        <span className="context-card-tokens">
          ~{formatContextK(occupied)} / {formatContextK(limit)} Tokens
        </span>
      </div>

      <div
        className="context-card-bar"
        role="img"
        aria-label={`${roleLabel} 上下文已用 ${role.occupancyPct}%，约 ${formatContextK(occupied)} / ${formatContextK(limit)}`}
      >
        {occupied > 0 ? (
          <span className="context-card-bar-occupied" style={{ flexGrow: occupied }}>
            {visibleSegments.map((segment) => (
              <span
                key={segment.key}
                className="context-card-bar-segment"
                style={{
                  flexGrow: segment.tokens,
                  backgroundColor: segment.color,
                }}
              />
            ))}
            {occupied > segmentTotal ? (
              <span
                className="context-card-bar-segment context-card-bar-segment-gap"
                style={{ flexGrow: occupied - segmentTotal }}
              />
            ) : null}
          </span>
        ) : null}
        {freeTokens > 0 ? <span className="context-card-bar-free" style={{ flexGrow: freeTokens }} /> : null}
      </div>

      {showRefreshing && detailed ? <p className="context-card-stale">正在拉取分项明细…</p> : null}

      {detailed && detailsOpen ? (
        <ul className="context-card-breakdown">
          {visibleSegments.map((segment) => (
            <li key={segment.key}>
              <span className="context-card-swatch" style={{ backgroundColor: segment.color }} />
              <span className="context-card-label">{segment.label}</span>
              <span className="context-card-value">{formatTokenCount(segment.tokens)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {!role.limitsResolved ? (
        <p className="context-card-footnote">
          上限未匹配 models.dev，按 {formatContextK(role.limit)} 估算
        </p>
      ) : null}
    </>
  );
}

export function ContextCard({ context, placeholder, showWhenEmpty = true, onDismiss }: ContextCardProps) {
  const [plannerDetailsOpen, setPlannerDetailsOpen] = useState(true);
  const [expandedSubagents, setExpandedSubagents] = useState<Set<AgentRole>>(() => new Set());

  if (!context) {
    if (!showWhenEmpty) {
      return null;
    }
    return (
      <div className="context-card context-card-empty">
        <p className="context-card-placeholder">{placeholder ?? "上下文 — 有模型请求后显示"}</p>
      </div>
    );
  }

  const roles = contextRoles(context);
  const planner = resolvePlannerSnapshot(context, roles);
  const subagentRoles = roles.filter((role) => role.role !== "planner");
  const plannerDetailed = hasDetailedBreakdown(planner);
  const showPlannerRefreshing = Boolean(context.breakdownRefreshing);

  const toggleSubagent = (role: AgentRole) => {
    setExpandedSubagents((current) => {
      const next = new Set(current);
      if (next.has(role)) {
        next.delete(role);
      } else {
        next.add(role);
      }
      return next;
    });
  };

  return (
    <div className="context-card">
      <div className="context-card-header">
        <div className="context-card-title-group">
          <h4 className="context-card-title">Context</h4>
          <span className="context-card-role-badge">
            {formatRoleModelLabel(planner.role, planner.modelId)}
          </span>
        </div>
        <div className="context-card-header-actions">
          {plannerDetailed ? (
            <button
              type="button"
              className="context-card-collapse"
              onClick={() => setPlannerDetailsOpen((open) => !open)}
              aria-expanded={plannerDetailsOpen}
              aria-label={plannerDetailsOpen ? "折叠分项" : "展开分项"}
            >
              <span className="context-card-collapse-label">{plannerDetailsOpen ? "−" : "+"}</span>
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              className="context-card-dismiss"
              onClick={onDismiss}
              aria-label="关闭 Context"
            >
              <X size={14} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      <ContextRoleBody
        role={planner}
        detailsOpen={plannerDetailsOpen}
        showRefreshing={showPlannerRefreshing}
      />

      {subagentRoles.length > 0 ? (
        <div className="context-card-subagents" aria-label="子代理上下文">
          {subagentRoles.map((role) => {
            const expanded = expandedSubagents.has(role.role);
            const label = formatRoleModelLabel(role.role, role.modelId);
            return (
              <div key={role.role} className="context-card-subagent">
                <button
                  type="button"
                  className="context-card-subagent-toggle"
                  onClick={() => toggleSubagent(role.role)}
                  aria-expanded={expanded}
                >
                  <ChevronDown
                    size={14}
                    className={expanded ? "context-card-subagent-chevron open" : "context-card-subagent-chevron"}
                    aria-hidden
                  />
                  <span className="context-card-subagent-toggle-main">
                    <span className="context-card-role-name">{label}</span>
                    <span className="context-card-role-meter" aria-hidden>
                      <span
                        className="context-card-role-meter-fill"
                        style={{ width: `${Math.min(role.occupancyPct, 100)}%` }}
                      />
                    </span>
                  </span>
                  <span className="context-card-role-usage">
                    {formatContextK(role.occupied)} / {formatContextK(role.limit)}
                  </span>
                </button>
                {expanded ? (
                  <div className="context-card-subagent-body">
                    <ContextRoleBody role={role} detailsOpen />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
