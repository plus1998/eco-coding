import { Bot, ChevronDown, Copy, FileSearch, Pencil, RefreshCw, Reply, Search, Sparkles, Terminal } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { computeSubagentSessionDurationMs } from "../shared/subagent-session-timing";
import type {
  ThreadActivityLine,
  ThreadContextSnapshot,
  ThreadRunProjectionAgent,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
  ThreadStatus,
  ThreadSubagentSessionTiming,
  ThreadSubagentMetricsSummary,
  ThreadSummary,
  ThreadUsageSnapshot,
} from "../shared/ipc";
import { formatRoleModelLabel, formatUsageBadge, shortenModelId } from "@eco/runtime";
import { formatDurationMs } from "./AppMessage";
import { isGenericMissionSummary } from "@eco/runtime";
import {
  buildActivityLogBlocks,
  buildSubagentMetricsByAgentId,
  buildSubagentTimingsByAgentId,
  formatDuration,
  resolveSubagentRunDisplayTitle,
  thinkingPreviewLine,
  type ActivityActionIcon,
  type ActivityDetailBlock,
  type ActivityLogBlock,
  type SubagentRunItem,
} from "./activity-log";
import {
  buildThreadRunProjectionViewModel,
  isProjectionRequestActive,
  isProjectionUserPromptItem,
  projectionItemToDetailBlock,
  resolveProjectionAgentStatusText,
  type ThreadRunProjectionMainFeedEntry,
} from "./thread-run-projection-view";
import { isSubagentDisplayRole } from "../shared/subagent-roles";
import { parseWorktreeMergeMessage } from "../shared/worktree-merge";
import { MarkdownContent } from "./MarkdownContent";
import { WorkspaceChangesCard } from "./WorkspaceChangesCard";
import { useStreamRequestTiming } from "./useStreamRequestTiming";

function isThreadRequestActive(sessionRunning: boolean, threadStatus?: ThreadStatus): boolean {
  return sessionRunning && (threadStatus === "running" || threadStatus === "queued");
}

function shouldOmitSubagentIdentity(
  block: ActivityDetailBlock,
  hideSubagentIdentity?: boolean,
): boolean {
  if (!hideSubagentIdentity) {
    return false;
  }
  if (block.kind === "model-request") {
    return isSubagentDisplayRole(block.role);
  }
  if (block.kind === "phase" || block.kind === "thinking") {
    return false;
  }
  if ("subagent" in block && block.subagent) {
    return isSubagentDisplayRole(block.subagent);
  }
  return false;
}

interface ActivityLogViewProps {
  lines: ThreadActivityLine[];
  thread?: ThreadSummary;
  onRestorePrompt?: (prompt: string) => void;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  context?: ThreadContextSnapshot;
  projection?: ThreadRunProjectionSnapshot;
  subagentTimings?: ThreadSubagentSessionTiming[];
  subagentMetrics?: ThreadSubagentMetricsSummary[];
  /** Called when planner / main-window log content changes — scroll the activity feed. */
  onPlannerLayoutChange?: () => void;
}

export function ActivityLogView(props: ActivityLogViewProps) {
  if (props.projection?.sourceEventCount) {
    return (
      <ProjectionActivityLogView
        projection={props.projection}
        {...(props.thread && { thread: props.thread })}
        {...(props.onRestorePrompt && { onRestorePrompt: props.onRestorePrompt })}
        {...(props.onPlannerLayoutChange && { onPlannerLayoutChange: props.onPlannerLayoutChange })}
      />
    );
  }
  return <LegacyActivityLogView {...props} />;
}

function LegacyActivityLogView({
  lines,
  thread,
  onRestorePrompt,
  modelByRole,
  usageByRole,
  context,
  subagentTimings,
  subagentMetrics,
  onPlannerLayoutChange,
}: ActivityLogViewProps) {
  const effectiveLines = useMemo(() => {
    if (lines.some((line) => line.role === "user") || !thread?.prompt.trim()) {
      return lines;
    }
    return [{ id: `legacy-${thread.id}`, role: "user", message: thread.prompt }, ...lines];
  }, [lines, thread?.id, thread?.prompt]);

  const subagentTimingsByAgentId = useMemo(
    () => (subagentTimings ? buildSubagentTimingsByAgentId(subagentTimings) : undefined),
    [subagentTimings],
  );
  const subagentMetricsByAgentId = useMemo(
    () => (subagentMetrics ? buildSubagentMetricsByAgentId(subagentMetrics) : undefined),
    [subagentMetrics],
  );

  const blocks = useMemo(
    () =>
      buildActivityLogBlocks(effectiveLines, {
        ...(thread?.status && { status: thread.status }),
        ...(thread?.createdAt && { createdAt: thread.createdAt }),
        ...(subagentTimingsByAgentId && { subagentTimingsByAgentId }),
      }),
    [effectiveLines, subagentTimingsByAgentId, thread?.createdAt, thread?.status],
  );

  const mainFeedLayoutSignature = useMemo(
    () =>
      blocks
        .map((block) => {
          if (block.kind === "user-prompt") {
            return `u:${block.lineId}`;
          }
          if (block.kind === "assistant-message") {
            return `a:${block.text.length}:${block.streaming ? 1 : 0}`;
          }
          if (block.kind === "work-session" && block.inlineContent) {
            return `p:${block.sessionKey ?? ""}:${block.children.length}:${block.running ? 1 : 0}`;
          }
          if (block.kind === "worktree-merge") {
            return `w:${block.summary.fileCount}:${block.summary.files.length}`;
          }
          if (block.kind === "surfaced-detail") {
            if (block.block.kind === "api-error") {
              return `sf:ae:${block.block.statusCode ?? ""}:${block.block.message.length}`;
            }
            if (block.block.kind === "phase") {
              return `sf:ph:${block.block.label}:${block.block.reconnectDetail?.length ?? 0}`;
            }
            return `sf:${block.block.kind}`;
          }
          return "";
        })
        .filter(Boolean)
        .join("|"),
    [blocks],
  );

  useLayoutEffect(() => {
    onPlannerLayoutChange?.();
  }, [mainFeedLayoutSignature, onPlannerLayoutChange]);

  return (
    <div className="run-log">
      {blocks.map((block, index) => (
        <RunLogBlock
          key={
            block.kind === "work-session" && block.sessionKey
              ? block.sessionKey
              : block.kind === "subagent-run-group"
                ? `subagent-group-${block.items.map((item) => item.sessionKey).join("-")}`
              : block.kind === "user-prompt"
                ? `user-${block.lineId}`
                : `${block.kind}-${index}`
          }
          block={block}
          {...(onRestorePrompt && { onRestorePrompt })}
          {...(modelByRole && { modelByRole })}
          {...(usageByRole && { usageByRole })}
          {...(context && { context })}
          {...(subagentTimingsByAgentId && { subagentTimingsByAgentId })}
          {...(subagentMetricsByAgentId && { subagentMetricsByAgentId })}
          {...(onPlannerLayoutChange && { onPlannerLayoutChange })}
          {...(thread?.id && { threadId: thread.id })}
          {...(thread?.status && { threadStatus: thread.status })}
        />
      ))}
    </div>
  );
}

function ProjectionActivityLogView({
  projection,
  thread,
  onRestorePrompt,
  onPlannerLayoutChange,
}: {
  projection: ThreadRunProjectionSnapshot;
  thread?: ThreadSummary;
  onRestorePrompt?: (prompt: string) => void;
  onPlannerLayoutChange?: () => void;
}) {
  const requestSpansById = useMemo(
    () => new Map(projection.requestSpans.map((span) => [span.requestId, span])),
    [projection.requestSpans],
  );
  const viewModel = useMemo(
    () =>
      buildThreadRunProjectionViewModel(
        projection,
        thread ? { id: thread.id, prompt: thread.prompt } : undefined,
      ),
    [projection, thread?.id, thread?.prompt],
  );
  const [expandedAgentKeys, setExpandedAgentKeys] = useState<Record<string, boolean>>({});
  const showThreadPrompt = viewModel.showThreadPrompt;
  const layoutSignature = useMemo(
    () =>
      [
        showThreadPrompt ? `prompt:${thread?.id ?? ""}:${thread?.prompt.length ?? 0}` : "",
        ...viewModel.mainFeedEntries.map((entry) => {
          if (entry.kind === "timeline" || entry.kind === "agent-echo") {
            return `${entry.key}:${entry.item.text.length}`;
          }
          const lastItem = entry.card.agent.timeline.at(-1);
          return [
            entry.key,
            entry.card.agent.status,
            entry.card.agent.durationMs,
            entry.card.statusText?.length ?? 0,
            lastItem?.id ?? "",
          ].join(":");
        }),
      ]
        .filter(Boolean)
        .join("|"),
    [showThreadPrompt, thread?.id, thread?.prompt, viewModel.mainFeedEntries],
  );

  useLayoutEffect(() => {
    onPlannerLayoutChange?.();
  }, [layoutSignature, onPlannerLayoutChange]);

  return (
    <div className="run-log">
      {showThreadPrompt && thread?.prompt ? (
        <UserPromptBlock
          text={thread.prompt}
          {...(onRestorePrompt && { onRestorePrompt })}
        />
      ) : null}
      {viewModel.mainFeedEntries.map((entry) => (
        <ProjectionMainFeedEntry
          key={entry.key}
          entry={entry}
          requestSpansById={requestSpansById}
          expandedAgentKeys={expandedAgentKeys}
          onToggleAgent={(agentId) => {
            setExpandedAgentKeys((current) => ({
              ...current,
              [agentId]: !current[agentId],
            }));
          }}
          {...(onRestorePrompt && { onRestorePrompt })}
        />
      ))}
    </div>
  );
}

function ProjectionMainFeedEntry({
  entry,
  requestSpansById,
  expandedAgentKeys,
  onToggleAgent,
  onRestorePrompt,
}: {
  entry: ThreadRunProjectionMainFeedEntry;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
  expandedAgentKeys: Record<string, boolean>;
  onToggleAgent: (agentId: string) => void;
  onRestorePrompt?: (prompt: string) => void;
}) {
  if (entry.kind === "timeline") {
    return (
      <ProjectionTimelineEntry
        item={entry.item}
        requestSpansById={requestSpansById}
        {...(onRestorePrompt && { onRestorePrompt })}
      />
    );
  }
  if (entry.kind === "agent-card") {
    return (
      <ProjectionSubagentRunRow
        agent={entry.card.agent}
        requestSpansById={requestSpansById}
        expanded={Boolean(expandedAgentKeys[entry.card.key])}
        onToggle={() => onToggleAgent(entry.card.key)}
      />
    );
  }
  return (
    <ProjectionAgentEchoEntry
      entry={entry}
      requestSpansById={requestSpansById}
    />
  );
}

function ProjectionAgentEchoEntry({
  entry,
  requestSpansById,
}: {
  entry: Extract<ThreadRunProjectionMainFeedEntry, { kind: "agent-echo" }>;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
}) {
  const block = projectionItemToDetailBlock(entry.item);
  if (!block) {
    return null;
  }
  const requestSpan = entry.item.requestId ? requestSpansById.get(entry.item.requestId) : undefined;
  const requestActive = isProjectionRequestActive(requestSpan);

  if (block.kind === "narrative") {
    return (
      <ProjectionAgentEchoShell label={entry.agentLabel} agentId={entry.agent.agentId}>
        <RunLogNarrative
          text={block.text}
          {...(block.streaming !== undefined && { streaming: block.streaming })}
          omitSubagentBadge
        />
      </ProjectionAgentEchoShell>
    );
  }
  if (block.kind === "thinking") {
    return (
      <ProjectionAgentEchoShell label={entry.agentLabel} agentId={entry.agent.agentId}>
        <ThinkingBlock
          text={block.text}
          {...(block.streaming !== undefined && { streaming: block.streaming })}
        />
      </ProjectionAgentEchoShell>
    );
  }
  return (
    <ProjectionAgentEchoShell label={entry.agentLabel} agentId={entry.agent.agentId}>
      <DetailBlock
        block={block}
        requestActive={requestActive}
        hideSubagentIdentity
      />
    </ProjectionAgentEchoShell>
  );
}

function ProjectionAgentEchoShell({
  label,
  agentId,
  children,
}: {
  label: string;
  agentId: string;
  children: ReactNode;
}) {
  return (
    <div className="run-log-agent-echo" data-agent-id={agentId}>
      <span className="run-log-subagent-badge run-log-agent-echo-badge" title={agentId}>
        {label}
      </span>
      {children}
    </div>
  );
}

function ProjectionSubagentRunRow({
  agent,
  requestSpansById,
  expanded,
  onToggle,
}: {
  agent: ThreadRunProjectionAgent;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const running = agent.status === "active" || agent.status === "launching";
  const [liveDurationMs, setLiveDurationMs] = useState(agent.durationMs);

  useEffect(() => {
    if (!running) {
      setLiveDurationMs(agent.durationMs);
      return;
    }
    const baselineMs = agent.durationMs;
    const anchorAt = Date.now();
    const tick = () => setLiveDurationMs(baselineMs + (Date.now() - anchorAt));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [agent.agentId, agent.durationMs, running]);

  const roleLabel = resolveSubagentRunDisplayTitle(agent.role);
  const modelId = agent.usage?.modelId ?? agent.context?.modelId;
  const modelShort = modelId?.trim() ? shortenModelId(modelId.trim()) : undefined;
  const statusText =
    resolveProjectionAgentStatusText(agent) ??
    (running ? "工作中" : "点击查看执行详情");
  const elapsedMs = running ? liveDurationMs : agent.durationMs;
  const durationLabel =
    elapsedMs > 0
      ? running
        ? formatDuration(elapsedMs)
        : `用时 ${formatDuration(elapsedMs)}`
      : undefined;
  const hasDetails = agent.timeline.length > 0 || Boolean(agent.usage || agent.context);

  return (
    <div className="subagent-run-row-wrap has-agent-id" data-agent-id={agent.agentId}>
      <button
        type="button"
        className="subagent-run-row"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <Sparkles size={14} className="subagent-run-icon" aria-hidden />
        <div className="subagent-run-main">
          <div className="subagent-run-title-row">
            <span className="subagent-run-title-group">
              <span className="subagent-run-title">
                <span className="subagent-run-title-role">{roleLabel}</span>
                {modelShort ? (
                  <>
                    <span className="subagent-run-title-sep" aria-hidden>
                      ·
                    </span>
                    <span className="subagent-run-title-model">{modelShort}</span>
                  </>
                ) : null}
              </span>
              <span className="subagent-run-agent-chip" title={agent.agentId}>
                #{shortSubagentAgentId(agent.agentId)}
              </span>
            </span>
            <span className="subagent-run-title-trailing">
              {durationLabel ? <span className="subagent-run-duration">{durationLabel}</span> : null}
              {running ? <span className="subagent-run-loading" aria-hidden /> : null}
              <ChevronDown
                size={16}
                className={expanded ? "subagent-run-chevron open" : "subagent-run-chevron"}
                aria-hidden
              />
            </span>
          </div>
          <p className="subagent-run-status" title={statusText}>
            {statusText}
          </p>
        </div>
      </button>
      {expanded && hasDetails ? (
        <div className="work-session-details-compact">
          <ProjectionSubagentRunInstanceStrip agent={agent} />
          {agent.timeline.length > 0 ? (
            <>
              <p className="work-session-details-compact-title">子代理执行详情</p>
              <div className="work-session-details-compact-scroll">
                {agent.timeline.map((item) => (
                  <ProjectionTimelineEntry
                    key={`${agent.agentId}-${item.id}`}
                    item={item}
                    requestSpansById={requestSpansById}
                    compact
                  />
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ProjectionSubagentRunInstanceStrip({ agent }: { agent: ThreadRunProjectionAgent }) {
  const contextLabel =
    agent.context && agent.context.limit > 0
      ? `上下文 ${agent.context.occupancyPct}%`
      : undefined;
  const modelId = agent.usage?.modelId ?? agent.context?.modelId;

  if (!agent.usage && !contextLabel && !modelId) {
    return null;
  }

  return (
    <div className="subagent-run-instance-strip" aria-label="子代理实例">
      {agent.usage ? (
        <span className="subagent-run-instance-usage">
          {formatUsageBadge({
            inputTokens: agent.usage.inputTokens,
            outputTokens: agent.usage.outputTokens,
            cacheReadTokens: agent.usage.cacheReadTokens,
            cacheCreationTokens: agent.usage.cacheCreationTokens,
          })}
          {agent.usage.ecoCostUsd > 0 ? ` · $${agent.usage.ecoCostUsd.toFixed(4)}` : ""}
        </span>
      ) : null}
      {contextLabel ? <span className="subagent-run-instance-context">{contextLabel}</span> : null}
      {modelId ? <span className="subagent-run-instance-model">{shortenModelId(modelId)}</span> : null}
    </div>
  );
}

function ProjectionTimelineEntry({
  item,
  requestSpansById,
  onRestorePrompt,
  compact = false,
}: {
  item: ThreadRunProjectionTimelineItem;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
  onRestorePrompt?: (prompt: string) => void;
  compact?: boolean;
}) {
  if (isProjectionUserPromptItem(item)) {
    if (compact) {
      return null;
    }
    return (
      <UserPromptBlock
        text={item.text}
        {...(onRestorePrompt && { onRestorePrompt })}
      />
    );
  }

  const block = projectionItemToDetailBlock(item);
  if (!block) {
    return null;
  }

  const requestSpan = item.requestId ? requestSpansById.get(item.requestId) : undefined;
  const requestActive = isProjectionRequestActive(requestSpan);

  if (block.kind === "narrative") {
    return (
      <RunLogNarrative
        text={block.text}
        {...(block.streaming !== undefined && { streaming: block.streaming })}
        {...(block.subagent && { subagent: block.subagent })}
        omitSubagentBadge={compact || isSubagentDisplayRole(block.subagent)}
        compact={compact}
      />
    );
  }
  if (block.kind === "thinking") {
    return (
      <ThinkingBlock
        text={block.text}
        {...(block.streaming !== undefined && { streaming: block.streaming })}
      />
    );
  }
  if (block.kind === "phase") {
    return (
      <PhaseBlock
        label={block.label}
        {...(block.reconnecting && { reconnecting: block.reconnecting })}
        {...(block.reconnectDetail && { reconnectDetail: block.reconnectDetail })}
      />
    );
  }

  return (
    <div className={compact ? undefined : "run-log-surfaced-detail"}>
      <DetailBlock
        block={block}
        requestActive={requestActive}
        hideSubagentIdentity={compact}
      />
    </div>
  );
}

function RunLogBlock({
  block,
  onRestorePrompt,
  modelByRole,
  usageByRole,
  context,
  subagentTimingsByAgentId,
  subagentMetricsByAgentId,
  onPlannerLayoutChange,
  threadId,
  threadStatus,
}: {
  block: ActivityLogBlock;
  onRestorePrompt?: (prompt: string) => void;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  context?: ThreadContextSnapshot;
  subagentTimingsByAgentId?: Record<string, ThreadSubagentSessionTiming>;
  subagentMetricsByAgentId?: Record<string, ThreadSubagentMetricsSummary>;
  onPlannerLayoutChange?: () => void;
  threadId?: string;
  threadStatus?: ThreadStatus;
}) {
  if (block.kind === "user-prompt") {
    return <UserPromptBlock text={block.text} {...(onRestorePrompt && { onRestorePrompt })} />;
  }
  if (block.kind === "work-session") {
    return (
      <WorkSessionBlock
        block={block}
        {...(modelByRole && { modelByRole })}
        {...(usageByRole && { usageByRole })}
        {...(onPlannerLayoutChange && { onPlannerLayoutChange })}
        {...(threadStatus && { threadStatus })}
      />
    );
  }
  if (block.kind === "subagent-run-group") {
    return (
      <SubagentRunGroup
        block={block}
        requestActive={isThreadRequestActive(
          block.items.some((item) => item.running),
          threadStatus,
        )}
        {...(modelByRole && { modelByRole })}
        {...(usageByRole && { usageByRole })}
        {...(subagentTimingsByAgentId && { subagentTimingsByAgentId })}
        {...(subagentMetricsByAgentId && { subagentMetricsByAgentId })}
        {...(context && { context })}
      />
    );
  }
  if (block.kind === "assistant-message") {
    return (
      <AssistantMessageBlock
        text={block.text}
        {...(block.streaming !== undefined && { streaming: block.streaming })}
        {...(block.subagent && { subagent: block.subagent })}
        {...(modelByRole && { modelByRole })}
        {...(usageByRole && { usageByRole })}
        {...(threadId && { threadId })}
      />
    );
  }
  if (block.kind === "worktree-merge") {
    return (
      <WorkspaceChangesCard
        summary={block.summary}
        {...(threadId && { threadId })}
      />
    );
  }
  if (block.kind === "surfaced-detail") {
    const requestActive =
      threadStatus === "running" || threadStatus === "queued";
    return (
      <div className="run-log-surfaced-detail">
        <DetailBlock
          block={block.block}
          requestActive={requestActive}
          {...(modelByRole && { modelByRole })}
          {...(usageByRole && { usageByRole })}
        />
      </div>
    );
  }
  return null;
}

function shortSubagentAgentId(agentId: string): string {
  if (agentId.length <= 8) {
    return agentId;
  }
  return agentId.slice(-8);
}

function metricsToUsageSnapshot(metrics: ThreadSubagentMetricsSummary): ThreadUsageSnapshot {
  const limit = metrics.contextLimit ?? 0;
  const occupied = metrics.contextOccupied;
  return {
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    cacheReadTokens: metrics.cacheReadTokens,
    cacheCreationTokens: metrics.cacheCreationTokens,
    contextTokens: occupied,
    ...(limit > 0 && { contextLimit: limit, occupancyPct: Math.round((occupied / limit) * 100) }),
    ...(metrics.modelId && { modelId: metrics.modelId }),
  };
}

function SubagentRunInstanceStrip({
  agentId,
  role,
  metrics,
  context,
  modelByRole,
}: {
  agentId?: string;
  role: string;
  metrics?: ThreadSubagentMetricsSummary;
  context?: ThreadContextSnapshot;
  modelByRole?: Record<string, string>;
}) {
  const instance = agentId
    ? context?.instances?.find((entry) => entry.agentId === agentId)
    : undefined;
  const contextLabel =
    instance && instance.limit > 0
      ? `上下文 ${Math.round((instance.occupied / instance.limit) * 100)}%`
      : metrics && metrics.contextLimit && metrics.contextLimit > 0
        ? `上下文 ${Math.round((metrics.contextOccupied / metrics.contextLimit) * 100)}%`
        : undefined;

  return (
    <div className="subagent-run-instance-strip" aria-label="子代理实例">
      {metrics ? (
        <span className="subagent-run-instance-usage">
          {formatUsageBadge({
            inputTokens: metrics.inputTokens,
            outputTokens: metrics.outputTokens,
            cacheReadTokens: metrics.cacheReadTokens,
            cacheCreationTokens: metrics.cacheCreationTokens,
          })}
          {metrics.ecoCostUsd > 0 ? ` · $${metrics.ecoCostUsd.toFixed(4)}` : ""}
        </span>
      ) : null}
      {contextLabel ? <span className="subagent-run-instance-context">{contextLabel}</span> : null}
    </div>
  );
}

function SubagentRunRow({
  item,
  expanded,
  onToggle,
  requestActive,
  modelByRole,
  usageByRole,
  context,
  subagentTimingsByAgentId,
  subagentMetricsByAgentId,
}: {
  item: SubagentRunItem;
  expanded: boolean;
  onToggle: () => void;
  requestActive: boolean;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  context?: ThreadContextSnapshot;
  subagentTimingsByAgentId?: Record<string, ThreadSubagentSessionTiming>;
  subagentMetricsByAgentId?: Record<string, ThreadSubagentMetricsSummary>;
}) {
  const persistedTiming = item.agentId ? subagentTimingsByAgentId?.[item.agentId] : undefined;
  const [liveDurationMs, setLiveDurationMs] = useState(item.runDurationMs ?? 0);
  const durationMs = item.runDurationMs ?? 0;

  useEffect(() => {
    if (!item.running) {
      setLiveDurationMs(durationMs);
      return;
    }
    if (persistedTiming) {
      const tick = () => setLiveDurationMs(computeSubagentSessionDurationMs(persistedTiming));
      tick();
      const timer = setInterval(tick, 1000);
      return () => clearInterval(timer);
    }
    const baselineMs = durationMs;
    const anchorAt = Date.now();
    const tick = () => setLiveDurationMs(baselineMs + (Date.now() - anchorAt));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [durationMs, item.running, item.sessionKey, persistedTiming]);

  const instanceMetrics = item.agentId ? subagentMetricsByAgentId?.[item.agentId] : undefined;
  const roleLabel = resolveSubagentRunDisplayTitle(item.role);
  const modelId = instanceMetrics?.modelId ?? modelByRole?.[item.role];
  const modelShort = modelId?.trim() ? shortenModelId(modelId.trim()) : undefined;
  const titleWithModel = formatRoleModelLabel(item.role, modelId);
  const rawStatus = item.statusLine?.trim();
  const statusText =
    rawStatus && rawStatus !== titleWithModel && rawStatus !== roleLabel
      ? rawStatus
      : item.running
        ? "工作中"
        : "点击查看执行详情";
  const elapsedMs = item.running ? liveDurationMs : durationMs;
  const durationLabel =
    elapsedMs > 0
      ? item.running
        ? formatDuration(elapsedMs)
        : `用时 ${formatDuration(elapsedMs)}`
      : undefined;
  const usageForAgent = instanceMetrics ? metricsToUsageSnapshot(instanceMetrics) : undefined;
  const scopedUsageByRole =
    usageForAgent !== undefined ? { [item.role]: usageForAgent } : usageByRole;

  return (
    <div
      className={`subagent-run-row-wrap${item.agentId ? " has-agent-id" : ""}`}
      data-agent-id={item.agentId}
    >
      <button
        type="button"
        className="subagent-run-row"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <Sparkles size={14} className="subagent-run-icon" aria-hidden />
        <div className="subagent-run-main">
          <div className="subagent-run-title-row">
            <span className="subagent-run-title-group">
              <span className="subagent-run-title">
                <span className="subagent-run-title-role">{roleLabel}</span>
                {modelShort ? (
                  <>
                    <span className="subagent-run-title-sep" aria-hidden>
                      ·
                    </span>
                    <span className="subagent-run-title-model">{modelShort}</span>
                  </>
                ) : null}
              </span>
              {item.agentId ? (
                <span className="subagent-run-agent-chip" title={item.agentId}>
                  #{shortSubagentAgentId(item.agentId)}
                </span>
              ) : null}
            </span>
            <span className="subagent-run-title-trailing">
              {durationLabel ? <span className="subagent-run-duration">{durationLabel}</span> : null}
              {item.running ? <span className="subagent-run-loading" aria-hidden /> : null}
              <ChevronDown
                size={16}
                className={expanded ? "subagent-run-chevron open" : "subagent-run-chevron"}
                aria-hidden
              />
            </span>
          </div>
          <p className="subagent-run-status" title={statusText}>
            {statusText}
          </p>
        </div>
      </button>
      {expanded && item.children.length > 0 ? (
        <div className="work-session-details-compact">
          <SubagentRunInstanceStrip
            {...(item.agentId && { agentId: item.agentId })}
            role={item.role}
            {...(instanceMetrics && { metrics: instanceMetrics })}
            {...(context && { context })}
            {...(modelByRole && { modelByRole })}
          />
          <p className="work-session-details-compact-title">子代理执行详情</p>
          <div className="work-session-details-compact-scroll">
            {item.children.map((child, index) => (
              <DetailBlock
                key={`${item.sessionKey}-${child.kind}-${index}`}
                block={child}
                hideSubagentIdentity
                requestActive={requestActive}
                {...(modelByRole && { modelByRole })}
                {...(scopedUsageByRole && { usageByRole: scopedUsageByRole })}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SubagentRunGroup({
  block,
  requestActive,
  modelByRole,
  usageByRole,
  context,
  subagentTimingsByAgentId,
  subagentMetricsByAgentId,
}: {
  block: Extract<ActivityLogBlock, { kind: "subagent-run-group" }>;
  requestActive: boolean;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  context?: ThreadContextSnapshot;
  subagentTimingsByAgentId?: Record<string, ThreadSubagentSessionTiming>;
  subagentMetricsByAgentId?: Record<string, ThreadSubagentMetricsSummary>;
}) {
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  return (
    <section className={`subagent-run-group${block.parallel ? " parallel" : ""}`}>
      {block.items.map((item) => (
        <SubagentRunRow
          key={item.sessionKey}
          item={item}
          expanded={Boolean(expandedKeys[item.sessionKey])}
          requestActive={requestActive}
          {...(modelByRole && { modelByRole })}
          {...(usageByRole && { usageByRole })}
          {...(context && { context })}
          {...(subagentTimingsByAgentId && { subagentTimingsByAgentId })}
          {...(subagentMetricsByAgentId && { subagentMetricsByAgentId })}
          onToggle={() => {
            setExpandedKeys((current) => ({
              ...current,
              [item.sessionKey]: !current[item.sessionKey],
            }));
          }}
        />
      ))}
    </section>
  );
}

function WorkSessionBlock({
  block,
  modelByRole,
  usageByRole,
  onPlannerLayoutChange,
  threadStatus,
}: {
  block: Extract<ActivityLogBlock, { kind: "work-session" }>;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  onPlannerLayoutChange?: () => void;
  threadStatus?: ThreadStatus;
}) {
  const requestActive = isThreadRequestActive(block.running, threadStatus);
  const [expanded, setExpanded] = useState(() => !block.defaultCollapsed);

  useLayoutEffect(() => {
    if (!block.inlineContent) {
      return;
    }
    onPlannerLayoutChange?.();
  }, [
    block.awaitingFirstToken,
    block.children,
    block.inlineContent,
    block.running,
    onPlannerLayoutChange,
  ]);

  const activeLabel = block.activeSubagent
    ? formatRoleModelLabel(block.activeSubagent, modelByRole?.[block.activeSubagent])
    : "";

  const label = block.running
    ? `处理中${activeLabel ? ` · ${activeLabel}` : ""}…`
    : `已处理 ${formatDuration(block.durationMs)}`;

  if (block.inlineContent) {
    return (
      <section className="work-session work-session-inline">
        {block.children.length > 0 ? (
          <div className="work-session-details">
            {block.children.map((child, index) => (
              <DetailBlock
                key={`${child.kind}-${index}`}
                block={child}
                requestActive={requestActive}
                {...(modelByRole && { modelByRole })}
                {...(usageByRole && { usageByRole })}
              />
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="work-session">
      <button
        type="button"
        className="work-session-toggle"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        disabled={block.running && block.children.length === 0 && !block.awaitingFirstToken}
      >
        <span className={`work-session-dot${block.running ? " running" : ""}`} />
        <span className="work-session-label">
          {label}
          {block.activeMissionSummary ? (
            <span className="work-session-mission">{block.activeMissionSummary}</span>
          ) : null}
        </span>
        {!block.running && block.children.length > 0 ? (
          <ChevronDown size={16} className={expanded ? "work-session-chevron" : "work-session-chevron collapsed"} />
        ) : null}
      </button>
      {expanded && block.children.length > 0 ? (
        <div className="work-session-details">
          {block.children.map((child, index) => (
            <DetailBlock
              key={`${child.kind}-${index}`}
              block={child}
              requestActive={requestActive}
              {...(modelByRole && { modelByRole })}
              {...(usageByRole && { usageByRole })}
            />
          ))}
        </div>
      ) : null}
      {!expanded && !block.running && block.children.length > 0 ? (
        <ul className="work-session-preview" aria-label="步骤摘要">
          {block.children
            .filter(
              (child) =>
                child.kind === "phase" || child.kind === "subagent-mission",
            )
            .slice(-4)
            .map((child, index) => (
              <li key={`preview-${index}`}>
                {child.kind === "subagent-mission" ? child.summary : child.label}
              </li>
            ))}
        </ul>
      ) : null}
    </section>
  );
}

function DetailBlock({
  block,
  modelByRole,
  usageByRole,
  hideSubagentIdentity,
  requestActive = false,
}: {
  block: ActivityDetailBlock;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  hideSubagentIdentity?: boolean;
  requestActive?: boolean;
}) {
  const omitSubagent = shouldOmitSubagentIdentity(block, hideSubagentIdentity);

  if (block.kind === "phase") {
    return (
      <PhaseBlock
        label={block.label}
        {...(block.reconnecting && { reconnecting: block.reconnecting })}
        {...(block.reconnectDetail && { reconnectDetail: block.reconnectDetail })}
      />
    );
  }
  if (block.kind === "subagent-mission") {
    return (
      <SubagentMissionBlock
        subagent={block.subagent}
        summary={block.summary}
        {...(block.prompt !== undefined && { prompt: block.prompt })}
        omitRoleLabel={omitSubagent}
        {...(!omitSubagent && modelByRole && { modelByRole })}
      />
    );
  }
  if (block.kind === "model-request") {
    return (
      <ModelRequestBlock
        active={requestActive}
        {...(block.role && { role: block.role })}
        omitRoleLabel={omitSubagent}
        {...(!omitSubagent && modelByRole && { modelByRole })}
      />
    );
  }
  if (block.kind === "agent-request") {
    return (
      <AgentRequestBlock
        active={requestActive}
        {...(block.subagent && { subagent: block.subagent })}
        omitRoleLabel={omitSubagent}
        {...(!omitSubagent && modelByRole && { modelByRole })}
      />
    );
  }
  if (block.kind === "action") {
    return (
      <RunLogAction
        icon={block.icon}
        label={block.label}
        {...(block.subagent && { subagent: block.subagent })}
        omitRoleLabel={omitSubagent}
        {...(!omitSubagent && modelByRole && { modelByRole })}
      />
    );
  }
  if (block.kind === "tool-failed") {
    return (
      <ToolFailedBlock
        tool={block.tool}
        {...(block.error && { error: block.error })}
        {...(block.subagent && { subagent: block.subagent })}
        omitRoleLabel={omitSubagent}
        {...(!omitSubagent && modelByRole && { modelByRole })}
      />
    );
  }
  if (block.kind === "api-error") {
    return (
      <ApiErrorBlock
        message={block.message}
        {...(block.statusCode !== undefined && { statusCode: block.statusCode })}
        {...(block.subagent && { subagent: block.subagent })}
        omitRoleLabel={omitSubagent}
        {...(!omitSubagent && modelByRole && { modelByRole })}
      />
    );
  }
  if (block.kind === "thinking") {
    return (
      <ThinkingBlock
        text={block.text}
        {...(block.streaming !== undefined && { streaming: block.streaming })}
      />
    );
  }
  if (block.kind === "worktree-merge") {
    return <WorkspaceChangesCard summary={block.summary} />;
  }
  if (block.kind !== "narrative") {
    return null;
  }
  return (
    <RunLogNarrative
      text={block.text}
      {...(block.streaming !== undefined && { streaming: block.streaming })}
      {...(block.subagent && { subagent: block.subagent })}
      omitSubagentBadge={omitSubagent}
      {...(!omitSubagent && modelByRole && { modelByRole })}
      {...(!omitSubagent && usageByRole && { usageByRole })}
      compact
    />
  );
}

function PhaseBlock({
  label,
  reconnecting,
  reconnectDetail,
}: {
  label: string;
  reconnecting?: boolean;
  reconnectDetail?: string;
}) {
  if (reconnecting) {
    const isFailure = label.startsWith("连接失败");
    const className = `run-log-reconnect${isFailure ? " run-log-reconnect--failed" : ""}`;
    const summaryRow = (
      <>
        <RefreshCw size={14} className="run-log-reconnect-icon spinning" aria-hidden />
        <span>{label}</span>
      </>
    );
    if (!reconnectDetail) {
      return (
        <div className={`${className} run-log-reconnect-inline`} role="status" aria-live="polite">
          {summaryRow}
        </div>
      );
    }
    return (
      <details className={className} role="status" aria-live="polite">
        <summary className="run-log-reconnect-summary">{summaryRow}</summary>
        <pre className="run-log-reconnect-detail">{reconnectDetail}</pre>
      </details>
    );
  }
  return <div className="run-log-phase">{label}</div>;
}

function RequestTimingBadge({
  timing,
}: {
  timing: ReturnType<typeof useStreamRequestTiming>;
}) {
  if (timing.phase === "idle") {
    return null;
  }
  if (timing.phase === "waiting") {
    return (
      <span className="run-log-request-timing" aria-live="polite">
        等待 {formatDurationMs(timing.waitingMs)}
      </span>
    );
  }
  return (
    <span className="run-log-request-timing done" aria-live="polite">
      首 token {formatDurationMs(timing.ttftMs ?? 0)}
    </span>
  );
}

function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [collapsed, setCollapsed] = useState(true);
  const hasBody = text.trim().length > 0;
  const preview = hasBody ? thinkingPreviewLine(text) : "";
  const showPreview = hasBody && collapsed && !streaming;
  const showFullBody = hasBody && (streaming || !collapsed);
  const timing = useStreamRequestTiming(Boolean(streaming) && !hasBody, hasBody);

  return (
    <div
      className={[
        "run-log-thinking",
        streaming ? "streaming" : "",
        !hasBody && streaming ? "empty" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="run-log-thinking-header"
        onClick={() => {
          if (!streaming) {
            setCollapsed((value) => !value);
          }
        }}
        aria-expanded={showFullBody}
        disabled={streaming && !hasBody}
      >
        <span className="run-log-thinking-label">
          {timing.phase === "waiting" && timing.elapsedMs > 0
            ? `思考 ${formatDuration(timing.elapsedMs)}`
            : "思考"}
        </span>
        {showPreview ? (
          <span className="run-log-thinking-preview" title={preview}>
            {preview}
          </span>
        ) : null}
        {!streaming && hasBody ? (
          <ChevronDown
            size={14}
            className={collapsed ? "run-log-thinking-chevron" : "run-log-thinking-chevron open"}
            aria-hidden
          />
        ) : null}
      </button>
      {showFullBody ? (
        <div className="run-log-thinking-body">
          <MarkdownContent text={text} />
          {streaming ? <span className="run-log-cursor" aria-hidden /> : null}
        </div>
      ) : null}
    </div>
  );
}

function UserPromptBlock({
  text,
  onRestorePrompt,
}: {
  text: string;
  onRestorePrompt?: (prompt: string) => void;
}) {
  const bodyRef = useRef<HTMLPreElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canToggle, setCanToggle] = useState(false);

  useLayoutEffect(() => {
    setCanToggle(false);
    const body = bodyRef.current;
    if (!body || expanded) {
      return;
    }

    const measure = () => {
      if (body.scrollHeight > body.clientHeight + 1) {
        setCanToggle(true);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <article className="run-log-user-prompt">
      <div className="run-log-user-prompt-content">
        <div
          className={[
            "run-log-user-prompt-body-wrap",
            !expanded ? "collapsed" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <pre
            ref={bodyRef}
            className={[
              "run-log-user-prompt-body",
              !expanded ? "collapsed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {text}
          </pre>
          {canToggle && !expanded ? <div className="run-log-user-prompt-fade" aria-hidden /> : null}
        </div>
        {canToggle ? (
          <button
            type="button"
            className="run-log-user-prompt-expand"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? "收起" : "展开全文"}
          </button>
        ) : null}
      </div>
      {onRestorePrompt ? (
        <div className="run-log-user-prompt-actions">
          <button
            type="button"
            className="run-log-user-prompt-action"
            onClick={() => onRestorePrompt(text)}
            aria-label="回到此节点"
            title="填入输入框"
          >
            <Reply size={14} />
          </button>
        </div>
      ) : null}
    </article>
  );
}

function AssistantMessageBlock({
  text,
  streaming,
  subagent,
  modelByRole,
  usageByRole,
  threadId,
}: {
  text: string;
  streaming?: boolean;
  subagent?: string;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  threadId?: string;
}) {
  const clarificationRows = parseClarificationAnswersSummary(text);
  if (clarificationRows) {
    return <ClarificationAnswersCard rows={clarificationRows} />;
  }
  const worktreeMergeSummary = !streaming ? parseWorktreeMergeMessage(text) : null;
  if (worktreeMergeSummary) {
    return <WorkspaceChangesCard summary={worktreeMergeSummary} {...(threadId && { threadId })} />;
  }
  return (
    <RunLogNarrative
      text={text}
      {...(streaming !== undefined && { streaming })}
      {...(subagent && { subagent })}
      omitSubagentBadge={isSubagentDisplayRole(subagent)}
      {...(modelByRole && { modelByRole })}
      {...(usageByRole && { usageByRole })}
    />
  );
}

const CLARIFICATION_ANSWER_PREFIX = "澄清回答：";

function parseClarificationAnswersSummary(text: string): Array<{ question: string; answer: string }> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(CLARIFICATION_ANSWER_PREFIX)) {
    return null;
  }

  const rest = trimmed.slice(CLARIFICATION_ANSWER_PREFIX.length).trim();
  if (!rest) {
    return [];
  }

  // formatClarificationAnswersSummary uses "；" between questions and " → " between question and answer.
  const parts = rest
    .split("；")
    .map((p) => p.trim())
    .filter(Boolean);

  const rows = parts.map((part) => {
    const segs = part.split(/\s*→\s*/u);
    const question = (segs[0] ?? "").trim() || part.trim();
    const answer = segs.slice(1).join(" → ").trim();
    return { question, answer };
  });

  return rows;
}

function ClarificationAnswersCard({ rows }: { rows: Array<{ question: string; answer: string }> }) {
  return (
    <div className="clarification-answer-card" role="group" aria-label="澄清回答">
      <div className="clarification-answer-header">
        <span className="clarification-answer-title">澄清回答</span>
      </div>
      <div className="clarification-answer-rows">
        {rows.map((row, index) => (
          <div key={index} className="clarification-answer-row">
            <div className="clarification-answer-question">{row.question}</div>
            <div className="clarification-answer-answer">{row.answer}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModelRequestBlock({
  role,
  modelByRole,
  omitRoleLabel,
  active = false,
}: {
  role?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
  active?: boolean;
}) {
  const timing = useStreamRequestTiming(active, false);
  const roleLabel = omitRoleLabel
    ? "请求中"
    : role
      ? formatRoleModelLabel(role, modelByRole?.[role])
      : "模型";

  return (
    <div className="run-log-agent-request run-log-model-request">
      <Bot size={16} className="run-log-agent-request-icon" aria-hidden />
      <span className="run-log-agent-request-label">
        {omitRoleLabel ? roleLabel : `${roleLabel} 请求中`}
        <RequestTimingBadge timing={timing} />
      </span>
    </div>
  );
}

function AgentRequestBlock({
  subagent,
  modelByRole,
  omitRoleLabel,
  active = false,
}: {
  subagent?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
  active?: boolean;
}) {
  const timing = useStreamRequestTiming(active, false);
  const roleLabel = omitRoleLabel
    ? "请求中"
    : subagent
      ? formatRoleModelLabel(subagent, modelByRole?.[subagent])
      : "子代理";

  return (
    <div className="run-log-agent-request">
      <Bot size={16} className="run-log-agent-request-icon" aria-hidden />
      <span className="run-log-agent-request-label">
        {omitRoleLabel ? roleLabel : `${roleLabel} 请求中`}
        <RequestTimingBadge timing={timing} />
      </span>
    </div>
  );
}

function SubagentMissionBlock({
  subagent,
  summary,
  prompt,
  modelByRole,
  omitRoleLabel,
}: {
  subagent: string;
  summary: string;
  prompt?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
}) {
  const trimmedPrompt = prompt?.trim() ?? "";
  const genericSummary = isGenericMissionSummary(summary);
  const showPrompt = Boolean(
    trimmedPrompt && (trimmedPrompt !== summary.trim() || genericSummary),
  );
  const displaySummary =
    genericSummary && trimmedPrompt
      ? trimmedPrompt.split("\n").find((line) => line.trim())?.trim().slice(0, 200) ?? summary
      : summary;

  return (
    <div className="run-log-mission">
      <div className="run-log-mission-head">
        {!omitRoleLabel ? (
          <span className="run-log-mission-role">
            {formatRoleModelLabel(subagent, modelByRole?.[subagent])}
          </span>
        ) : null}
        <span className="run-log-mission-tag">任务目标</span>
      </div>
      {displaySummary.trim() ? (
        <p className="run-log-mission-summary">
          <MarkdownContent text={displaySummary} />
        </p>
      ) : (
        <p className="run-log-mission-summary run-log-mission-summary-muted">等待任务说明…</p>
      )}
      {showPrompt ? (
        <details className="run-log-mission-details" open={genericSummary}>
          <summary>查看完整任务说明</summary>
          <pre className="run-log-mission-prompt">{trimmedPrompt}</pre>
        </details>
      ) : null}
    </div>
  );
}

function ToolFailedBlock({
  tool,
  error,
  subagent,
  modelByRole,
  omitRoleLabel,
}: {
  tool: string;
  error?: string;
  subagent?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
}) {
  return (
    <div className="run-log-tool-failed" role="alert">
      {subagent && !omitRoleLabel ? (
        <span className="run-log-tool-failed-role">
          {formatRoleModelLabel(subagent, modelByRole?.[subagent])}
        </span>
      ) : null}
      <span className="run-log-tool-failed-label">
        工具失败 · {tool}
      </span>
      {error ? <p className="run-log-tool-failed-error">{error}</p> : null}
    </div>
  );
}

function ApiErrorBlock({
  message,
  statusCode,
  subagent,
  modelByRole,
  omitRoleLabel,
}: {
  message: string;
  statusCode?: number;
  subagent?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
}) {
  const title =
    statusCode !== undefined
      ? `模型请求失败 · HTTP ${statusCode}`
      : "模型请求失败";

  return (
    <div className="run-log-api-error" role="alert">
      {subagent && !omitRoleLabel ? (
        <span className="run-log-api-error-role">
          {formatRoleModelLabel(subagent, modelByRole?.[subagent])}
        </span>
      ) : null}
      <span className="run-log-api-error-label">{title}</span>
      <p className="run-log-api-error-message">{message}</p>
    </div>
  );
}

function RunLogAction({
  icon,
  label,
  subagent,
  modelByRole,
  omitRoleLabel,
}: {
  icon: ActivityActionIcon;
  label: string;
  subagent?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
}) {
  const Icon = actionIcons[icon];
  return (
    <div className="run-log-action">
      {subagent && !omitRoleLabel ? (
        <span className="run-log-action-role">{formatRoleModelLabel(subagent, modelByRole?.[subagent])}</span>
      ) : null}
      <Icon size={16} className="run-log-action-icon" aria-hidden />
      <span className="run-log-action-label">{label}</span>
    </div>
  );
}

const actionIcons = {
  search: Search,
  file: FileSearch,
  edit: Pencil,
  terminal: Terminal,
  agent: Bot,
} as const;

function RunLogNarrative({
  text,
  streaming,
  subagent,
  compact,
  modelByRole,
  usageByRole,
  omitSubagentBadge,
}: {
  text: string;
  streaming?: boolean;
  subagent?: string;
  compact?: boolean;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  omitSubagentBadge?: boolean;
}) {
  const usage = subagent ? usageByRole?.[subagent] : undefined;
  const hasBody = text.trim().length > 0;
  const timing = useStreamRequestTiming(Boolean(streaming) && !hasBody, hasBody);
  const showSubagentBadge = subagent && !omitSubagentBadge;
  const showBody = hasBody || !streaming;
  const clarificationRows = !streaming ? parseClarificationAnswersSummary(text) : null;
  const worktreeMergeSummary = !streaming ? parseWorktreeMergeMessage(text) : null;

  if (clarificationRows) {
    return <ClarificationAnswersCard rows={clarificationRows} />;
  }
  if (worktreeMergeSummary) {
    return <WorkspaceChangesCard summary={worktreeMergeSummary} />;
  }

  return (
    <div className={compact ? "run-log-narrative compact" : "run-log-narrative"}>
      {showSubagentBadge ? (
        <span className="run-log-subagent-badge">
          {formatRoleModelLabel(subagent, modelByRole?.[subagent])}
          {streaming ? <RequestTimingBadge timing={timing} /> : null}
          {usage ? (
            <span className="run-log-usage-badge">
              {formatUsageBadge({
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                cacheReadTokens: usage.cacheReadTokens,
                cacheCreationTokens: usage.cacheCreationTokens,
              })}
            </span>
          ) : null}
        </span>
      ) : streaming ? (
        <RequestTimingBadge timing={timing} />
      ) : null}
      {showBody ? (
        <div className="run-log-narrative-body">
          <MarkdownContent text={text} />
          {streaming && hasBody ? <span className="run-log-cursor" aria-hidden /> : null}
        </div>
      ) : null}
    </div>
  );
}
