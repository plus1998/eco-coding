import { formatRoleModelLabel, formatTokenCount } from "@eco/runtime";
import { ChevronDown, X } from "lucide-react";
import { useState } from "react";
import type { ThreadContextSnapshot, ThreadRoleContextSnapshot } from "../shared/ipc";

interface ContextCardProps {
  context?: ThreadContextSnapshot;
  placeholder?: string;
  /** When false, hide the card if there is no snapshot yet. */
  showWhenEmpty?: boolean;
  onDismiss?: () => void;
}

const SUBAGENT_ROLE_SHORT: Record<string, string> = {
  explore: "探索",
  architect: "架构",
  coder: "编码",
  reviewer: "审查",
  tester: "测试",
};

function shortAgentId(agentId: string): string {
  if (agentId.length <= 8) {
    return agentId;
  }
  return agentId.slice(0, 8);
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
    visibleSegments.some((segment) => segment.key !== "conversation" || segment.label !== "会话")
  );
}

function formatSubagentsCollapsedSummary(roles: ThreadRoleContextSnapshot[]): string {
  return roles
    .map((role) => {
      const short = SUBAGENT_ROLE_SHORT[role.role] ?? role.role;
      return `${short} ${formatContextK(role.occupied)}/${formatContextK(role.limit)}`;
    })
    .join(" · ");
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
  const [subagentsOpen, setSubagentsOpen] = useState(false);

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
  const instanceEntries = [...(context.instances ?? [])]
    .filter((instance) => instance.role !== "planner" && instance.occupied > 0)
    .sort((left, right) => right.occupied - left.occupied);
  const plannerDetailed = hasDetailedBreakdown(planner);
  const showPlannerRefreshing = Boolean(context.breakdownRefreshing);

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

      {instanceEntries.length > 0 ? (
        <div className="context-card-subagents-group">
          <div className="context-card-subagents-body" aria-label="子代理上下文">
            {instanceEntries.map((instance) => (
              <section key={instance.agentId} className="context-card-subagent-entry">
                <h5 className="context-card-subagent-entry-title">
                  {(SUBAGENT_ROLE_SHORT[instance.role] ?? instance.role) + ` #${shortAgentId(instance.agentId)}`}
                </h5>
                <ContextRoleBody
                  role={{
                    role: instance.role,
                    occupied: instance.occupied,
                    limit: instance.limit,
                    occupancyPct: instance.occupancyPct,
                    limitsResolved: instance.limitsResolved,
                    segments: instance.segments,
                    ...(instance.modelId && { modelId: instance.modelId }),
                    ...(instance.maxOutputTokens !== undefined && { maxOutputTokens: instance.maxOutputTokens }),
                  }}
                  detailsOpen={false}
                />
              </section>
            ))}
          </div>
        </div>
      ) : subagentRoles.length > 0 ? (
        <div className="context-card-subagents-group">
          <button
            type="button"
            className="context-card-subagents-toggle"
            onClick={() => setSubagentsOpen((open) => !open)}
            aria-expanded={subagentsOpen}
            aria-label={subagentsOpen ? "收起子代理上下文" : "展开子代理上下文"}
          >
            <ChevronDown
              size={14}
              className={subagentsOpen ? "context-card-subagents-chevron open" : "context-card-subagents-chevron"}
              aria-hidden
            />
            <span className="context-card-subagents-toggle-label">子代理</span>
            {!subagentsOpen ? (
              <span className="context-card-subagents-collapsed-hint" title={formatSubagentsCollapsedSummary(subagentRoles)}>
                {formatSubagentsCollapsedSummary(subagentRoles)}
              </span>
            ) : null}
          </button>

          {subagentsOpen ? (
            <div className="context-card-subagents-body" aria-label="子代理上下文">
              {subagentRoles.map((role) => (
                <section key={role.role} className="context-card-subagent-entry">
                  <h5 className="context-card-subagent-entry-title">
                    {formatRoleModelLabel(role.role, role.modelId)}
                  </h5>
                  <ContextRoleBody role={role} detailsOpen={false} />
                </section>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
