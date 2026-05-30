import { useState } from "react";
import { X } from "lucide-react";
import { formatTokenCount } from "@eco/runtime";
import type { ThreadContextSnapshot } from "../shared/ipc";

interface ContextCardProps {
  context?: ThreadContextSnapshot;
  placeholder?: string;
  /** When false, hide the card if there is no snapshot yet. */
  showWhenEmpty?: boolean;
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

export function ContextCard({ context, placeholder, showWhenEmpty = true }: ContextCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(true);

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

  const visibleSegments = context.segments.filter((segment) => segment.tokens > 0);
  const segmentTotal = visibleSegments.reduce((sum, segment) => sum + segment.tokens, 0);
  const barTotal = Math.max(context.limit, segmentTotal, context.occupied);

  return (
    <div className="context-card">
      <div className="context-card-header">
        <h4 className="context-card-title">Context</h4>
        <button
          type="button"
          className="context-card-collapse"
          onClick={() => setDetailsOpen((open) => !open)}
          aria-expanded={detailsOpen}
          aria-label={detailsOpen ? "折叠分项" : "展开分项"}
        >
          <X size={14} aria-hidden />
        </button>
      </div>

      <div className="context-card-summary">
        <span className={pctClass(context.occupancyPct)}>{formatOccupancyLabel(context.occupancyPct)}</span>
        <span className="context-card-tokens">
          ~{formatContextK(context.occupied)} / {formatContextK(context.limit)} Tokens
        </span>
      </div>

      <div
        className="context-card-bar"
        role="img"
        aria-label={`上下文已用 ${context.occupancyPct}%，约 ${formatContextK(context.occupied)} / ${formatContextK(context.limit)}`}
      >
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
        {context.occupied < barTotal ? (
          <span
            className="context-card-bar-free"
            style={{ flexGrow: Math.max(barTotal - segmentTotal, 0) }}
          />
        ) : null}
      </div>

      {context.stale ? <p className="context-card-stale">分项数据运行中，稍后刷新…</p> : null}

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

      {!context.limitsResolved ? (
        <p className="context-card-footnote">上限未匹配 models.dev，按 {formatContextK(context.limit)} 估算</p>
      ) : null}
    </div>
  );
}
