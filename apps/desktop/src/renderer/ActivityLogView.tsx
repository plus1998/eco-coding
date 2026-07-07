import {
  formatRoleModelLabel,
  formatUsageBadge,
  isSubagentMissionEnvelope,
  resolveMissionDisplayText,
  shortenModelId,
} from "@eco/runtime";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  ChevronDown,
  Copy,
  FileSearch,
  FileText,
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
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  activityLabelIncludesAgentRole,
  isRedundantAgentModelShort,
  type ToolActionLifecycle,
} from "../shared/activity-display";
import type {
  ThreadActivityRewindTarget,
  ThreadBillingSnapshot,
  ThreadContextSnapshot,
  ThreadRunProjectionAgent,
  ThreadRunProjectionRequestSpan,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
  ThreadSubagentMetricsSummary,
  ThreadSubagentSessionTiming,
  ThreadSummary,
  ThreadUsageSnapshot,
} from "../shared/ipc";
import { resolveRequestSpanDurationMs } from "../shared/request-span-timing";
import { isAgentDisplayRole, normalizeAgentDisplayRole, SUBAGENT_ROLE_SHORT } from "../shared/subagent-roles";
import { formatGrepTargetInlineDetail } from "../shared/tool-target";
import { parseWorktreeMergeMessage } from "../shared/worktree-merge";
import { formatDurationMs } from "./AppMessage";
import {
  type ActivityFeedLayoutChange,
  ActivityFeedLayoutContext,
  useActivityFeedLayoutChange,
} from "./activity-feed-layout-context";
import {
  type ActivityActionIcon,
  type ActivityDetailBlock,
  formatDuration,
  resolveSubagentRunDisplayTitle,
  thinkingPreviewLine,
} from "./activity-log";
import { MarkdownContent } from "./MarkdownContent";
import { type RuntimeAgentDisplayNames, resolveRuntimeAgentName } from "./runtime-agent-display";
import { type RuntimeAgentThemes, resolveSubagentRowThemeStyle } from "./runtime-agent-theme";
import { StreamingMarkdownContent } from "./StreamingMarkdownContent";
import { StreamingTypingIndicator } from "./StreamingTypingIndicator";
import {
  shouldScheduleThinkingAutoCollapse,
  THINKING_AUTO_COLLAPSE_READ_MS,
  THINKING_COLLAPSE_MS,
} from "./thinking-auto-collapse";
import {
  buildThreadRunProjectionViewModel,
  isProjectionRequestActive,
  isProjectionUserPromptItem,
  projectionItemToDetailBlock,
  readProjectionAgentDelegation,
  resolveProjectionAgentStatusText,
  type ThreadRunProjectionAgentEchoFeedEntry,
  type ThreadRunProjectionMainFeedEntry,
  type ThreadRunProjectionToolGroupFeedEntry,
  type ThreadRunProjectionTimelineFeedEntry,
} from "./thread-run-projection-view";
import { type StreamRequestTimingAnchor, useStreamRequestTiming } from "./useStreamRequestTiming";
import { WorkspaceChangesCard } from "./WorkspaceChangesCard";

type RestorePromptHandler = (prompt: string, rewindTarget?: ThreadActivityRewindTarget) => void;
type OpenSubagentHandler = (agentId: string) => void;

const SUBAGENT_DETAIL_STICK_THRESHOLD_PX = 96;
const SUBAGENT_DETAIL_USER_SCROLL_DELTA_PX = 2;

function distanceFromBottom(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight);
}

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

function formatRunLogMessageTime(value?: string): { label: string; title: string; dateTime: string } | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return {
    label: date.toLocaleString(undefined, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    title: date.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    dateTime: value,
  };
}

function copyRunLogMessageText(text: string): void {
  if (!navigator.clipboard) {
    return;
  }
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

function RunLogMessageMeta({
  createdAt,
  copyText,
  restorePrompt,
  align = "start",
  sticky = false,
}: {
  createdAt?: string;
  copyText?: string;
  restorePrompt?: {
    text: string;
    rewindTarget: ThreadActivityRewindTarget;
    onRestorePrompt: RestorePromptHandler;
  };
  align?: "start" | "end";
  sticky?: boolean;
}) {
  const time = formatRunLogMessageTime(createdAt);
  const canCopy = Boolean(copyText?.trim());
  if (!time && !canCopy && !restorePrompt) {
    return null;
  }

  return (
    <div
      className={[
        "run-log-message-meta",
        align === "end" ? "run-log-message-meta--end" : "run-log-message-meta--start",
        sticky ? "run-log-message-meta--sticky" : "",
      ].filter(Boolean).join(" ")}
    >
      {restorePrompt ? (
        <button
          type="button"
          className="run-log-message-meta-button"
          onClick={() => restorePrompt.onRestorePrompt(restorePrompt.text, restorePrompt.rewindTarget)}
          aria-label="回到此节点"
          title="回到此节点并重写"
        >
          <Reply size={13} />
        </button>
      ) : null}
      {canCopy ? (
        <button
          type="button"
          className="run-log-message-meta-button"
          onClick={() => copyRunLogMessageText(copyText ?? "")}
          aria-label="复制消息"
          title="复制消息"
        >
          <Copy size={13} />
        </button>
      ) : null}
      {time ? (
        <time className="run-log-message-meta-time" dateTime={time.dateTime} title={time.title}>
          {time.label}
        </time>
      ) : null}
    </div>
  );
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
  onPlannerLayoutChange?: ActivityFeedLayoutChange,
) {
  const onPlannerLayoutChangeRef = useRef(onPlannerLayoutChange);
  onPlannerLayoutChangeRef.current = onPlannerLayoutChange;

  useLayoutEffect(() => {
    onPlannerLayoutChangeRef.current?.();
  }, [layoutSignature]);
}

function isThreadStoppedForFinalSummary(status: string): boolean {
  return status === "completed" || status === "failed" || status === "blocked" || status === "cancelled" || status === "idle";
}

function resolveTurnFinalSummaryItemIds(
  entries: readonly ThreadRunProjectionMainFeedEntry[],
  threadStatus: string,
): ReadonlySet<string> {
  const ids = new Set<string>();
  let latestSummaryId: string | undefined;

  const commitTurn = () => {
    if (latestSummaryId) {
      ids.add(latestSummaryId);
      latestSummaryId = undefined;
    }
  };

  for (const entry of entries) {
    if (entry.kind !== "timeline") {
      continue;
    }
    if (isProjectionUserPromptItem(entry.item)) {
      commitTurn();
      continue;
    }
    if (entry.item.eventType !== "message.final") {
      continue;
    }
    const block = projectionItemToDetailBlock(entry.item);
    if (block?.kind === "narrative" && !block.streaming && block.text.trim()) {
      latestSummaryId = entry.item.id;
    }
  }

  if (isThreadStoppedForFinalSummary(threadStatus)) {
    commitTurn();
  }
  return ids;
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
  selectedSubagentAgentId?: string;
  onOpenSubagent?: OpenSubagentHandler;
  /** Called when planner / main-window log content changes — scroll the activity feed. */
  onPlannerLayoutChange?: ActivityFeedLayoutChange;
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

export const ActivityLogView = memo(function ActivityLogView(props: ActivityLogViewProps) {
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
      {...(props.selectedSubagentAgentId && { selectedSubagentAgentId: props.selectedSubagentAgentId })}
      {...(props.onOpenSubagent && { onOpenSubagent: props.onOpenSubagent })}
      {...(props.onPlannerLayoutChange && { onPlannerLayoutChange: props.onPlannerLayoutChange })}
    />
  );
});

function ProjectionActivityLogView({
  projection,
  thread,
  onRestorePrompt,
  onPlannerLayoutChange,
  agentDisplayNames,
  agentThemes,
  selectedSubagentAgentId,
  onOpenSubagent,
}: {
  projection: ThreadRunProjectionSnapshot;
  thread?: ThreadSummary;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  agentThemes?: RuntimeAgentThemes;
  selectedSubagentAgentId?: string;
  onOpenSubagent?: OpenSubagentHandler;
  onRestorePrompt?: RestorePromptHandler;
  onPlannerLayoutChange?: ActivityFeedLayoutChange;
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
  const showThreadPrompt = viewModel.showThreadPrompt;
  const finalSummaryItemIds = useMemo(
    () => resolveTurnFinalSummaryItemIds(viewModel.mainFeedEntries, projection.thread.status),
    [projection.thread.status, viewModel.mainFeedEntries],
  );
  const stickyFinalSummaryItemId = useMemo(() => {
    let itemId: string | undefined;
    for (const entry of viewModel.mainFeedEntries) {
      if (entry.kind === "timeline" && finalSummaryItemIds.has(entry.item.id)) {
        itemId = entry.item.id;
      }
    }
    return itemId;
  }, [finalSummaryItemIds, viewModel.mainFeedEntries]);
  const layoutSignature = useMemo(
    () =>
      [
        showThreadPrompt ? `prompt:${thread?.id ?? ""}` : "",
        ...viewModel.mainFeedEntries.map((entry) => {
          if (entry.kind === "timeline" || entry.kind === "agent-echo") {
            return `${entry.key}:${entry.item.text.length}`;
          }
          if (entry.kind === "tool-group") {
            return `${entry.key}:${entry.entries
              .map((child) => `${child.key}:${child.item.text.length}`)
              .join(",")}`;
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
        {showThreadPrompt && thread?.prompt
          ? wrapRunLogFeedEntry(
              <UserPromptBlock
                text={thread.prompt}
                anchorId={`thread:${thread.id}`}
                createdAt={thread.createdAt}
                {...(onRestorePrompt && { onRestorePrompt })}
              />,
            )
          : null}
        {viewModel.mainFeedEntries.map((entry) => (
          <ProjectionMainFeedEntry
            key={entry.key}
            entry={entry}
            requestSpansById={requestSpansById}
            finalSummaryItemIds={finalSummaryItemIds}
            {...(stickyFinalSummaryItemId && { stickyFinalSummaryItemId })}
            {...(selectedSubagentAgentId && { selectedSubagentAgentId })}
            {...(onOpenSubagent && { onOpenSubagent })}
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

function wrapRunLogFeedEntry(node: ReactNode, options?: { compact?: boolean; tight?: boolean }): ReactNode {
  if (options?.compact) {
    return node;
  }
  const className = options?.tight ? "run-log-feed-entry run-log-feed-entry--tight" : "run-log-feed-entry";
  return <div className={className}>{node}</div>;
}

function ProjectionMainFeedEntry({
  entry,
  requestSpansById,
  finalSummaryItemIds,
  stickyFinalSummaryItemId,
  selectedSubagentAgentId,
  onOpenSubagent,
  onRestorePrompt,
  agentDisplayNames,
  agentThemes,
}: {
  entry: ThreadRunProjectionMainFeedEntry;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
  finalSummaryItemIds: ReadonlySet<string>;
  stickyFinalSummaryItemId?: string;
  selectedSubagentAgentId?: string;
  onOpenSubagent?: OpenSubagentHandler;
  onRestorePrompt?: RestorePromptHandler;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  agentThemes?: RuntimeAgentThemes;
}) {
  if (entry.kind === "timeline") {
    const showMessageMeta = finalSummaryItemIds.has(entry.item.id);
    return (
      <ProjectionTimelineEntry
        item={entry.item}
        requestSpansById={requestSpansById}
        showMessageMeta={showMessageMeta}
        stickyMessageMeta={showMessageMeta && entry.item.id === stickyFinalSummaryItemId}
        {...(onRestorePrompt && { onRestorePrompt })}
      />
    );
  }
  if (entry.kind === "tool-group") {
    return wrapRunLogFeedEntry(
      <ProjectionToolGroupEntry
        entry={entry}
        requestSpansById={requestSpansById}
      />,
      { tight: true },
    );
  }
  if (entry.kind === "agent-card") {
    return wrapRunLogFeedEntry(
      <ProjectionSubagentRunRow
        agent={entry.card.agent}
        missionText={entry.card.missionText}
        selected={selectedSubagentAgentId === entry.card.key}
        onOpen={() => onOpenSubagent?.(entry.card.key)}
        {...(agentDisplayNames && { agentDisplayNames })}
        {...(agentThemes && { agentThemes })}
      />,
    );
  }
  return wrapRunLogFeedEntry(
    <ProjectionAgentEchoEntry
      entry={entry}
      requestSpansById={requestSpansById}
    />,
    {
      tight: isTightAgentEchoEntry(entry),
    },
  );
}

function isTightAgentEchoEntry(
  entry: Extract<ThreadRunProjectionMainFeedEntry, { kind: "agent-echo" }>,
): boolean {
  const block = projectionItemToDetailBlock(entry.item);
  return block ? isTightFeedDetailBlock(block) : false;
}

function ProjectionToolGroupEntry({
  entry,
  requestSpansById,
}: {
  entry: Extract<ThreadRunProjectionMainFeedEntry, { kind: "tool-group" }>;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
}) {
  const [expanded, setExpanded] = useState(false);
  const blocks = useMemo(
    () =>
      entry.entries
        .map((child) => projectionItemToDetailBlock(child.item))
        .filter(
          (block): block is Extract<ActivityDetailBlock, { kind: "action" }> => block?.kind === "action",
        ),
    [entry.entries],
  );
  const summary = useMemo(() => summarizeActionBlocks(blocks), [blocks]);
  const lifecycle = useMemo(() => resolveActionBlocksLifecycle(blocks), [blocks]);
  const showInlineLoading = useMemo(
    () =>
      lifecycle === "running" &&
      entry.entries.some((child) => {
        const block = projectionItemToDetailBlock(child.item);
        if (block?.kind !== "action" || block.lifecycle !== "running") {
          return false;
        }
        const requestSpan = child.item.requestId ? requestSpansById.get(child.item.requestId) : undefined;
        return shouldShowActionInlineLoading({
          itemRequestId: child.item.requestId,
          requestSpan,
        });
      }),
    [entry.entries, lifecycle, requestSpansById],
  );
  const Icon = actionIcons[summary.icon];
  const approvalLifecycle = lifecycle && isApprovalLifecycle(lifecycle) ? lifecycle : undefined;
  const StatusIcon = approvalLifecycle ? approvalLifecycleStatusIcons[approvalLifecycle] : undefined;
  const statusLabel = approvalLifecycle ? lifecycleStatusLabels[approvalLifecycle] : undefined;

  return (
    <div className={["run-log-tool-group", expanded ? "is-expanded" : ""].filter(Boolean).join(" ")}>
      <button
        type="button"
        className={[
          "run-log-tool-group-trigger",
          lifecycle === "running" ? "is-running" : "",
          lifecycle === "approval-pending" ? "is-pending" : "",
          lifecycle === "failed" ? "is-failed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="run-log-action-icon-wrap" aria-hidden>
          <Icon size={14} className="run-log-action-icon" />
          {StatusIcon ? (
            <StatusIcon
              size={10}
              className="run-log-action-status-icon"
              {...(statusLabel && { "aria-label": statusLabel })}
            />
          ) : null}
        </span>
        <span className="run-log-tool-group-summary">{summary.label}</span>
        <ChevronDown
          size={15}
          className={`run-log-tool-group-chevron${expanded ? " open" : ""}`}
          aria-hidden
        />
        {showInlineLoading ? <RunLogInlineLoading label="正在执行工具" /> : null}
      </button>
      {expanded ? (
        <div className="run-log-tool-group-details">
          {entry.entries.map((child) => (
            <ProjectionToolGroupChildEntry
              key={child.key}
              entry={child}
              requestSpansById={requestSpansById}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProjectionToolGroupChildEntry({
  entry,
  requestSpansById,
}: {
  entry: ThreadRunProjectionTimelineFeedEntry | ThreadRunProjectionAgentEchoFeedEntry;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
}) {
  if (entry.kind === "timeline") {
    return (
      <ProjectionTimelineEntry
        item={entry.item}
        requestSpansById={requestSpansById}
        compact
        forceActionDetailsExpanded
      />
    );
  }
  return (
    <ProjectionAgentEchoEntry
      entry={entry}
      requestSpansById={requestSpansById}
      forceActionDetailsExpanded
    />
  );
}

function summarizeActionBlocks(blocks: readonly Extract<ActivityDetailBlock, { kind: "action" }>[]): {
  label: string;
  icon: ActivityActionIcon;
} {
  const editedFiles = new Set<string>();
  const readFiles = new Set<string>();
  const writtenFiles = new Set<string>();
  let searches = 0;
  let commands = 0;
  let agents = 0;
  let taskCreates = 0;
  let taskUpdates = 0;
  let otherTools = 0;

  for (const block of blocks) {
    if (block.toolName === "TaskCreate") {
      taskCreates += 1;
      continue;
    }
    if (block.toolName === "TaskUpdate" || block.toolName === "TodoWrite") {
      taskUpdates += 1;
      continue;
    }
    if (block.toolName === "Write") {
      writtenFiles.add(actionBlockTargetKey(block));
      continue;
    }
    if (block.toolName === "Edit" || block.toolName === "MultiEdit") {
      editedFiles.add(actionBlockTargetKey(block));
      continue;
    }
    if (block.toolName === "Read" || block.toolName === "NotebookRead") {
      readFiles.add(actionBlockTargetKey(block));
      continue;
    }
    if (block.fileChange) {
      editedFiles.add(block.fileChange.path || block.fileChange.fileName);
      continue;
    }
    if (block.icon === "edit") {
      editedFiles.add(block.label);
      continue;
    }
    if (block.readTarget) {
      readFiles.add(block.readTarget.filePath || block.readTarget.fileName);
      continue;
    }
    if (block.grepTarget || block.icon === "search") {
      searches += 1;
      continue;
    }
    if (block.bashRun || block.icon === "terminal") {
      commands += 1;
      continue;
    }
    if (block.toolName === "Agent" || block.toolName === "Task" || block.icon === "agent") {
      agents += 1;
      continue;
    }
    otherTools += 1;
  }

  const clauses: string[] = [];
  if (readFiles.size > 0) {
    clauses.push(`已读取 ${readFiles.size} 个文件`);
  }
  if (writtenFiles.size > 0) {
    clauses.push(`已写入 ${writtenFiles.size} 个文件`);
  }
  if (editedFiles.size > 0) {
    clauses.push(`已编辑 ${editedFiles.size} 个文件`);
  }
  if (searches > 0) {
    clauses.push("已搜索代码");
  }
  if (commands > 0) {
    clauses.push(`已运行 ${commands} 条命令`);
  }
  if (taskCreates > 0) {
    clauses.push(`已创建 ${taskCreates} 个任务`);
  }
  if (taskUpdates > 0) {
    clauses.push(`已更新任务 ${taskUpdates} 次`);
  }
  if (agents > 0) {
    clauses.push(`已调用 ${agents} 个子代理`);
  }
  if (otherTools > 0) {
    clauses.push(`已执行 ${otherTools} 个工具`);
  }

  const label = joinChineseClauses(clauses.length ? clauses : [`已执行 ${blocks.length} 个工具`]);
  const icon: ActivityActionIcon =
    writtenFiles.size > 0 || editedFiles.size > 0 || taskCreates > 0 || taskUpdates > 0
      ? "edit"
      : readFiles.size > 0
        ? "file"
        : searches > 0
          ? "search"
          : commands > 0
            ? "terminal"
            : agents > 0
              ? "agent"
              : "file";
  return { label, icon };
}

function actionBlockTargetKey(block: Extract<ActivityDetailBlock, { kind: "action" }>): string {
  const fallbackLabel = block.label.replace(/\s+\(\d+(?:\.\d+)?s\)\s*$/u, "").trim();
  return (
    block.fileChange?.path ||
    block.fileChange?.fileName ||
    block.readTarget?.filePath ||
    block.readTarget?.fileName ||
    block.grepTarget?.path ||
    fallbackLabel ||
    block.toolName ||
    block.label
  );
}

function joinChineseClauses(clauses: readonly string[]): string {
  if (clauses.length <= 1) {
    return clauses[0] ?? "";
  }
  if (clauses.length === 2) {
    return `${clauses[0]}和${clauses[1]}`;
  }
  return `${clauses.slice(0, -1).join("、")}和${clauses.at(-1)}`;
}

function resolveActionBlocksLifecycle(
  blocks: readonly Extract<ActivityDetailBlock, { kind: "action" }>[],
): ToolActionLifecycle | undefined {
  const lifecycles = blocks
    .map((block) => block.lifecycle)
    .filter((value): value is ToolActionLifecycle => Boolean(value));
  if (lifecycles.includes("failed")) {
    return "failed";
  }
  if (lifecycles.includes("running")) {
    return "running";
  }
  if (lifecycles.includes("approval-pending")) {
    return "approval-pending";
  }
  if (lifecycles.includes("approval-rejected")) {
    return "approval-rejected";
  }
  if (lifecycles.includes("approval-approved")) {
    return "approval-approved";
  }
  return lifecycles.length > 0 ? "completed" : undefined;
}

function shouldShowActionInlineLoading({
  itemRequestId,
  requestSpan,
}: {
  itemRequestId: string | undefined;
  requestSpan: ThreadRunProjectionRequestSpan | undefined;
}): boolean {
  void itemRequestId;
  return isProjectionRequestActive(requestSpan);
}

type SubagentDetailFeedEntry = ThreadRunProjectionTimelineFeedEntry | ThreadRunProjectionToolGroupFeedEntry;

function buildSubagentDetailFeedEntries(
  agentId: string,
  timeline: readonly ThreadRunProjectionTimelineItem[],
): SubagentDetailFeedEntry[] {
  const grouped: SubagentDetailFeedEntry[] = [];
  let pending: ThreadRunProjectionTimelineFeedEntry[] = [];

  const flush = () => {
    if (pending.length > 1) {
      const first = pending[0];
      if (first) {
        grouped.push({
          kind: "tool-group",
          key: `subagent-tool-group:${agentId}:${first.key}`,
          entries: pending,
          at: first.at,
          sequence: first.sequence,
        });
      }
    } else {
      grouped.push(...pending);
    }
    pending = [];
  };

  for (const item of timeline) {
    const entry: ThreadRunProjectionTimelineFeedEntry = {
      kind: "timeline",
      key: `subagent-timeline:${agentId}:${item.id}`,
      item,
      at: item.at,
      sequence: item.sequence,
    };
    const block = projectionItemToDetailBlock(item);
    if (block?.kind === "action") {
      pending.push(entry);
      continue;
    }
    flush();
    grouped.push(entry);
  }
  flush();
  return grouped;
}

function ProjectionAgentEchoEntry({
  entry,
  requestSpansById,
  forceActionDetailsExpanded = false,
}: {
  entry: Extract<ThreadRunProjectionMainFeedEntry, { kind: "agent-echo" }>;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
  forceActionDetailsExpanded?: boolean;
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
          createdAt={entry.item.at}
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
        actionInlineLoadingActive={shouldShowActionInlineLoading({
          itemRequestId: entry.item.requestId,
          requestSpan,
        })}
        hideSubagentIdentity
        forceActionDetailsExpanded={forceActionDetailsExpanded}
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
  selected,
  onOpen,
  agentDisplayNames,
  agentThemes,
}: {
  agent: ThreadRunProjectionAgent;
  missionText: string;
  selected: boolean;
  onOpen: () => void;
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
  const statusBadge = resolveSubagentStatusBadge(running, agent.status);

  return (
    <div
      className={`subagent-run-row-wrap has-agent-id${running ? " is-running" : ""}${selected ? " is-expanded" : ""}`}
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
        selected={selected}
        onOpen={onOpen}
      />
    </div>
  );
}

export function ProjectionSubagentDetailFeed({
  agent,
  missionText,
  requestSpansById,
  threadActive,
}: {
  agent: ThreadRunProjectionAgent;
  missionText: string;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
  threadActive: boolean;
}) {
  void threadActive;
  const feedRef = useRef<HTMLDivElement>(null);
  const userDetachedFromBottomRef = useRef(false);
  const scrollTopRef = useRef(0);
  const programmaticScrollRef = useRef(false);
  const delegation = readProjectionAgentDelegation(agent);
  const hasDelegation = Boolean(delegation);
  const missionDisplay = resolveMissionDisplayText(
    missionText || delegation?.prompt || delegation?.summary || "",
  );
  const running = agent.status === "active" || agent.status === "launching";
  const [liveDurationMs, setLiveDurationMs] = useState(agent.durationMs);
  const filteredTimeline = useMemo(
    () =>
      agent.timeline.filter(
        (item) => !shouldSuppressSubagentCardTimelineItem(item, Boolean(missionText), hasDelegation),
      ),
    [agent.timeline, hasDelegation, missionText],
  );
  const detailFeedEntries = useMemo(
    () => buildSubagentDetailFeedEntries(agent.agentId, filteredTimeline),
    [agent.agentId, filteredTimeline],
  );
  const latestTimelineItem = filteredTimeline.at(-1);
  const layoutSignature = [
    agent.agentId,
    agent.status,
    missionDisplay.length,
    detailFeedEntries.length,
    latestTimelineItem?.id ?? "",
    latestTimelineItem?.text.length ?? 0,
  ].join(":");
  const scrollToBottom = useCallback((force = false) => {
    const feed = feedRef.current;
    if (!feed) {
      return;
    }
    if (!force && userDetachedFromBottomRef.current) {
      return;
    }
    programmaticScrollRef.current = true;
    const maxScrollTop = Math.max(0, feed.scrollHeight - feed.clientHeight);
    feed.scrollTop = maxScrollTop;
    scrollTopRef.current = feed.scrollTop;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
        const current = feedRef.current;
        if (!current) {
          return;
        }
        scrollTopRef.current = current.scrollTop;
        if (distanceFromBottom(current) <= SUBAGENT_DETAIL_STICK_THRESHOLD_PX) {
          userDetachedFromBottomRef.current = false;
        }
      });
    });
  }, []);

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

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) {
      return;
    }
    scrollTopRef.current = feed.scrollTop;
    const onScroll = () => {
      if (programmaticScrollRef.current) {
        return;
      }
      const nextScrollTop = feed.scrollTop;
      const distance = distanceFromBottom(feed);
      if (nextScrollTop < scrollTopRef.current - SUBAGENT_DETAIL_USER_SCROLL_DELTA_PX) {
        userDetachedFromBottomRef.current = true;
      } else if (
        nextScrollTop > scrollTopRef.current + SUBAGENT_DETAIL_USER_SCROLL_DELTA_PX &&
        distance <= SUBAGENT_DETAIL_STICK_THRESHOLD_PX
      ) {
        userDetachedFromBottomRef.current = false;
      } else if (distance <= SUBAGENT_DETAIL_STICK_THRESHOLD_PX) {
        userDetachedFromBottomRef.current = false;
      }
      scrollTopRef.current = nextScrollTop;
    };
    feed.addEventListener("scroll", onScroll, { passive: true });
    return () => feed.removeEventListener("scroll", onScroll);
  }, [agent.agentId]);

  useLayoutEffect(() => {
    userDetachedFromBottomRef.current = false;
    scrollToBottom(true);
    const frame = requestAnimationFrame(() => scrollToBottom(true));
    return () => cancelAnimationFrame(frame);
  }, [agent.agentId, scrollToBottom]);

  useLayoutEffect(() => {
    scrollToBottom();
    const frame = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(frame);
  }, [layoutSignature, scrollToBottom]);

  useEffect(() => {
    const feed = feedRef.current;
    const content = feed?.querySelector(".subagent-conversation-log");
    if (!feed || !(content instanceof HTMLElement)) {
      return;
    }
    const observer = new ResizeObserver(() => {
      scrollToBottom();
      requestAnimationFrame(() => scrollToBottom());
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [agent.agentId, scrollToBottom]);

  const durationLabel = liveDurationMs > 0 ? formatDuration(liveDurationMs) : undefined;

  return (
    <div ref={feedRef} className="subagent-task-detail-feed subagent-conversation">
      {missionDisplay ? <UserPromptBlock text={missionDisplay} className="subagent-conversation-prompt" /> : null}
      <div className="subagent-conversation-status-row">
        <span className="subagent-conversation-status">
          {running ? "处理中" : "已处理"}
          {durationLabel ? ` ${durationLabel}` : ""}
        </span>
      </div>
      <ProjectionSubagentRunInstanceStrip agent={agent} />
      <div className="subagent-conversation-log">
        {detailFeedEntries.length > 0 ? (
          detailFeedEntries.map((entry) =>
            entry.kind === "tool-group" ? (
              <ProjectionToolGroupEntry
                key={entry.key}
                entry={entry}
                requestSpansById={requestSpansById}
              />
            ) : (
              <ProjectionTimelineEntry
                key={entry.key}
                item={entry.item}
                requestSpansById={requestSpansById}
                compact
              />
            ),
          )
        ) : (
          <p className="subagent-task-detail-empty">暂无可展示的执行明细</p>
        )}
      </div>
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
    <div className="subagent-run-instance-strip">
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
  forceActionDetailsExpanded = false,
  showMessageMeta = false,
  stickyMessageMeta = false,
}: {
  item: ThreadRunProjectionTimelineItem;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
  onRestorePrompt?: RestorePromptHandler;
  compact?: boolean;
  forceActionDetailsExpanded?: boolean;
  showMessageMeta?: boolean;
  stickyMessageMeta?: boolean;
}) {
  if (isProjectionUserPromptItem(item)) {
    if (compact) {
      return null;
    }
    const rewindTarget = readProjectionRewindTarget(item);
    return wrapRunLogFeedEntry(
      <UserPromptBlock
        text={item.text}
        anchorId={item.id}
        createdAt={item.at}
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
        createdAt={item.at}
        showMessageMeta={showMessageMeta}
        stickyMessageMeta={stickyMessageMeta}
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
        {...(block.reconnectFailed && { reconnectFailed: block.reconnectFailed })}
        {...(block.reconnectDetail && { reconnectDetail: block.reconnectDetail })}
      />,
      { compact },
    );
  }

  return wrapRunLogFeedEntry(
    <DetailBlock
      block={block}
      requestActive={requestActive}
      createdAt={item.at}
      actionInlineLoadingActive={shouldShowActionInlineLoading({
        itemRequestId: item.requestId,
        requestSpan,
      })}
      hideSubagentIdentity={compact}
      forceActionDetailsExpanded={forceActionDetailsExpanded}
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
  selected,
  onOpen,
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
  selected: boolean;
  onOpen: () => void;
}) {
  const kindBadge = resolveSubagentKindBadge(role);
  const resolvedMissionText = missionText ? resolveMissionDisplayText(missionText) : "";

  return (
    <button
      type="button"
      className={`subagent-run-row${running ? " is-running" : ""}${selected ? " is-expanded" : ""}`}
      onClick={onOpen}
      aria-pressed={selected}
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
            {durationLabel ? <span className="subagent-run-duration">{durationLabel}</span> : null}
            {running ? <span className="subagent-run-loading" aria-hidden /> : null}
            {!running ? (
              <span className={`subagent-run-status-badge tone-${statusBadge.tone}`}>
                {statusBadge.label}
              </span>
            ) : null}
            <ArrowRight size={16} className="subagent-run-chevron" aria-hidden />
          </span>
        </div>
        <p className="subagent-run-mission-tag">任务目标</p>
        {resolvedMissionText ? (
          <ExpandableMissionText
            text={resolvedMissionText}
            expanded={false}
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
  const renderedText = expanded ? text : thinkingPreviewLine(text);

  return (
    <div className={`run-log-expandable-text-wrap${expanded ? " is-expanded" : ""}`}>
      <p className={["run-log-expandable-text", className].filter(Boolean).join(" ")} title={text}>
        {renderedText}
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
  forceActionDetailsExpanded = false,
  requestActive = false,
  actionInlineLoadingActive = false,
  requestSpan,
  agentThemes,
  createdAt,
}: {
  block: ActivityDetailBlock;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  hideSubagentIdentity?: boolean;
  forceActionDetailsExpanded?: boolean;
  requestActive?: boolean;
  actionInlineLoadingActive?: boolean;
  requestSpan?: ThreadRunProjectionRequestSpan;
  agentThemes?: RuntimeAgentThemes;
  createdAt?: string;
}) {
  const omitSubagent = shouldOmitSubagentIdentity(block, hideSubagentIdentity);

  if (block.kind === "phase") {
    return (
      <PhaseBlock
        label={block.label}
        {...(block.reconnecting && { reconnecting: block.reconnecting })}
        {...(block.reconnectFailed && { reconnectFailed: block.reconnectFailed })}
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
    return <WaitingThinkingBlock active={requestActive} {...(requestSpan && { requestSpan })} />;
  }
  if (block.kind === "agent-request") {
    return <WaitingThinkingBlock active={requestActive} {...(requestSpan && { requestSpan })} />;
  }
  if (block.kind === "action") {
    return (
      <RunLogAction
        icon={block.icon}
        label={block.label}
        {...(block.bashRun && { bashRun: block.bashRun })}
        {...(block.fileChange && { fileChange: block.fileChange })}
        {...(block.readTarget && { readTarget: block.readTarget })}
        {...(block.grepTarget && { grepTarget: block.grepTarget })}
        {...(block.lifecycle && { lifecycle: block.lifecycle })}
        {...(block.subagent && { subagent: block.subagent })}
        omitRoleLabel={omitSubagent}
        forceDetailsExpanded={forceActionDetailsExpanded}
        showInlineLoading={block.lifecycle === "running" && actionInlineLoadingActive}
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
      {...(createdAt && { createdAt })}
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
  reconnectFailed,
  reconnectDetail,
}: {
  label: string;
  reconnecting?: boolean;
  reconnectFailed?: boolean;
  reconnectDetail?: string;
}) {
  if (isContextCompactionPhaseLabel(label)) {
    return <ContextCompactionDivider label={label} />;
  }
  if (isPromptCacheNoticePhaseLabel(label)) {
    return <PromptCacheNoticeDivider label={label} />;
  }
  if (reconnecting) {
    const isFailure = Boolean(reconnectFailed);
    const className = `run-log-reconnect${isFailure ? " run-log-reconnect--failed" : ""}`;
    const ReconnectIcon = isFailure ? AlertCircle : RefreshCw;
    const summaryRow = (
      <>
        <ReconnectIcon
          size={14}
          className={`run-log-reconnect-icon${isFailure ? "" : " spinning"}`}
          aria-hidden
        />
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
    /已经变更为/u.test(label) ||
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
              <span className="run-log-thinking-timing-inline"> · 耗时 {formatDurationMs(durationMs)}</span>
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

function resolveRequestDurationMs(requestSpan?: ThreadRunProjectionRequestSpan): number | undefined {
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
  const thinkingBodyInnerRef = useRef<HTMLDivElement>(null);
  const hasBody = text.trim().length > 0;
  const [collapsed, setCollapsed] = useState(() => !streaming && hasBody);
  const [showDuration, setShowDuration] = useState(false);
  const [isCollapsing, setIsCollapsing] = useState(false);
  const collapseDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapseAnimRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCollapseEligibleRef = useRef(false);
  const autoCollapseSuppressedRef = useRef(false);
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
    onLayoutChange?.({ immediate: true });
    setIsCollapsing(true);
    collapseAnimRef.current = setTimeout(() => {
      collapseAnimRef.current = null;
      setCollapsed(true);
      setIsCollapsing(false);
      onLayoutChange?.({ immediate: true });
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

  useLayoutEffect(() => {
    if (
      streaming ||
      !hasBody ||
      collapsed ||
      !autoCollapseEligibleRef.current ||
      autoCollapseSuppressedRef.current
    ) {
      return;
    }
    autoCollapseEligibleRef.current = false;
    clearCollapseTimers();
    setIsCollapsing(false);
    setCollapsed(true);
    onLayoutChange?.({ immediate: true });
  }, [streaming, hasBody, collapsed, clearCollapseTimers, onLayoutChange]);

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

  useLayoutEffect(() => {
    onLayoutChange?.({ immediate: !bodyOpen });
  }, [bodyOpen, onLayoutChange]);

  useLayoutEffect(() => {
    if (!streaming || !hasBody) {
      return;
    }
    const bodyInner = thinkingBodyInnerRef.current;
    if (!bodyInner) {
      return;
    }
    const distanceFromBottom = bodyInner.scrollHeight - bodyInner.scrollTop - bodyInner.clientHeight;
    if (distanceFromBottom <= 48) {
      bodyInner.scrollTop = bodyInner.scrollHeight;
    }
  }, [streaming, hasBody, text]);

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
            <span className="run-log-thinking-timing-inline"> · 耗时 {formatDurationMs(durationMs)}</span>
          ) : null}
        </span>
        {showPreview ? (
          <span className="run-log-thinking-preview is-visible" title={preview}>
            {preview}
          </span>
        ) : null}
      </button>
      {hasBody && (bodyOpen || isCollapsing) ? (
        <div className={["run-log-thinking-body-shell", bodyOpen ? "open" : ""].filter(Boolean).join(" ")}>
          <div className="run-log-thinking-body-inner" ref={thinkingBodyInnerRef}>
            <div className="run-log-thinking-body">
              {streaming ? (
                <div className="run-log-thinking-body-plain">{text}</div>
              ) : (
                <MarkdownContent text={text} className="markdown-content" />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UserPromptBlock({
  text,
  className,
  anchorId,
  createdAt,
  rewindTarget,
  onRestorePrompt,
}: {
  text: string;
  className?: string;
  anchorId?: string;
  createdAt?: string;
  rewindTarget?: ThreadActivityRewindTarget;
  onRestorePrompt?: RestorePromptHandler;
}) {
  const bodyRef = useRef<HTMLPreElement>(null);
  const previousTextRef = useRef(text);
  const [expanded, setExpanded] = useState(false);
  const [canToggle, setCanToggle] = useState(false);

  useLayoutEffect(() => {
    if (previousTextRef.current === text) {
      return;
    }
    previousTextRef.current = text;
    setExpanded(false);
    setCanToggle(false);
  }, [text]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      setCanToggle(false);
      return;
    }
    if (expanded) {
      return;
    }

    const measure = () => {
      setCanToggle(body.scrollHeight > body.clientHeight + 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [text, expanded]);

  const contentClassName = [
    "run-log-user-prompt-content",
    canToggle ? "has-toggle" : "",
    expanded ? "is-expanded" : "is-collapsed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={["run-log-user-prompt", className].filter(Boolean).join(" ")}
      {...(anchorId && { "data-user-message-anchor-id": anchorId })}
    >
      <div className={contentClassName}>
        <div className="run-log-user-prompt-bubble">
          <div
            className={["run-log-user-prompt-body-wrap", !expanded ? "collapsed" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <pre
              ref={bodyRef}
              className={["run-log-user-prompt-body", !expanded ? "collapsed" : ""]
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
      </div>
      <RunLogMessageMeta
        align="end"
        {...(createdAt && { createdAt })}
        {...(onRestorePrompt && rewindTarget && {
          restorePrompt: {
            text,
            rewindTarget,
            onRestorePrompt,
          },
        })}
      />
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
  modelByRole: _modelByRole,
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
        <ChevronDown size={16} className={`run-log-mission-chevron${expanded ? " open" : ""}`} aria-hidden />
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

function RunLogInlineLoading({ label = "正在执行" }: { label?: string }) {
  return (
    <span className="run-log-inline-loading" role="status" aria-label={label}>
      <StreamingTypingIndicator />
    </span>
  );
}

function RunLogAction({
  icon,
  label,
  lifecycle,
  showInlineLoading = false,
  bashRun,
  fileChange,
  readTarget,
  grepTarget,
  subagent,
  modelByRole,
  omitRoleLabel,
  forceDetailsExpanded = false,
}: {
  icon: ActivityActionIcon;
  label: string;
  lifecycle?: ToolActionLifecycle;
  showInlineLoading?: boolean;
  bashRun?: import("../shared/activity-display").BashRunCardDisplay;
  fileChange?: import("../shared/activity-display").FileChangeCardDisplay;
  readTarget?: import("../shared/tool-target").ReadToolTargetDisplay;
  grepTarget?: import("../shared/tool-target").GrepToolTargetDisplay;
  subagent?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
  forceDetailsExpanded?: boolean;
}) {
  const Icon = actionIcons[icon];
  const isTerminal = icon === "terminal";
  const [expanded, setExpanded] = useState(false);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [canExpand, setCanExpand] = useState(false);
  const approvalLifecycle = lifecycle && isApprovalLifecycle(lifecycle) ? lifecycle : undefined;
  const StatusIcon = approvalLifecycle ? approvalLifecycleStatusIcons[approvalLifecycle] : undefined;
  const statusLabel = approvalLifecycle ? lifecycleStatusLabels[approvalLifecycle] : undefined;
  const subagentRole = subagent?.trim() ? subagent : undefined;
  const showRoleLabel =
    subagentRole !== undefined &&
    !omitRoleLabel &&
    !activityLabelIncludesAgentRole(subagentRole, label, { modelId: modelByRole?.[subagentRole] });
  const roleLabel =
    showRoleLabel && subagentRole
      ? formatRoleModelLabel(subagentRole, modelByRole?.[subagentRole])
      : undefined;
  const displayLabel = bashRun?.title ?? fileChange?.fileName ?? label;
  const hasHeavyDetails = Boolean(bashRun || fileChange);
  const detailsExpanded = forceDetailsExpanded || expanded;
  const canToggleDetails = !forceDetailsExpanded && (hasHeavyDetails || (isTerminal && canExpand));

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
    canToggleDetails ? "is-expandable" : "",
    detailsExpanded ? "is-expanded" : "",
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
            {...(statusLabel && { "aria-label": statusLabel })}
          />
        ) : null}
      </span>
      <span ref={labelRef} className="run-log-action-label">
        {displayLabel}
      </span>
      {showInlineLoading ? <RunLogInlineLoading /> : null}
      {bashRun?.meta ? <span className="run-log-action-meta">{bashRun.meta}</span> : null}
      {fileChange && !detailsExpanded && (fileChange.additions > 0 || fileChange.deletions > 0) ? (
        <span className="run-log-file-change-card-stats run-log-action-file-stats">
          {fileChange.additions > 0 ? <span className="stat-add">+{fileChange.additions}</span> : null}
          {fileChange.deletions > 0 ? <span className="stat-del">-{fileChange.deletions}</span> : null}
        </span>
      ) : null}
      {hasHeavyDetails || (isTerminal && canExpand) ? (
        <ChevronDown
          size={14}
          className={`run-log-action-chevron${detailsExpanded ? " open" : ""}`}
          aria-hidden
        />
      ) : null}
    </>
  );

  if (bashRun) {
    return (
      <div className="run-log-action run-log-action--with-card run-log-action--bash-card">
        {roleLabel ? (
          <span className="run-log-action-role run-log-action--bash-card-role">{roleLabel}</span>
        ) : null}
        <div className="run-log-action-main">
          {canToggleDetails ? (
            <button
              type="button"
              className={triggerClassName}
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={detailsExpanded}
              title={detailsExpanded ? undefined : bashRun.title}
            >
              {row}
            </button>
          ) : (
            <div className={triggerClassName}>{row}</div>
          )}
          {detailsExpanded ? (
            <div className="run-log-action-card-detail">
              <RunLogBashCard
                display={bashRun}
                showInlineLoading={showInlineLoading}
                {...(lifecycle && { lifecycle })}
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (fileChange) {
    return (
      <div className="run-log-action run-log-action--with-card run-log-action--file-change-card">
        {roleLabel ? <span className="run-log-action-role">{roleLabel}</span> : null}
        <div className="run-log-action-main">
          {canToggleDetails ? (
            <button
              type="button"
              className={triggerClassName}
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={detailsExpanded}
              title={detailsExpanded ? undefined : fileChange.fileName}
            >
              {row}
            </button>
          ) : (
            <div className={triggerClassName}>{row}</div>
          )}
          {detailsExpanded ? (
            <div className="run-log-action-card-detail">
              <RunLogFileChangeCard
                display={fileChange}
                showInlineLoading={showInlineLoading}
                {...(lifecycle && { lifecycle })}
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (readTarget) {
    return (
      <div className="run-log-action run-log-action--read-target">
        {roleLabel ? <span className="run-log-action-role">{roleLabel}</span> : null}
        <RunLogReadTargetLine
          readTarget={readTarget}
          showInlineLoading={showInlineLoading}
          {...(lifecycle && { lifecycle })}
        />
      </div>
    );
  }

  if (grepTarget) {
    return (
      <div className="run-log-action run-log-action--grep-target">
        {roleLabel ? <span className="run-log-action-role">{roleLabel}</span> : null}
        <RunLogGrepTargetLine
          grepTarget={grepTarget}
          showInlineLoading={showInlineLoading}
          {...(lifecycle && { lifecycle })}
        />
      </div>
    );
  }

  return (
    <div
      className={["run-log-action", isTerminal ? "run-log-action--terminal" : ""].filter(Boolean).join(" ")}
    >
      {roleLabel ? <span className="run-log-action-role">{roleLabel}</span> : null}
      <div className="run-log-action-main">
        {isTerminal && canToggleDetails ? (
          <button
            type="button"
            className={triggerClassName}
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={detailsExpanded}
            title={detailsExpanded ? undefined : label}
          >
            {row}
          </button>
        ) : (
          <div className={triggerClassName}>{row}</div>
        )}
        {isTerminal && canExpand && detailsExpanded ? (
          <div className="run-log-action-detail-shell open">
            <div className="run-log-action-detail-inner">
              <pre className="run-log-action-detail">{label}</pre>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RunLogReadTargetLine({
  readTarget,
  lifecycle,
  showInlineLoading = false,
}: {
  readTarget: import("../shared/tool-target").ReadToolTargetDisplay;
  lifecycle?: ToolActionLifecycle;
  showInlineLoading?: boolean;
}) {
  return (
    <p
      className={[
        "run-log-read-target",
        lifecycle === "running" ? "is-running" : "",
        lifecycle === "failed" ? "is-failed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="run-log-read-target-verb">Read</span>{" "}
      <span className="run-log-read-target-file">{readTarget.fileName}</span>
      {readTarget.lineRange ? (
        <>
          {" "}
          <span className="run-log-read-target-range">{readTarget.lineRange}</span>
        </>
      ) : null}
      {showInlineLoading ? <RunLogInlineLoading label="正在读取" /> : null}
    </p>
  );
}

function RunLogGrepTargetLine({
  grepTarget,
  lifecycle,
  showInlineLoading = false,
}: {
  grepTarget: import("../shared/tool-target").GrepToolTargetDisplay;
  lifecycle?: ToolActionLifecycle;
  showInlineLoading?: boolean;
}) {
  return (
    <p
      className={[
        "run-log-grep-target",
        lifecycle === "running" ? "is-running" : "",
        lifecycle === "failed" ? "is-failed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="run-log-grep-target-verb">Grepped</span>{" "}
      <span className="run-log-grep-target-detail">{formatGrepTargetInlineDetail(grepTarget)}</span>
      {showInlineLoading ? <RunLogInlineLoading label="正在搜索" /> : null}
    </p>
  );
}

function RunLogFileChangeCard({
  display,
  lifecycle,
  showInlineLoading = false,
}: {
  display: import("../shared/activity-display").FileChangeCardDisplay;
  lifecycle?: ToolActionLifecycle;
  showInlineLoading?: boolean;
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
        {showInlineLoading ? <RunLogInlineLoading label="正在写入文件" /> : null}
        {!expanded && (display.additions > 0 || display.deletions > 0) ? (
          <span className="run-log-file-change-card-stats">
            {display.additions > 0 ? <span className="stat-add">+{display.additions}</span> : null}
            {display.deletions > 0 ? <span className="stat-del">-{display.deletions}</span> : null}
          </span>
        ) : null}
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
  showInlineLoading = false,
}: {
  display: import("../shared/activity-display").BashRunCardDisplay;
  lifecycle?: ToolActionLifecycle;
  showInlineLoading?: boolean;
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
        {showInlineLoading ? <RunLogInlineLoading label="正在运行命令" /> : null}
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
  createdAt,
  showMessageMeta = false,
  stickyMessageMeta = false,
  streaming,
  subagent,
  compact,
  modelByRole,
  usageByRole,
  omitSubagentBadge,
  requestSpan,
}: {
  text: string;
  createdAt?: string;
  showMessageMeta?: boolean;
  stickyMessageMeta?: boolean;
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
  const showFinalMessageMeta = showMessageMeta && hasBody && !streaming;
  const showStickyMessageMeta = showFinalMessageMeta && stickyMessageMeta;
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
    <div
      className={[
        "run-log-narrative",
        compact ? "compact" : "",
        showStickyMessageMeta ? "run-log-narrative--sticky-final" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
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
      {showFinalMessageMeta ? (
        <RunLogMessageMeta
          align="start"
          copyText={text}
          sticky={showStickyMessageMeta}
          {...(createdAt && { createdAt })}
        />
      ) : null}
    </div>
  );
}
