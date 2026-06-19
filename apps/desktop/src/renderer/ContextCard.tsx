import { CONTEXT_SEGMENT_LABELS, contextSegmentDisplayLabel, formatTokenCount } from "@eco/runtime";
import { FoldVertical, Loader2, X } from "lucide-react";
import { useState } from "react";
import type { ThreadContextSnapshot, ThreadRoleContextSnapshot, ThreadStatus } from "../shared/ipc";
import {
  type RuntimeAgentDisplayNames,
  formatRuntimeRoleModelLabel,
  resolveRuntimeAgentName,
} from "./runtime-agent-display";

interface ContextCardProps {
  context?: ThreadContextSnapshot;
  placeholder?: string;
  /** When false, hide the card if there is no snapshot yet. */
  showWhenEmpty?: boolean;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  threadId?: string;
  threadStatus?: ThreadStatus;
  onDismiss?: () => void;
}

import { SUBAGENT_ROLE_SHORT } from "../shared/subagent-roles";

const SUBAGENT_ACCENT: Record<string, string> = {
  explore: "#38bdf8",
  architect: "#c084fc",
  coder: "#4ade80",
  reviewer: "#fb923c",
  tester: "#f472b6",
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
    visibleSegments.some(
      (segment) => segment.key !== "conversation" || segment.label !== CONTEXT_SEGMENT_LABELS.conversation,
    )
  );
}

interface FlatSubagentRow {
  key: string;
  role: ThreadRoleContextSnapshot["role"];
  title: string;
  snapshot: ThreadRoleContextSnapshot;
}

function buildFlatSubagentRows(
  instanceEntries: ThreadContextSnapshot["instances"],
  subagentRoles: ThreadRoleContextSnapshot[],
  agentDisplayNames?: RuntimeAgentDisplayNames,
): FlatSubagentRow[] {
  const instances = [...(instanceEntries ?? [])]
    .filter((instance) => instance.role !== "planner" && instance.occupied > 0)
    .sort((left, right) => right.occupied - left.occupied);

  if (instances.length > 0) {
    return instances.map((instance) => ({
      key: instance.agentId,
      role: instance.role,
      title: `${resolveRuntimeAgentName(instance.role, agentDisplayNames) ?? SUBAGENT_ROLE_SHORT[instance.role] ?? instance.role} #${shortAgentId(instance.agentId)}`,
      snapshot: {
        role: instance.role,
        occupied: instance.occupied,
        limit: instance.limit,
        occupancyPct: instance.occupancyPct,
        limitsResolved: instance.limitsResolved,
        segments: instance.segments,
        ...(instance.modelId && { modelId: instance.modelId }),
        ...(instance.maxOutputTokens !== undefined && { maxOutputTokens: instance.maxOutputTokens }),
      },
    }));
  }

  return subagentRoles.map((role) => ({
    key: role.role,
    role: role.role,
    title: formatRuntimeRoleModelLabel(role.role, role.modelId, agentDisplayNames),
    snapshot: role,
  }));
}

function subagentAccent(role: string): string {
  return SUBAGENT_ACCENT[role] ?? "#64748b";
}

function SubagentContextRow({ row }: { row: FlatSubagentRow }) {
  const role = row.snapshot;
  const visibleSegments = role.segments.filter((segment) => segment.tokens > 0);
  const occupied = role.occupied;
  const limit = role.limit;
  const segmentTotal = visibleSegments.reduce((sum, segment) => sum + segment.tokens, 0);
  const freeTokens = Math.max(limit - occupied, 0);
  const accent = subagentAccent(row.role);

  return (
    <article
      className="context-card-subagent-row"
      style={{ borderLeftColor: accent }}
      aria-label={`${row.title} 上下文`}
    >
      <div className="context-card-subagent-row-head">
        <span className="context-card-subagent-row-dot" style={{ backgroundColor: accent }} aria-hidden />
        <span className="context-card-subagent-row-title">{row.title}</span>
        <span className={pctClass(role.occupancyPct)}>{formatOccupancyLabel(role.occupancyPct)}</span>
        <span className="context-card-subagent-row-tokens">
          ~{formatContextK(occupied)}/{formatContextK(limit)}
        </span>
      </div>
      <div
        className="context-card-bar context-card-bar-subagent"
        role="img"
        aria-label={`${row.title} 约 ${formatContextK(occupied)} / ${formatContextK(limit)}`}
      >
        {occupied > 0 ? (
          <span className="context-card-bar-occupied" style={{ flexGrow: occupied }}>
            {visibleSegments.map((segment) => (
              <span
                key={`${segment.key}-${segment.label}`}
                className="context-card-bar-segment"
                style={{ flexGrow: segment.tokens, backgroundColor: segment.color }}
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
    </article>
  );
}

function ContextRoleBody({
  role,
  detailsOpen,
  agentDisplayNames,
}: {
  role: ThreadRoleContextSnapshot;
  detailsOpen: boolean;
  agentDisplayNames?: RuntimeAgentDisplayNames;
}) {
  const visibleSegments = role.segments.filter((segment) => segment.tokens > 0);
  const occupied = role.occupied;
  const limit = role.limit;
  const segmentTotal = visibleSegments.reduce((sum, segment) => sum + segment.tokens, 0);
  const freeTokens = Math.max(limit - occupied, 0);
  const detailed = hasDetailedBreakdown(role);
  const roleLabel = formatRuntimeRoleModelLabel(role.role, role.modelId, agentDisplayNames);

  return (
    <div className="context-card-role-body context-card-role-body-main">
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
                key={`${segment.key}-${segment.label}`}
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

      {detailed && detailsOpen ? (
        <ul className="context-card-breakdown">
          {visibleSegments.map((segment) => (
            <li key={`${segment.key}-${segment.label}`}>
              <span className="context-card-swatch" style={{ backgroundColor: segment.color }} />
              <span className="context-card-label">{contextSegmentDisplayLabel(segment)}</span>
              <span className="context-card-value">{formatTokenCount(segment.tokens)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {!role.limitsResolved ? (
        <p className="context-card-footnote">上限未匹配 models.dev，按 {formatContextK(role.limit)} 估算</p>
      ) : null}
    </div>
  );
}

export function ContextCard({
  context,
  placeholder,
  showWhenEmpty = true,
  agentDisplayNames,
  threadId,
  threadStatus,
  onDismiss,
}: ContextCardProps) {
  const [plannerDetailsOpen, setPlannerDetailsOpen] = useState(true);
  const [compacting, setCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const canCompact = Boolean(threadId && context && threadStatus !== "running" && !compacting);

  async function handleCompact() {
    const eco = window.eco;
    if (!threadId || !canCompact || !eco) {
      return;
    }
    setCompacting(true);
    setCompactError(null);
    try {
      const result = await eco.compactThreadContext(threadId);
      if (!result.ok) {
        setCompactError(result.message);
      }
    } catch (error) {
      setCompactError(error instanceof Error ? error.message : "上下文压缩失败");
    } finally {
      setCompacting(false);
    }
  }

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
  const flatSubagents = buildFlatSubagentRows(context.instances, subagentRoles, agentDisplayNames);
  const plannerDetailed = hasDetailedBreakdown(planner);
  const hasSubagents = flatSubagents.length > 0;

  return (
    <div className={hasSubagents ? "context-card context-card-has-subagents" : "context-card"}>
      <div className="context-card-header">
        <div className="context-card-title-group">
          <h4 className="context-card-title">Context</h4>
        </div>
        <div className="context-card-header-actions">
          {context ? (
            <button
              type="button"
              className="context-card-compact"
              onClick={() => void handleCompact()}
              disabled={!canCompact}
              aria-label="手动压缩上下文"
              title={
                compactError ??
                (threadStatus === "running"
                  ? "线程运行中，暂不可压缩"
                  : compacting
                    ? "正在压缩上下文"
                    : "手动压缩上下文")
              }
            >
              {compacting ? (
                <Loader2 size={14} aria-hidden className="context-card-compact-spinner" />
              ) : (
                <FoldVertical size={14} aria-hidden />
              )}
            </button>
          ) : null}
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

      <section className="context-card-main" aria-label="主 Agent 上下文">
        <div className="context-card-main-head">
          <span className="context-card-main-model">
            {formatRuntimeRoleModelLabel(planner.role, planner.modelId, agentDisplayNames)}
          </span>
        </div>
        <ContextRoleBody
          role={planner}
          detailsOpen={plannerDetailsOpen}
          {...(agentDisplayNames && { agentDisplayNames })}
        />
      </section>

      {hasSubagents ? (
        <div className="context-card-scroll" aria-label="子代理上下文">
          {flatSubagents.map((row) => (
            <SubagentContextRow key={row.key} row={row} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
