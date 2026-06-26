import {
  Bot,
  ChevronDown,
  FileText,
  FileSearch,
  Pencil,
  RefreshCw,
  Reply,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ThreadBillingSnapshot,
  ThreadActivityRewindTarget,
  ThreadContextSnapshot,
  ThreadRunProjectionAgent,
  ThreadRunProjectionRequestSpan,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
  ThreadSubagentSessionTiming,
  ThreadSubagentMetricsSummary,
  ThreadSummary,
  ThreadUsageSnapshot,
} from "../shared/ipc";
import { formatRoleModelLabel, formatUsageBadge, isSubagentMissionEnvelope, resolveMissionDisplayText, shortenModelId } from "@eco/runtime";
import {
  activityLabelIncludesAgentRole,
  isRedundantAgentModelShort,
  type ToolActionLifecycle,
} from "../shared/activity-display";
import { formatDurationMs } from "./AppMessage";
import { resolveRequestSpanDurationMs } from "../shared/request-span-timing";
import {
  formatDuration,
  resolveSubagentRunDisplayTitle,
  thinkingPreviewLine,
  type ActivityActionIcon,
  type ActivityDetailBlock,
} from "./activity-log";
import {
  buildThreadRunProjectionViewModel,
  isProjectionRequestActive,
  isProjectionUserPromptItem,
  projectionItemToDetailBlock,
  readProjectionAgentDelegation,
  resolveProjectionAgentStatusText,
  type ThreadRunProjectionMainFeedEntry,
} from "./thread-run-projection-view";
import { isAgentDisplayRole, normalizeAgentDisplayRole, SUBAGENT_ROLE_SHORT } from "../shared/subagent-roles";
import { parseWorktreeMergeMessage } from "../shared/worktree-merge";
import { StreamingMarkdownContent } from "./StreamingMarkdownContent";
import { ActivityFeedLayoutContext, useActivityFeedLayoutChange } from "./activity-feed-layout-context";
import { WorkspaceChangesCard } from "./WorkspaceChangesCard";
import {
  shouldScheduleThinkingAutoCollapse,
  THINKING_AUTO_COLLAPSE_READ_MS,
  THINKING_COLLAPSE_MS,
} from "./thinking-auto-collapse";
import {
  useStreamRequestTiming,
  type StreamRequestTimingAnchor,
} from "./useStreamRequestTiming";
import { type RuntimeAgentDisplayNames, resolveRuntimeAgentName } from "./runtime-agent-display";
import { type RuntimeAgentThemes, resolveSubagentRowThemeStyle } from "./runtime-agent-theme";

type RestorePromptHandler = (prompt: string, rewindTarget?: ThreadActivityRewindTarget) => void;

function toStreamRequestTimingAnchor(
  requestSpan?: ThreadRunProjectionRequestSpan,
): StreamRequestTimingAnchor | undefined {
  if (!requestSpan?.startedAt) {
    return undefined;
  }
  return {
    startedAtIso: requestSpan.startedAt,
    ...(requestSpan.firstTokenAt && { firstTokenAtIso: requestSpan.firstTokenAt }),
  };
}

function readRewindTarget(value: unknown): ThreadActivityRewindTarget | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const target = value as Partial<ThreadActivityRewindTarget>;
  const activityLineId = typeof target.activityLineId === "string" ? target.activityLineId.trim() : "";
  const userMessageId = typeof target.userMessageId === "string" ? target.userMessageId.trim() : "";
  return activityLineId && userMessageId ? { activityLineId, userMessageId } : undefined;
}

function readProjectionRewindTarget(
  item: ThreadRunProjectionTimelineItem,
): ThreadActivityRewindTarget | undefined {
  return readRewindTarget(item.metadata?.rewindTarget);
}

function shouldOmitSubagentIdentity(block: ActivityDetailBlock, hideSubagentIdentity?: boolean): boolean {
  if (!hideSubagentIdentity) {
    return false;
  }
  if (block.kind === "model-request") {
    return isAgentDisplayRole(block.role);
  }
  if (block.kind === "phase" || block.kind === "thinking") {
    return false;
  }
  if ("subagent" in block && block.subagent) {
    return isAgentDisplayRole(block.subagent);
  }
  return false;
}

function usePlannerLayoutChangeEffect(
  layoutSignature: string,
  onPlannerLayoutChange?: () => void,
) {
  const onPlannerLayoutChangeRef = useRef(onPlannerLayoutChange);
  onPlannerLayoutChangeRef.current = onPlannerLayoutChange;

  useLayoutEffect(() => {
    onPlannerLayoutChangeRef.current?.();
  }, [layoutSignature]);
}

interface ActivityLogViewProps {
  thread?: ThreadSummary;
  onRestorePrompt?: RestorePromptHandler;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  context?: ThreadContextSnapshot;
  billing?: ThreadBillingSnapshot;
  projection?: ThreadRunProjectionSnapshot;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  agentThemes?: RuntimeAgentThemes;
  subagentTimings?: ThreadSubagentSessionTiming[];
  subagentMetrics?: ThreadSubagentMetricsSummary[];
  /** Called when planner / main-window log content changes — scroll the activity feed. */
  onPlannerLayoutChange?: () => void;
}

function ProjectionFeedLoading() {
  return (
    <div className="run-log run-log-empty" role="status" aria-label="加载中">
      <div className="run-log-projection-loading" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export function ActivityLogView(props: ActivityLogViewProps) {
  if (!props.projection?.sourceEventCount) {
    return <ProjectionFeedLoading />;
  }
  return (
    <ProjectionActivityLogView
      projection={props.projection}
      {...(props.thread && { thread: props.thread })}
      {...(props.agentDisplayNames && { agentDisplayNames: props.agentDisplayNames })}
      {...(props.agentThemes && { agentThemes: props.agentThemes })}
      {...(props.onRestorePrompt && { onRestorePrompt: props.onRestorePrompt })}
      {...(props.onPlannerLayoutChange && { onPlannerLayoutChange: props.onPlannerLayoutChange })}
    />
  );
}

function ProjectionActivityLogView({
  projection,
  thread,
  onRestorePrompt,
  onPlannerLayoutChange,
  agentDisplayNames,
  agentThemes,
}: {
  projection: ThreadRunProjectionSnapshot;
  thread?: ThreadSummary;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  agentThemes?: RuntimeAgentThemes;
  onRestorePrompt?: RestorePromptHandler;
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
        { agentDisplayNames },
      ),
    [agentDisplayNames, projection, thread?.id, thread?.prompt],
  );
  const [expandedAgentKeys, setExpandedAgentKeys] = useState<Record<string, boolean>>({});
  const showThreadPrompt = viewModel.showThreadPrompt;
  const layoutSignature = useMemo(
    () =>
      [
        showThreadPrompt ? `prompt:${thread?.id ?? ""}` : "",
        ...viewModel.mainFeedEntries.map((entry) => {
          if (entry.kind === "timeline" || entry.kind === "agent-echo") {
            return `${entry.key}:${entry.item.text.length}`;
          }
          const lastItem = entry.card.agent.timeline.at(-1);
          return [
            entry.key,
            entry.card.agent.timeline.length,
            lastItem?.id ?? "",
            lastItem?.text.length ?? 0,
          ].join(":");
        }),
      ]
        .filter(Boolean)
        .join("|"),
    [showThreadPrompt, thread?.id, viewModel.mainFeedEntries],
  );

  usePlannerLayoutChangeEffect(layoutSignature, onPlannerLayoutChange);

  return (
    <ActivityFeedLayoutContext.Provider value={onPlannerLayoutChange}>
    <div className="run-log">
      {showThreadPrompt && thread?.prompt ? (
        wrapRunLogFeedEntry(
          <UserPromptBlock text={thread.prompt} {...(onRestorePrompt && { onRestorePrompt })} />,
        )
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
          {...(agentDisplayNames && { agentDisplayNames })}
          {...(agentThemes && { agentThemes })}
          {...(onRestorePrompt && { onRestorePrompt })}
        />
      ))}
    </div>
    </ActivityFeedLayoutContext.Provider>
  );
}

function isTightFeedDetailBlock(block: ActivityDetailBlock): boolean {
  if (block.kind === "action" && (block.bashRun || block.fileChange)) {
    return false;
  }
  return (
    block.kind === "action" ||
    block.kind === "model-request" ||
    block.kind === "agent-request" ||
    block.kind === "thinking" ||
    block.kind === "tool-failed" ||
    block.kind === "subagent-mission"
  );
}

function wrapRunLogFeedEntry(
  node: ReactNode,
  options?: { compact?: boolean; tight?: boolean },
): ReactNode {
  if (options?.compact) {
    return node;
  }
  const className = options?.tight
    ? "run-log-feed-entry run-log-feed-entry--tight"
    : "run-log-feed-entry";
  return <div className={className}>{node}</div>;
}

function ProjectionMainFeedEntry({
  entry,
  requestSpansById,
  expandedAgentKeys,
  onToggleAgent,
  onRestorePrompt,
  agentDisplayNames,
  agentThemes,
}: {
  entry: ThreadRunProjectionMainFeedEntry;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
  expandedAgentKeys: Record<string, boolean>;
  onToggleAgent: (agentId: string) => void;
  onRestorePrompt?: RestorePromptHandler;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  agentThemes?: RuntimeAgentThemes;
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
    return wrapRunLogFeedEntry(
      <ProjectionSubagentRunRow
        agent={entry.card.agent}
        missionText={entry.card.missionText}
        requestSpansById={requestSpansById}
        expanded={Boolean(expandedAgentKeys[entry.card.key])}
        onToggle={() => onToggleAgent(entry.card.key)}
        {...(agentDisplayNames && { agentDisplayNames })}
        {...(agentThemes && { agentThemes })}
      />,
    );
  }
  return wrapRunLogFeedEntry(
    <ProjectionAgentEchoEntry entry={entry} requestSpansById={requestSpansById} />,
    { tight: isTightAgentEchoEntry(entry) },
  );
}

function isTightAgentEchoEntry(
  entry: Extract<ThreadRunProjectionMainFeedEntry, { kind: "agent-echo" }>,
): boolean {
  const block = projectionItemToDetailBlock(entry.item);
  return block ? isTightFeedDetailBlock(block) : false;
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
      <ProjectionAgentEchoShell
        label={entry.agentLabel}
        agentId={entry.agent.agentId}
        shortAgentId={entry.shortAgentId}
      >
        <RunLogNarrative
          text={block.text}
          {...(block.streaming !== undefined && { streaming: block.streaming })}
          omitSubagentBadge
          {...(requestSpan && { requestSpan })}
        />
      </ProjectionAgentEchoShell>
    );
  }
  if (block.kind === "thinking") {
    return (
      <ProjectionAgentEchoShell
        label={entry.agentLabel}
        agentId={entry.agent.agentId}
        shortAgentId={entry.shortAgentId}
      >
        <ThinkingBlock
          text={block.text}
          {...(block.streaming !== undefined && { streaming: block.streaming })}
          {...(requestSpan && { requestSpan })}
        />
      </ProjectionAgentEchoShell>
    );
  }
  return (
    <ProjectionAgentEchoShell
      label={entry.agentLabel}
      agentId={entry.agent.agentId}
      shortAgentId={entry.shortAgentId}
    >
      <DetailBlock
        block={block}
        requestActive={requestActive}
        hideSubagentIdentity
        {...(requestSpan && { requestSpan })}
      />
    </ProjectionAgentEchoShell>
  );
}

function ProjectionAgentEchoShell({
  label,
  agentId,
  shortAgentId,
  children,
}: {
  label: string;
  agentId: string;
  shortAgentId?: string | undefined;
  children: ReactNode;
}) {
  const chipLabel = shortAgentId ? `#${shortAgentId}` : label;
  return (
    <div className="run-log-agent-echo" data-agent-id={agentId}>
      <span className="run-log-subagent-badge run-log-agent-echo-badge" title={label}>
        {chipLabel}
      </span>
      {children}
    </div>
  );
}

function useLatchedAgentText(agentId: string, text: string): string {
  const latchRef = useRef<{ agentId: string; text: string }>({ agentId: "", text: "" });
  if (latchRef.current.agentId !== agentId) {
    latchRef.current = { agentId, text: "" };
  }
  if (text) {
    latchRef.current.text = text;
  }
  return text || latchRef.current.text;
}

function ProjectionSubagentRunRow({
  agent,
  missionText: incomingMissionText,
  requestSpansById,
  expanded,
  onToggle,
  agentDisplayNames,
  agentThemes,
}: {
  agent: ThreadRunProjectionAgent;
  missionText: string;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
  expanded: boolean;
  onToggle: () => void;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  agentThemes?: RuntimeAgentThemes;
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

  const roleLabel =
    resolveRuntimeAgentName(agent.role, agentDisplayNames) ?? resolveSubagentRunDisplayTitle(agent.role);
  const modelId = agent.usage?.modelId ?? agent.context?.modelId;
  const modelShort = modelId?.trim() ? shortenModelId(modelId.trim()) : undefined;
  const showModelShort = modelShort && !isRedundantAgentModelShort(roleLabel, modelShort);
  const titleWithModel = formatRoleModelLabel(agent.role, modelId);
  const delegation = readProjectionAgentDelegation(agent);
  const rawStatus = resolveProjectionAgentStatusText(agent);
  const statusText =
    rawStatus && rawStatus !== titleWithModel && rawStatus !== roleLabel
      ? rawStatus
      : agent.status === "active" || agent.status === "launching"
        ? "工作中"
        : "点击查看执行详情";
  const elapsedMs = running ? liveDurationMs : agent.durationMs;
  const durationLabel =
    elapsedMs > 0 ? (running ? formatDuration(elapsedMs) : `用时 ${formatDuration(elapsedMs)}`) : undefined;
  const missionText = useLatchedAgentText(agent.agentId, incomingMissionText);
  const hasTimelineDetails = agent.timeline.some(
    (item) => !shouldSuppressSubagentCardTimelineItem(item, Boolean(missionText), Boolean(delegation)),
  );
  const hasDetails =
    hasTimelineDetails || Boolean(agent.usage || agent.context);
  const statusBadge = resolveSubagentStatusBadge(running, agent.status);

  return (
    <div
      className={`subagent-run-row-wrap has-agent-id${running ? " is-running" : ""}${expanded ? " is-expanded" : ""}`}
      data-agent-id={agent.agentId}
      data-role={normalizeAgentDisplayRole(agent.role) ?? agent.role}
      style={resolveSubagentRowThemeStyle(agent.role, agentThemes)}
    >
      <SubagentRunCardButton
        role={agent.role}
        roleLabel={roleLabel}
        agentId={agent.agentId}
        showModelShort={Boolean(showModelShort)}
        {...(modelShort && { modelShort })}
        running={running}
        statusBadge={statusBadge}
        statusText={statusText}
        {...(missionText && { missionText })}
        {...(durationLabel && { durationLabel })}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && hasDetails ? (
        <div className="work-session-details-compact">
          <div className="work-session-details-compact-inner">
            <ProjectionSubagentRunInstanceStrip agent={agent} />
            {agent.timeline
              .filter(
                (item) =>
                  !shouldSuppressSubagentCardTimelineItem(item, Boolean(missionText), Boolean(delegation)),
              )
              .map((item) => (
                <ProjectionTimelineEntry
                  key={`${agent.agentId}-${item.id}`}
                  item={item}
                  requestSpansById={requestSpansById}
                  compact
                />
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProjectionSubagentRunInstanceStrip({ agent }: { agent: ThreadRunProjectionAgent }) {
  const contextLabel =
    agent.context && agent.context.limit > 0 ? `上下文 ${agent.context.occupancyPct}%` : undefined;
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
  onRestorePrompt?: RestorePromptHandler;
  compact?: boolean;
}) {
  if (isProjectionUserPromptItem(item)) {
    if (compact) {
      return null;
    }
    const rewindTarget = readProjectionRewindTarget(item);
    return wrapRunLogFeedEntry(
      <UserPromptBlock
        text={item.text}
        {...(rewindTarget && { rewindTarget })}
        {...(onRestorePrompt && { onRestorePrompt })}
      />,
    );
  }

  const block = projectionItemToDetailBlock(item);
  if (!block) {
    return null;
  }

  const requestSpan = item.requestId ? requestSpansById.get(item.requestId) : undefined;
  const requestActive = isProjectionRequestActive(requestSpan);

  if (block.kind === "narrative") {
    return wrapRunLogFeedEntry(
      <RunLogNarrative
        text={block.text}
        {...(block.streaming !== undefined && { streaming: block.streaming })}
        {...(block.subagent && { subagent: block.subagent })}
        omitSubagentBadge={compact || isAgentDisplayRole(block.subagent)}
        compact={compact}
        {...(requestSpan && { requestSpan })}
      />,
      { compact },
    );
  }
  if (block.kind === "thinking") {
    return wrapRunLogFeedEntry(
      <ThinkingBlock
        text={block.text}
        {...(block.streaming !== undefined && { streaming: block.streaming })}
        {...(requestSpan && { requestSpan })}
      />,
      { compact, tight: true },
    );
  }
  if (block.kind === "phase") {
    return wrapRunLogFeedEntry(
      <PhaseBlock
        label={block.label}
        {...(block.reconnecting && { reconnecting: block.reconnecting })}
        {...(block.reconnectDetail && { reconnectDetail: block.reconnectDetail })}
      />,
      { compact },
    );
  }

  return wrapRunLogFeedEntry(
    <DetailBlock
      block={block}
      requestActive={requestActive}
      hideSubagentIdentity={compact}
      {...(requestSpan && { requestSpan })}
    />,
    { compact, tight: isTightFeedDetailBlock(block) },
  );
}


type SubagentStatusBadge = {
  label: string;
  tone: "running" | "done" | "abandoned";
};

function resolveSubagentStatusBadge(
  running: boolean,
  status?: ThreadRunProjectionAgent["status"],
): SubagentStatusBadge {
  if (running || status === "active" || status === "launching") {
    return { label: "运行中", tone: "running" };
  }
  if (status === "abandoned") {
    return { label: "已中止", tone: "abandoned" };
  }
  return { label: "已完成", tone: "done" };
}

function resolveSubagentKindBadge(role: string): string {
  const normalized = normalizeAgentDisplayRole(role) ?? role;
  return SUBAGENT_ROLE_SHORT[normalized] ?? "代理";
}

function shouldSuppressSubagentCardTimelineItem(
  item: ThreadRunProjectionTimelineItem,
  hasCardMission: boolean,
  hasDelegation: boolean,
): boolean {
  if (hasDelegation && item.eventType === "agent.started") {
    return true;
  }
  if (isSubagentMissionEnvelope(item.text)) {
    return true;
  }
  if (!hasCardMission) {
    return false;
  }
  const block = projectionItemToDetailBlock(item);
  return block?.kind === "subagent-mission";
}

function SubagentRunCardButton({
  role,
  roleLabel,
  agentId,
  showModelShort,
  modelShort,
  running,
  statusBadge,
  statusText,
  missionText,
  durationLabel,
  expanded,
  onToggle,
}: {
  role: string;
  roleLabel: string;
  agentId?: string;
  showModelShort?: boolean;
  modelShort?: string;
  running: boolean;
  statusBadge: SubagentStatusBadge;
  statusText: string;
  missionText?: string;
  durationLabel?: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const kindBadge = resolveSubagentKindBadge(role);
  const resolvedMissionText = missionText ? resolveMissionDisplayText(missionText) : "";

  return (
    <button
      type="button"
      className={`subagent-run-row${running ? " is-running" : ""}${expanded ? " is-expanded" : ""}`}
      onClick={onToggle}
      aria-expanded={expanded}
    >
      <span className="subagent-run-leading" aria-hidden>
        <span className="subagent-run-kind-badge">{kindBadge}</span>
        <Sparkles size={15} className="subagent-run-icon" />
      </span>
      <div className="subagent-run-main">
        <div className="subagent-run-title-row">
          <span className="subagent-run-title-group">
            <span className="subagent-run-title">
              <span className="subagent-run-title-role">{roleLabel}</span>
              {showModelShort && modelShort ? (
                <>
                  <span className="subagent-run-title-sep" aria-hidden>
                    ·
                  </span>
                  <span className="subagent-run-title-model">{modelShort}</span>
                </>
              ) : null}
            </span>
            {agentId ? (
              <span className="subagent-run-agent-chip" title={agentId}>
                #{shortSubagentAgentId(agentId)}
              </span>
            ) : null}
          </span>
          <span className="subagent-run-title-trailing">
            <span className={`subagent-run-status-badge tone-${statusBadge.tone}`}>
              {statusBadge.label}
            </span>
            {durationLabel ? <span className="subagent-run-duration">{durationLabel}</span> : null}
            {running ? <span className="subagent-run-loading" aria-hidden /> : null}
            <ChevronDown
              size={16}
              className={`subagent-run-chevron${expanded ? " open" : ""}`}
              aria-hidden
            />
          </span>
        </div>
        <p className="subagent-run-mission-tag">任务目标</p>
        {resolvedMissionText ? (
          <ExpandableMissionText
            text={resolvedMissionText}
            expanded={expanded}
            className="subagent-run-mission-preview"
          />
        ) : (
          <p className="subagent-run-mission-preview subagent-run-mission-placeholder" title={statusText}>
            {statusText || "等待任务说明…"}
          </p>
        )}
      </div>
    </button>
  );
}

function ExpandableMissionText({
  text,
  expanded,
  className,
}: {
  text: string;
  expanded: boolean;
  className?: string;
}) {
  return (
    <div className={`run-log-expandable-text-wrap${expanded ? " is-expanded" : ""}`}>
      <p className={["run-log-expandable-text", className].filter(Boolean).join(" ")} title={text}>
        {text}
      </p>
    </div>
  );
}

function shortSubagentAgentId(agentId: string): string {
  if (agentId.length <= 8) {
    return agentId;
  }
  return agentId.slice(-8);
}






function DetailBlock({
  block,
  modelByRole,
  usageByRole,
  hideSubagentIdentity,
  requestActive = false,
  requestSpan,
  agentThemes,
}: {
  block: ActivityDetailBlock;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  hideSubagentIdentity?: boolean;
  requestActive?: boolean;
  requestSpan?: ThreadRunProjectionRequestSpan;
  agentThemes?: RuntimeAgentThemes;
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
  if (block.kind === "prompt-cache-timeline") {
    return <PromptCacheTimelineBlock narrative={block.narrative} steps={block.steps} />;
  }
  if (block.kind === "subagent-mission") {
    return (
      <SubagentMissionBlock
        subagent={block.subagent}
        summary={block.summary}
        {...(block.prompt !== undefined && { prompt: block.prompt })}
        omitRoleLabel={omitSubagent}
        {...(!omitSubagent && modelByRole && { modelByRole })}
        {...(agentThemes && { agentThemes })}
      />
    );
  }
  if (block.kind === "model-request") {
    return (
      <WaitingThinkingBlock
        active={requestActive}
        {...(requestSpan && { requestSpan })}
      />
    );
  }
  if (block.kind === "agent-request") {
    return (
      <WaitingThinkingBlock
        active={requestActive}
        {...(requestSpan && { requestSpan })}
      />
    );
  }
  if (block.kind === "action") {
    return (
      <RunLogAction
        icon={block.icon}
        label={block.label}
        {...(block.bashRun && { bashRun: block.bashRun })}
        {...(block.fileChange && { fileChange: block.fileChange })}
        {...(block.lifecycle && { lifecycle: block.lifecycle })}
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
        {...(requestSpan && { requestSpan })}
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
      {...(requestSpan && { requestSpan })}
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
  if (isContextCompactionPhaseLabel(label)) {
    return <ContextCompactionDivider label={label} />;
  }
  if (isPromptCacheNoticePhaseLabel(label)) {
    return <PromptCacheNoticeDivider label={label} />;
  }
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

function isContextCompactionPhaseLabel(label: string): boolean {
  return (
    /^正在(?:自动|手动)压缩上下文$/u.test(label) ||
    /^上下文已(?:自动|手动)压缩$/u.test(label) ||
    /^上下文压缩失败/u.test(label)
  );
}

function isPromptCacheNoticePhaseLabel(label: string): boolean {
  return (
    /prompt cache 已失效/u.test(label) ||
    /Prompt cache 命中率从/u.test(label) ||
    /已变更，本会话 prompt cache 已失效/u.test(label) ||
    /已变更（Composer）/u.test(label) ||
    /输出已截断/u.test(label)
  );
}

function PromptCacheNoticeDivider({ label }: { label: string }) {
  return (
    <div className="run-log-prompt-cache-notice" role="status">
      <div className="run-log-prompt-cache-notice-line" aria-hidden />
      <div className="run-log-prompt-cache-notice-label">
        <Sparkles size={14} aria-hidden />
        <span>{label}</span>
      </div>
      <div className="run-log-prompt-cache-notice-line" aria-hidden />
    </div>
  );
}

function PromptCacheTimelineBlock({
  narrative,
  steps,
}: {
  narrative: string;
  steps: Array<{
    kind: "config_drift" | "invalidated" | "hit_dropped";
    at: string;
    label: string;
    episodeId?: string;
  }>;
}) {
  return (
    <div className="run-log-prompt-cache-timeline" role="status">
      <div className="run-log-prompt-cache-notice-line" aria-hidden />
      <div className="run-log-prompt-cache-timeline-body">
        <div className="run-log-prompt-cache-timeline-title">
          <Sparkles size={14} aria-hidden />
          <span>Prompt cache 时间线</span>
        </div>
        <p className="run-log-prompt-cache-timeline-narrative">{narrative}</p>
        {steps.length > 1 ? (
          <ol className="run-log-prompt-cache-timeline-steps">
            {steps.map((step, index) => (
              <li key={`${step.kind}-${step.at}-${index}`}>
                <time dateTime={step.at}>{formatPromptCacheTimelineTime(step.at)}</time>
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
      <div className="run-log-prompt-cache-notice-line" aria-hidden />
    </div>
  );
}

function formatPromptCacheTimelineTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ContextCompactionDivider({ label }: { label: string }) {
  const completed = /^上下文已/u.test(label);
  const failed = /^上下文压缩失败/u.test(label);
  const className = [
    "run-log-context-compaction",
    completed ? "run-log-context-compaction--completed" : "",
    failed ? "run-log-context-compaction--failed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className} role="status" aria-live="polite">
      <span className="run-log-context-compaction-line" aria-hidden />
      <span className="run-log-context-compaction-label">
        {completed ? <FileText size={16} strokeWidth={1.8} aria-hidden /> : null}
        <span>{label}</span>
      </span>
      <span className="run-log-context-compaction-line" aria-hidden />
    </div>
  );
}


function ShimmerText({ children }: { children: string }) {
  return (
    <span className="run-log-shimmer-text" aria-live="polite">
      {children}
    </span>
  );
}

function WaitingThinkingBlock({
  active,
  requestSpan,
}: {
  active?: boolean;
  requestSpan?: ThreadRunProjectionRequestSpan;
}) {
  const [showDuration, setShowDuration] = useState(false);
  const durationMs = resolveRequestDurationMs(requestSpan);

  if (!active) {
    if (!durationMs) {
      return null;
    }
    return (
      <div className="run-log-thinking is-collapsed">
        <button
          type="button"
          className="run-log-thinking-header"
          onClick={() => setShowDuration((value) => !value)}
          aria-expanded={showDuration}
        >
          <span className="run-log-thinking-label">
            思考
            {showDuration ? (
              <span className="run-log-thinking-timing-inline">
                {" "}
                · 耗时 {formatDurationMs(durationMs)}
              </span>
            ) : null}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="run-log-thinking streaming empty">
      <div className="run-log-thinking-header">
        <ShimmerText>正在思考</ShimmerText>
      </div>
    </div>
  );
}

function resolveRequestDurationMs(
  requestSpan?: ThreadRunProjectionRequestSpan,
): number | undefined {
  if (!requestSpan) {
    return undefined;
  }
  return resolveRequestSpanDurationMs(requestSpan);
}

function ThinkingBlock({
  text,
  streaming,
  requestSpan,
}: {
  text: string;
  streaming?: boolean;
  requestSpan?: ThreadRunProjectionRequestSpan;
}) {
  const onLayoutChange = useActivityFeedLayoutChange();
  const [collapsed, setCollapsed] = useState(false);
  const [showDuration, setShowDuration] = useState(false);
  const [isCollapsing, setIsCollapsing] = useState(false);
  const collapseDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapseAnimRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCollapseEligibleRef = useRef(false);
  const autoCollapseSuppressedRef = useRef(false);
  const hasBody = text.trim().length > 0;
  const autoCollapseReadKey = hasBody ? text : "";
  const latestRenderStateRef = useRef({ streaming: false, hasBody: false, readKey: "" });
  const expanded = Boolean(streaming && hasBody) || !collapsed;
  const preview = hasBody ? thinkingPreviewLine(text) : "";
  const showPreview = hasBody && collapsed && !streaming && !isCollapsing;
  const bodyOpen = expanded && !isCollapsing;
  const timing = useStreamRequestTiming(
    Boolean(streaming) && !hasBody,
    hasBody,
    toStreamRequestTimingAnchor(requestSpan),
  );
  const durationMs = timing.ttftMs ?? resolveRequestDurationMs(requestSpan);
  latestRenderStateRef.current = {
    streaming: Boolean(streaming),
    hasBody,
    readKey: autoCollapseReadKey,
  };

  const clearCollapseTimers = useCallback(() => {
    if (collapseDelayRef.current) {
      clearTimeout(collapseDelayRef.current);
      collapseDelayRef.current = null;
    }
    if (collapseAnimRef.current) {
      clearTimeout(collapseAnimRef.current);
      collapseAnimRef.current = null;
    }
  }, []);

  const startCollapseAnimation = useCallback(() => {
    if (latestRenderStateRef.current.streaming || !latestRenderStateRef.current.hasBody) {
      return;
    }
    clearCollapseTimers();
    setIsCollapsing(true);
    collapseAnimRef.current = setTimeout(() => {
      collapseAnimRef.current = null;
      setCollapsed(true);
      setIsCollapsing(false);
      onLayoutChange?.();
    }, THINKING_COLLAPSE_MS);
  }, [clearCollapseTimers, onLayoutChange]);

  useEffect(() => {
    if (streaming) {
      autoCollapseEligibleRef.current = true;
      autoCollapseSuppressedRef.current = false;
    }
  }, [streaming]);

  useEffect(() => {
    if (!streaming || !hasBody) {
      return;
    }
    clearCollapseTimers();
    setIsCollapsing(false);
    setCollapsed(false);
  }, [streaming, hasBody, clearCollapseTimers]);

  useEffect(() => {
    if (
      !shouldScheduleThinkingAutoCollapse({
        streaming,
        hasBody,
        collapsed,
        autoCollapseEligible: autoCollapseEligibleRef.current,
        autoCollapseSuppressed: autoCollapseSuppressedRef.current,
      })
    ) {
      return;
    }

    const scheduledReadKey = autoCollapseReadKey;
    collapseDelayRef.current = setTimeout(() => {
      collapseDelayRef.current = null;
      if (
        latestRenderStateRef.current.readKey !== scheduledReadKey ||
        !shouldScheduleThinkingAutoCollapse({
          streaming: latestRenderStateRef.current.streaming,
          hasBody: latestRenderStateRef.current.hasBody,
          collapsed,
          autoCollapseEligible: autoCollapseEligibleRef.current,
          autoCollapseSuppressed: autoCollapseSuppressedRef.current,
        })
      ) {
        return;
      }
      autoCollapseEligibleRef.current = false;
      startCollapseAnimation();
    }, THINKING_AUTO_COLLAPSE_READ_MS);

    return () => {
      if (collapseDelayRef.current) {
        clearTimeout(collapseDelayRef.current);
        collapseDelayRef.current = null;
      }
    };
  }, [streaming, hasBody, collapsed, autoCollapseReadKey, startCollapseAnimation]);

  useEffect(() => () => clearCollapseTimers(), [clearCollapseTimers]);

  const waitingEmpty = Boolean(streaming) && !hasBody;

  return (
    <div
      className={[
        "run-log-thinking",
        streaming ? "streaming" : "",
        waitingEmpty ? "empty" : "",
        streaming && hasBody ? "is-streaming-capped" : "",
        collapsed && !isCollapsing ? "is-collapsed" : "",
        isCollapsing ? "is-collapsing" : "",
        bodyOpen ? "is-expanded" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="run-log-thinking-header"
        onClick={() => {
          if (streaming || isCollapsing) {
            return;
          }
          if (waitingEmpty) {
            return;
          }
          autoCollapseEligibleRef.current = false;
          autoCollapseSuppressedRef.current = true;
          if (durationMs !== undefined) {
            setShowDuration((value) => !value);
          }
          if (!hasBody) {
            return;
          }
          if (expanded) {
            startCollapseAnimation();
            return;
          }
          clearCollapseTimers();
          setIsCollapsing(false);
          setCollapsed(false);
        }}
        aria-expanded={bodyOpen || Boolean(streaming) || showDuration}
        disabled={waitingEmpty}
      >
        <span className="run-log-thinking-label">
          {waitingEmpty ? <ShimmerText>正在思考</ShimmerText> : "思考"}
          {!waitingEmpty && showDuration && durationMs !== undefined ? (
            <span className="run-log-thinking-timing-inline">
              {" "}
              · 耗时 {formatDurationMs(durationMs)}
            </span>
          ) : null}
        </span>
        {hasBody && !streaming ? (
          <span
            className={["run-log-thinking-preview", showPreview ? "is-visible" : ""].filter(Boolean).join(" ")}
            title={preview}
            aria-hidden={!showPreview}
          >
            {preview}
          </span>
        ) : null}
      </button>
      {hasBody ? (
        <div
          className={["run-log-thinking-body-shell", bodyOpen ? "open" : ""].filter(Boolean).join(" ")}
        >
          <div className="run-log-thinking-body-inner">
            <div className="run-log-thinking-body">
              <StreamingMarkdownContent text={text} {...(streaming !== undefined && { streaming })} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UserPromptBlock({
  text,
  rewindTarget,
  onRestorePrompt,
}: {
  text: string;
  rewindTarget?: ThreadActivityRewindTarget;
  onRestorePrompt?: RestorePromptHandler;
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
          className={["run-log-user-prompt-body-wrap", !expanded ? "collapsed" : ""]
            .filter(Boolean)
            .join(" ")}
        >
          <pre
            ref={bodyRef}
            className={["run-log-user-prompt-body", !expanded ? "collapsed" : ""].filter(Boolean).join(" ")}
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
            onClick={() => {
              if (rewindTarget) {
                onRestorePrompt(text, rewindTarget);
              }
            }}
            disabled={!rewindTarget}
            aria-label="回到此节点"
            title={rewindTarget ? "回到此节点并重写" : "该节点缺少 SDK 检查点"}
          >
            <Reply size={14} />
          </button>
        </div>
      ) : null}
    </article>
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

function SubagentMissionBlock({
  subagent,
  summary,
  prompt,
  modelByRole,
  agentThemes,
  omitRoleLabel: _omitRoleLabel,
}: {
  subagent: string;
  summary: string;
  prompt?: string;
  modelByRole?: Record<string, string>;
  agentThemes?: RuntimeAgentThemes;
  omitRoleLabel?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const trimmedPrompt = prompt?.trim() ?? "";
  const trimmedSummary = summary.trim();
  const fullText = resolveMissionDisplayText(trimmedPrompt || trimmedSummary);

  return (
    <button
      type="button"
      className={`run-log-mission${expanded ? " is-expanded" : ""}`}
      data-role={normalizeAgentDisplayRole(subagent) ?? subagent}
      style={resolveSubagentRowThemeStyle(subagent, agentThemes)}
      onClick={() => setExpanded((value) => !value)}
      aria-expanded={expanded}
    >
      <div className="run-log-mission-head">
        <span className="run-log-mission-head-main">
          <span className="run-log-mission-tag">任务目标</span>
        </span>
        <ChevronDown
          size={16}
          className={`run-log-mission-chevron${expanded ? " open" : ""}`}
          aria-hidden
        />
      </div>
      {fullText ? (
        <ExpandableMissionText text={fullText} expanded={expanded} className="run-log-mission-preview" />
      ) : (
        <p className="run-log-mission-summary run-log-mission-summary-muted">等待任务说明…</p>
      )}
    </button>
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
      <span className="run-log-tool-failed-label">工具失败 · {tool}</span>
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
  const title = statusCode !== undefined ? `模型请求失败 · HTTP ${statusCode}` : "模型请求失败";

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
  lifecycle,
  bashRun,
  fileChange,
  subagent,
  modelByRole,
  omitRoleLabel,
}: {
  icon: ActivityActionIcon;
  label: string;
  lifecycle?: ToolActionLifecycle;
  bashRun?: import("../shared/activity-display").BashRunCardDisplay;
  fileChange?: import("../shared/activity-display").FileChangeCardDisplay;
  subagent?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
}) {
  const Icon = actionIcons[icon];
  const isTerminal = icon === "terminal";
  const [expanded, setExpanded] = useState(false);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [canExpand, setCanExpand] = useState(false);
  const StatusIcon =
    lifecycle && isApprovalLifecycle(lifecycle) ? approvalLifecycleStatusIcons[lifecycle] : undefined;
  const showRoleLabel =
    Boolean(subagent) &&
    !omitRoleLabel &&
    !activityLabelIncludesAgentRole(subagent!, label, { modelId: modelByRole?.[subagent!] });

  useLayoutEffect(() => {
    if (bashRun || !isTerminal || expanded) {
      return;
    }
    const measure = () => {
      const node = labelRef.current;
      const overflows =
        Boolean(label.includes("\n")) ||
        label.trim().length > 72 ||
        Boolean(node && node.scrollWidth > node.clientWidth + 1);
      setCanExpand(overflows);
    };
    measure();
    const node = labelRef.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [bashRun, expanded, isTerminal, label]);

  const triggerClassName = [
    "run-log-action-trigger",
    lifecycle === "running" ? "is-running" : "",
    lifecycle === "approval-pending" ? "is-pending" : "",
    canExpand ? "is-expandable" : "",
    expanded ? "is-expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const row = (
    <>
      <span className="run-log-action-icon-wrap" aria-hidden>
        <Icon size={14} className="run-log-action-icon" />
        {StatusIcon ? (
          <StatusIcon
            size={10}
            className="run-log-action-status-icon"
            aria-label={lifecycleStatusLabels[lifecycle!]}
          />
        ) : null}
      </span>
      <span ref={labelRef} className="run-log-action-label">
        {label}
      </span>
    </>
  );

  if (bashRun) {
    return (
      <div className="run-log-action--bash-card">
        {showRoleLabel ? (
          <span className="run-log-action-role run-log-action--bash-card-role">
            {formatRoleModelLabel(subagent!, modelByRole?.[subagent!])}
          </span>
        ) : null}
        <RunLogBashCard display={bashRun} {...(lifecycle && { lifecycle })} />
      </div>
    );
  }

  if (fileChange) {
    return (
      <div className="run-log-action run-log-action--file-change-card">
        {showRoleLabel ? (
          <span className="run-log-action-role">{formatRoleModelLabel(subagent!, modelByRole?.[subagent!])}</span>
        ) : null}
        <RunLogFileChangeCard display={fileChange} {...(lifecycle && { lifecycle })} />
      </div>
    );
  }

  return (
    <div className={["run-log-action", isTerminal ? "run-log-action--terminal" : ""].filter(Boolean).join(" ")}>
      {showRoleLabel ? (
        <span className="run-log-action-role">{formatRoleModelLabel(subagent!, modelByRole?.[subagent!])}</span>
      ) : null}
      <div className="run-log-action-main">
        {isTerminal && canExpand ? (
          <button
            type="button"
            className={triggerClassName}
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            title={expanded ? undefined : label}
          >
            {row}
          </button>
        ) : (
          <div className={triggerClassName}>{row}</div>
        )}
        {isTerminal && canExpand ? (
          <div className={["run-log-action-detail-shell", expanded ? "open" : ""].filter(Boolean).join(" ")}>
            <div className="run-log-action-detail-inner">
              <pre className="run-log-action-detail">{label}</pre>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RunLogFileChangeCard({
  display,
  lifecycle,
}: {
  display: import("../shared/activity-display").FileChangeCardDisplay;
  lifecycle?: ToolActionLifecycle;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsedLineLimit = 6;
  const previewLines = expanded ? display.previewLines : display.previewLines.slice(0, collapsedLineLimit);

  return (
    <button
      type="button"
      className={[
        "run-log-file-change-card",
        lifecycle === "running" ? "is-running" : "",
        lifecycle === "failed" ? "is-failed" : "",
        expanded ? "is-expanded" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => setExpanded((value) => !value)}
      aria-expanded={expanded}
    >
      <div className="run-log-file-change-card-header">
        <FileText size={16} className="run-log-file-change-card-icon" aria-hidden />
        <span className="run-log-file-change-card-title">{display.fileName}</span>
        <span className="run-log-file-change-card-stats">
          {display.additions > 0 ? <span className="stat-add">+{display.additions}</span> : null}
          {display.deletions > 0 ? <span className="stat-del">-{display.deletions}</span> : null}
        </span>
      </div>
      <div className="run-log-file-change-card-divider" aria-hidden />
      <div className="run-log-file-change-card-preview-shell">
        <div className="run-log-file-change-card-preview">
          {previewLines.map((line, index) => (
            <div
              key={`${line.kind}:${index}:${line.text.slice(0, 24)}`}
              className={[
                "run-log-file-change-line",
                line.kind === "add" ? "is-add" : "",
                line.kind === "remove" ? "is-remove" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <code>{line.text || " "}</code>
            </div>
          ))}
        </div>
      </div>
    </button>
  );
}

function RunLogBashCard({
  display,
  lifecycle,
}: {
  display: import("../shared/activity-display").BashRunCardDisplay;
  lifecycle?: ToolActionLifecycle;
}) {
  return (
    <div
      className={[
        "run-log-bash-card",
        lifecycle === "running" ? "is-running" : "",
        lifecycle === "failed" ? "is-failed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="run-log-bash-card-header">
        <Terminal size={16} className="run-log-bash-card-icon" aria-hidden />
        <span className="run-log-bash-card-title">{display.title}</span>
        {display.meta ? <span className="run-log-bash-card-meta">{display.meta}</span> : null}
      </div>
      {display.body ? (
        <>
          <div className="run-log-bash-card-divider" aria-hidden />
          <pre className="run-log-bash-card-output">{display.body}</pre>
        </>
      ) : null}
    </div>
  );
}

const approvalLifecycleStatusIcons = {
  "approval-pending": Shield,
  "approval-approved": ShieldCheck,
  "approval-rejected": ShieldAlert,
} as const;

type ApprovalLifecycle = keyof typeof approvalLifecycleStatusIcons;

function isApprovalLifecycle(lifecycle: ToolActionLifecycle): lifecycle is ApprovalLifecycle {
  return lifecycle in approvalLifecycleStatusIcons;
}

const lifecycleStatusLabels: Record<ToolActionLifecycle, string> = {
  "approval-pending": "等待确认",
  "approval-approved": "已允许",
  "approval-rejected": "已拒绝",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
};

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
  requestSpan,
}: {
  text: string;
  streaming?: boolean;
  subagent?: string;
  compact?: boolean;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  omitSubagentBadge?: boolean;
  requestSpan?: ThreadRunProjectionRequestSpan;
}) {
  const usage = subagent ? usageByRole?.[subagent] : undefined;
  const hasBody = text.trim().length > 0;
  const showSubagentBadge = subagent && !omitSubagentBadge;
  const showBody = hasBody || !streaming;
  const waitingEmpty = Boolean(streaming) && !hasBody;
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
      ) : waitingEmpty ? (
        <WaitingThinkingBlock active {...(requestSpan && { requestSpan })} />
      ) : null}
      {showBody ? (
        <div className="run-log-narrative-body">
          <StreamingMarkdownContent text={text} {...(streaming !== undefined && { streaming })} />
        </div>
      ) : null}
    </div>
  );
}
