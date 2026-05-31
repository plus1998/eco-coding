import { formatRoleModelLabel, formatTokenCount } from "@eco/runtime";
import { X } from "lucide-react";
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

/** 占用比例文案（对齐参考图 “29% Full” = 窗口已用比例，不是“已经满了”） */
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

export function ContextCard({ context, placeholder, showWhenEmpty = true, onDismiss }: ContextCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [selectedRole, setSelectedRole] = useState<AgentRole>();

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
  const defaultRole = context.displayRole ?? roles[0]?.role ?? "planner";
  const selected =
    roles.find((role) => role.role === selectedRole) ??
    roles.find((role) => role.role === defaultRole) ??
    roles[0];
  if (!selected) {
    return null;
  }
  const visibleSegments = selected.segments.filter((segment) => segment.tokens > 0);
  const occupied = selected.occupied;
  const limit = selected.limit;
  const segmentTotal = visibleSegments.reduce((sum, segment) => sum + segment.tokens, 0);
  const freeTokens = Math.max(limit - occupied, 0);
  const showRefreshing = context.breakdownRefreshing && selected.role === "planner";

  return (
    <div className="context-card">
      <div className="context-card-header">
        <div className="context-card-title-group">
          <h4 className="context-card-title">Context</h4>
          <span className="context-card-role-badge">
            {formatRoleModelLabel(selected.role, selected.modelId)}
          </span>
        </div>
        <div className="context-card-header-actions">
          <button
            type="button"
            className="context-card-collapse"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-expanded={detailsOpen}
            aria-label={detailsOpen ? "折叠分项" : "展开分项"}
          >
            <span className="context-card-collapse-label">{detailsOpen ? "−" : "+"}</span>
          </button>
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

      <div className="context-card-summary">
        <span className={pctClass(selected.occupancyPct)}>{formatOccupancyLabel(selected.occupancyPct)}</span>
        <span className="context-card-tokens">
          ~{formatContextK(occupied)} / {formatContextK(limit)} Tokens
        </span>
      </div>

      <div
        className="context-card-bar"
        role="img"
        aria-label={`${formatRoleModelLabel(selected.role, selected.modelId)} 上下文已用 ${selected.occupancyPct}%，约 ${formatContextK(occupied)} / ${formatContextK(limit)}`}
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

      <div className="context-card-roles" role="tablist" aria-label="上下文窗口">
        {roles.map((role) => {
          const active = role.role === selected.role;
          const label = formatRoleModelLabel(role.role, role.modelId);
          return (
            <button
              type="button"
              key={role.role}
              className={active ? "context-card-role-row active" : "context-card-role-row"}
              onClick={() => setSelectedRole(role.role)}
              role="tab"
              aria-selected={active}
              title={label}
            >
              <span className="context-card-role-main">
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
          );
        })}
      </div>

      {showRefreshing ? <p className="context-card-stale">正在拉取分项明细…</p> : null}

      {detailsOpen ? (
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

      {!selected.limitsResolved ? (
        <p className="context-card-footnote">
          上限未匹配 models.dev，按 {formatContextK(selected.limit)} 估算
        </p>
      ) : null}
    </div>
  );
}
