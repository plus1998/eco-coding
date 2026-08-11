import { isSubagentMissionEnvelope, resolveMissionDisplayText } from "@eco/runtime/agent-mission";
import {
  COMPOSER_MAX_IMAGES,
  readImageFileAsAttachment,
} from "./composer-attachments";
import { copyTextToClipboard } from "./clipboard";
import {
  formatCostUsd,
  formatRoleModelLabel,
  formatTokenCount,
  formatUsageBadge,
  shortenModelId,
} from "@eco/runtime/usage";
import { i18n } from "./i18n";
import {
  AppWindow,
  ArrowDownToLine,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  CircleHelp,
  Copy,
  Database,
  FileSearch,
  FileText,
  Gauge,
  Globe2,
  Image as ImageIcon,
  Minimize2,
  Pencil,
  RefreshCw,
  Reply,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { ICON_SIZE, ICON_STROKE } from "./icon-metrics";
import {
  memo,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import {
  activityLabelIncludesAgentRole,
  clampActivityPreviewLine,
  type ToolActionLifecycle,
} from "../shared/activity-display";
import type {
  PromptImageAttachment,
  ThreadContinueResult,
  ThreadActivityRewindTarget,
  ThreadBillingSnapshot,
  ThreadContextSnapshot,
  ThreadRunProjectionAttempt,
  ThreadRunProjectionAgent,
  ThreadRunProjectionRequestSpan,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
  ThreadSubagentMetricsSummary,
  ThreadSubagentSessionTiming,
  ThreadSummary,
  ThreadUsageSnapshot,
  ThreadUserMessageEditGetResult,
} from "../shared/ipc";
import { isEcoImageGenerationToolName } from "../shared/image-generation";
import { type PromptImagePreview, readPromptImagePreviews } from "../shared/prompt-image-metadata";
import { isAgentDisplayRole, normalizeAgentDisplayRole } from "../shared/subagent-roles";
import { resolveSubagentActivityTitle } from "../shared/subagent-task-name";
import { formatGrepTargetInlineDetail } from "../shared/tool-target";
import { parseWorktreeMergeMessage } from "../shared/worktree-merge";
import {
  type ActivityFeedLayoutChange,
  ActivityFeedLayoutContext,
  useActivityFeedLayoutChange,
} from "./activity-feed-layout-context";
import {
  type ActivityActionIcon,
  type ActivityDetailBlock,
  formatDuration,
  iconForToolName,
  resolveSubagentRunDisplayTitle,
  thinkingPreviewLine,
} from "./activity-log";
import { MarkdownContent } from "./MarkdownContent";
import { type RuntimeAgentDisplayNames, resolveRuntimeAgentName } from "./runtime-agent-display";
import { type RuntimeAgentThemes, resolveSubagentRowThemeStyle } from "./runtime-agent-theme";
import { StreamingMarkdownContent } from "./StreamingMarkdownContent";
import { StreamingTypingIndicator } from "./StreamingTypingIndicator";
import {
  resolveThinkingCollapseHoldMs,
  resolveThinkingExpanded,
  THINKING_COLLAPSE_ANIM_MS,
} from "./thinking-block-expand";
import {
  buildThreadRunProjectionViewModel,
  collapseConsecutiveThinkingTimelineItems,
  collapseEphemeralReasoningSummaryTimeline,
  collapseProjectionToolLifecycleItemsForDetail,
  collapseProjectionTimelineStreamsForDetail,
  isProjectionRequestActive,
  isProjectionSubagentPromptItem,
  isProjectionUserPromptItem,
  projectionItemToDetailBlock,
  readProjectionAgentDelegation,
  resolveProjectionAgentStatusText,
  type ThreadRunProjectionAgentEchoFeedEntry,
  type ThreadRunProjectionMainFeedEntry,
  type ThreadRunProjectionTimelineFeedEntry,
  type ThreadRunProjectionToolGroupFeedEntry,
  type ThreadRunProjectionViewModel,
} from "./thread-run-projection-view";
import { buildThreadRunTurnFeedSections, type ThreadRunTurnFeedSection } from "./thread-run-turn-feed";
import { usePacedStreamText } from "./use-paced-stream-text";
import { WorkspaceChangesCard } from "./WorkspaceChangesCard";

type RestorePromptHandler = (prompt: string, rewindTarget?: ThreadActivityRewindTarget) => void;
type LoadUserMessageEditHandler = (activityLineId: string) => Promise<ThreadUserMessageEditGetResult>;
type RewriteUserMessageHandler = (input: {
  activityLineId: string;
  prompt: string;
  attachments: PromptImageAttachment[];
  expectedHistoryRevision: number;
}) => Promise<ThreadContinueResult>;
type OpenSubagentHandler = (agentId: string) => void;
type OpenImageGenerationToolHandler = (toolUseId: string) => void;
type ProjectionRequestSpan = ThreadRunProjectionSnapshot["requestSpans"][number];
type ProjectionRequestSpansById = Map<string, ProjectionRequestSpan>;
type ToolGroupDetailBlock = Extract<ActivityDetailBlock, { kind: "action" | "tool-failed" }>;

const SUBAGENT_DETAIL_STICK_THRESHOLD_PX = 96;
const SUBAGENT_DETAIL_USER_SCROLL_DELTA_PX = 2;
const LIVE_DURATION_TICK_MS = 1_000;
const TOOL_RUNNING_MIN_VISIBLE_MS = 1_000;

function distanceFromBottom(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight);
}

function readRewindTarget(value: unknown): ThreadActivityRewindTarget | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const target = value as Partial<ThreadActivityRewindTarget>;
  const activityLineId = typeof target.activityLineId === "string" ? target.activityLineId.trim() : "";
  const userMessageId = typeof target.userMessageId === "string" ? target.userMessageId.trim() : "";
  if (!activityLineId) {
    return undefined;
  }
  return userMessageId ? { activityLineId, userMessageId } : { activityLineId };
}

function readProjectionRewindTarget(
  item: ThreadRunProjectionTimelineItem,
): ThreadActivityRewindTarget | undefined {
  return readRewindTarget(item.metadata?.rewindTarget);
}

function formatRunLogMessageTime(
  value?: string,
): { label: string; title: string; dateTime: string } | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return {
    label: date.toLocaleString(i18n.resolvedLanguage, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    title: date.toLocaleString(i18n.resolvedLanguage, {
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
  void copyTextToClipboard(text);
}

function scrollBashOutputFromCommand(event: WheelEvent<HTMLDivElement>): void {
  const output = event.currentTarget
    .closest(".run-log-bash-terminal")
    ?.querySelector<HTMLElement>(".run-log-bash-output-wrap");
  if (!output || event.deltaY === 0) {
    return;
  }
  const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? output.clientHeight : 1;
  const deltaY = event.deltaY * multiplier;
  const maxScrollTop = Math.max(0, output.scrollHeight - output.clientHeight);
  const nextScrollTop = Math.min(maxScrollTop, Math.max(0, output.scrollTop + deltaY));
  if (nextScrollTop === output.scrollTop) {
    return;
  }
  output.scrollTop = nextScrollTop;
  event.preventDefault();
  event.stopPropagation();
}

function RunLogMessageMeta({
  createdAt,
  copyText,
  restorePrompt,
  editUserMessage,
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
  editUserMessage?: {
    onEdit: () => void;
    disabled?: boolean;
  };
  align?: "start" | "end";
  sticky?: boolean;
}) {
  const time = formatRunLogMessageTime(createdAt);
  const canCopy = Boolean(copyText?.trim());
  if (!time && !canCopy && !restorePrompt && !editUserMessage) {
    return null;
  }

  return (
    <div
      className={[
        "run-log-message-meta",
        align === "end" ? "run-log-message-meta--end" : "run-log-message-meta--start",
        sticky ? "run-log-message-meta--sticky" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {restorePrompt ? (
        <button
          type="button"
          className="run-log-message-meta-button"
          onClick={() => restorePrompt.onRestorePrompt(restorePrompt.text, restorePrompt.rewindTarget)}
          aria-label={i18n.t("activity.rewind")}
          title={i18n.t("activity.rewindTitle")}
        >
          <Reply size={13} />
        </button>
      ) : null}
      {editUserMessage ? (
        <button
          type="button"
          className="run-log-message-meta-button"
          onClick={editUserMessage.onEdit}
          aria-label={i18n.t("activity.editMessage", { defaultValue: "编辑消息" })}
          title={i18n.t("activity.editMessageTitle", { defaultValue: "编辑消息并从此处继续" })}
          disabled={editUserMessage.disabled}
        >
          <Pencil size={13} />
        </button>
      ) : null}
      {canCopy ? (
        <button
          type="button"
          className="run-log-message-meta-button"
          onClick={() => copyRunLogMessageText(copyText ?? "")}
          aria-label={i18n.t("activity.copyMessage")}
          title={i18n.t("activity.copyMessage")}
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
  if (block.kind === "phase" || block.kind === "thinking" || block.kind === "reasoning-stage") {
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
  return (
    status === "completed" ||
    status === "failed" ||
    status === "blocked" ||
    status === "cancelled" ||
    status === "idle"
  );
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
  onLoadUserMessageEdit?: LoadUserMessageEditHandler;
  onRewriteUserMessage?: RewriteUserMessageHandler;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  context?: ThreadContextSnapshot;
  billing?: ThreadBillingSnapshot;
  projection?: ThreadRunProjectionSnapshot;
  viewModel?: ThreadRunProjectionViewModel;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  agentThemes?: RuntimeAgentThemes;
  subagentTimings?: ThreadSubagentSessionTiming[];
  subagentMetrics?: ThreadSubagentMetricsSummary[];
  selectedSubagentAgentId?: string;
  onOpenSubagent?: OpenSubagentHandler;
  onOpenImageGenerationTool?: OpenImageGenerationToolHandler;
  /** Called when planner / main-window log content changes — scroll the activity feed. */
  onPlannerLayoutChange?: ActivityFeedLayoutChange;
}

function ProjectionFeedLoading() {
  return (
    <div className="run-log run-log-empty" role="status" aria-label={i18n.t("activity.loading")}>
      <div className="run-log-projection-loading" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export const ActivityLogView = memo(function ActivityLogView(props: ActivityLogViewProps) {
  useTranslation();
  const projection = props.projection;
  if (!projection?.sourceEventCount) {
    if (props.thread?.prompt && !isThreadStoppedForFinalSummary(props.thread.status)) {
      return (
        <div className="run-log">
          {wrapRunLogFeedEntry(
            <UserPromptBlock
              text={props.thread.prompt}
              anchorId={`thread:${props.thread.id}`}
              createdAt={props.thread.createdAt}
            />,
          )}
          <RunLogActiveTail waiting />
        </div>
      );
    }
    return <ProjectionFeedLoading />;
  }
  return (
    <ProjectionActivityLogView
      projection={projection}
      {...(props.viewModel && { precomputedViewModel: props.viewModel })}
      {...(props.thread && { thread: props.thread })}
      {...(props.agentDisplayNames && { agentDisplayNames: props.agentDisplayNames })}
      {...(props.agentThemes && { agentThemes: props.agentThemes })}
      {...(props.onRestorePrompt && { onRestorePrompt: props.onRestorePrompt })}
      {...(props.onLoadUserMessageEdit && { onLoadUserMessageEdit: props.onLoadUserMessageEdit })}
      {...(props.onRewriteUserMessage && { onRewriteUserMessage: props.onRewriteUserMessage })}
      {...(props.selectedSubagentAgentId && { selectedSubagentAgentId: props.selectedSubagentAgentId })}
      {...(props.onOpenSubagent && { onOpenSubagent: props.onOpenSubagent })}
      {...(props.onOpenImageGenerationTool && {
        onOpenImageGenerationTool: props.onOpenImageGenerationTool,
      })}
      {...(props.onPlannerLayoutChange && { onPlannerLayoutChange: props.onPlannerLayoutChange })}
    />
  );
});

function ProjectionActivityLogView({
  projection,
  precomputedViewModel,
  thread,
  onRestorePrompt,
  onLoadUserMessageEdit,
  onRewriteUserMessage,
  onPlannerLayoutChange,
  agentDisplayNames,
  agentThemes,
  selectedSubagentAgentId,
  onOpenSubagent,
  onOpenImageGenerationTool,
}: {
  projection: ThreadRunProjectionSnapshot;
  precomputedViewModel?: ThreadRunProjectionViewModel;
  thread?: ThreadSummary;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  agentThemes?: RuntimeAgentThemes;
  selectedSubagentAgentId?: string;
  onOpenSubagent?: OpenSubagentHandler;
  onOpenImageGenerationTool?: OpenImageGenerationToolHandler;
  onRestorePrompt?: RestorePromptHandler;
  onLoadUserMessageEdit?: LoadUserMessageEditHandler;
  onRewriteUserMessage?: RewriteUserMessageHandler;
  onPlannerLayoutChange?: ActivityFeedLayoutChange;
}) {
  const requestSpansById = useMemo(
    () => new Map(projection.requestSpans.map((span) => [span.requestId, span])),
    [projection.requestSpans],
  );
  const viewModel = useMemo(
    () =>
      precomputedViewModel ??
      buildThreadRunProjectionViewModel(
        projection,
        thread ? { id: thread.id, prompt: thread.prompt } : undefined,
        { agentDisplayNames },
      ),
    [agentDisplayNames, precomputedViewModel, projection, thread?.id, thread?.prompt],
  );
  const showThreadPrompt = viewModel.showThreadPrompt;
  const feedSections = useMemo(
    () => buildThreadRunTurnFeedSections(viewModel.mainFeedEntries, projection),
    [projection, viewModel.mainFeedEntries],
  );
  const conversationActive = !isThreadStoppedForFinalSummary(projection.thread.status);
  const showInitialWaiting =
    conversationActive &&
    viewModel.mainFeedEntries.every(
      (entry) => entry.kind === "timeline" && isProjectionUserPromptItem(entry.item),
    );
  const waitingThinkingVisible =
    showInitialWaiting ||
    viewModel.mainFeedEntries.some((entry) => {
      if (entry.kind !== "timeline" && entry.kind !== "agent-echo") {
        return false;
      }
      return isWaitingThinkingItem(entry.item, requestSpansById);
    });
  const finalSummaryItemIds = useMemo(() => {
    const ids = new Set(resolveTurnFinalSummaryItemIds(viewModel.mainFeedEntries, projection.thread.status));
    for (const section of feedSections) {
      if (section.kind === "turn" && section.finalEntry?.kind === "timeline") {
        ids.add(section.finalEntry.item.id);
      }
    }
    return ids;
  }, [feedSections, projection.thread.status, viewModel.mainFeedEntries]);
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
                {...(onLoadUserMessageEdit && { onLoadUserMessageEdit })}
                {...(onRewriteUserMessage && { onRewriteUserMessage })}
                historyRevision={projection.historyRevision ?? 0}
              />,
            )
          : null}
        {feedSections.map((section) =>
          section.kind === "turn" ? (
            <ProjectionTurnFeedSection
              key={section.key}
              section={section}
              requestSpansById={requestSpansById}
              finalSummaryItemIds={finalSummaryItemIds}
              {...(stickyFinalSummaryItemId && { stickyFinalSummaryItemId })}
              {...(selectedSubagentAgentId && { selectedSubagentAgentId })}
              {...(onOpenSubagent && { onOpenSubagent })}
              {...(onOpenImageGenerationTool && { onOpenImageGenerationTool })}
              {...(agentDisplayNames && { agentDisplayNames })}
              {...(agentThemes && { agentThemes })}
              {...(onRestorePrompt && { onRestorePrompt })}
              {...(onLoadUserMessageEdit && { onLoadUserMessageEdit })}
              {...(onRewriteUserMessage && { onRewriteUserMessage })}
              historyRevision={projection.historyRevision ?? 0}
            />
          ) : (
            <ProjectionMainFeedEntry
              key={section.key}
              entry={section.entry}
              requestSpansById={requestSpansById}
              finalSummaryItemIds={finalSummaryItemIds}
              {...(stickyFinalSummaryItemId && { stickyFinalSummaryItemId })}
              {...(selectedSubagentAgentId && { selectedSubagentAgentId })}
              {...(onOpenSubagent && { onOpenSubagent })}
              {...(onOpenImageGenerationTool && { onOpenImageGenerationTool })}
              {...(agentDisplayNames && { agentDisplayNames })}
              {...(agentThemes && { agentThemes })}
              {...(onRestorePrompt && { onRestorePrompt })}
              {...(onLoadUserMessageEdit && { onLoadUserMessageEdit })}
              {...(onRewriteUserMessage && { onRewriteUserMessage })}
              historyRevision={projection.historyRevision ?? 0}
            />
          ),
        )}
        {conversationActive ? <RunLogActiveTail waiting={waitingThinkingVisible} /> : null}
      </div>
    </ActivityFeedLayoutContext.Provider>
  );
}

type ProjectionFeedEntrySharedProps = {
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
  finalSummaryItemIds: ReadonlySet<string>;
  stickyFinalSummaryItemId?: string;
  selectedSubagentAgentId?: string;
  onOpenSubagent?: OpenSubagentHandler;
  onOpenImageGenerationTool?: OpenImageGenerationToolHandler;
  onRestorePrompt?: RestorePromptHandler;
  onLoadUserMessageEdit?: LoadUserMessageEditHandler;
  onRewriteUserMessage?: RewriteUserMessageHandler;
  historyRevision: number;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  agentThemes?: RuntimeAgentThemes;
};

function ProjectionTurnFeedSection({
  section,
  ...entryProps
}: ProjectionFeedEntrySharedProps & {
  section: Extract<ThreadRunTurnFeedSection, { kind: "turn" }>;
}) {
  const requestSpansById = entryProps.requestSpansById;
  // Empty "正在思考" is deferred to the feed active-tail. If the process would only
  // render those rows as null, mark process empty so the divider does not open a
  // hollow padding gap sitting above the tail waiting line.
  const processEmpty = !section.processEntries.some((entry) => {
    if (entry.kind === "timeline" || entry.kind === "agent-echo") {
      return !isWaitingThinkingItem(entry.item, requestSpansById);
    }
    return true;
  });

  return (
    <RunLogTurnSection
      turnKey={section.attempt.attemptId}
      running={section.running}
      status={section.attempt.status}
      startedAt={section.attempt.startedAt}
      {...(section.attempt.endedAt && { endedAt: section.attempt.endedAt })}
      processEmpty={processEmpty}
      process={
        <>
          {section.processEntries.map((entry) => (
            <ProjectionMainFeedEntry key={entry.key} entry={entry} {...entryProps} />
          ))}
        </>
      }
      {...(section.finalEntry && {
        final: <ProjectionMainFeedEntry entry={section.finalEntry} {...entryProps} />,
      })}
    />
  );
}

function RunLogTurnSection({
  turnKey,
  running,
  status,
  startedAt,
  endedAt,
  projectedDurationMs = 0,
  leading,
  process,
  processEmpty,
  final,
  className,
}: {
  turnKey: string;
  running: boolean;
  status?: ThreadRunProjectionAttempt["status"];
  startedAt: string;
  endedAt?: string;
  projectedDurationMs?: number;
  leading?: ReactNode;
  process: ReactNode;
  processEmpty: boolean;
  final?: ReactNode;
  className?: string;
}) {
  const onLayoutChange = useActivityFeedLayoutChange();
  const [expanded, setExpanded] = useState(running);
  const [animateExpansion, setAnimateExpansion] = useState(false);
  const previousRunningRef = useRef(running);
  const measuredDurationMs = useTurnDurationMs(startedAt, endedAt, running);
  const durationMs = Math.max(measuredDurationMs, projectedDurationMs);
  const headingLabel = formatRunLogTurnHeading(running, status, durationMs);
  const contentId = `turn-process-${turnKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  useLayoutEffect(() => {
    setAnimateExpansion(false);
    if (running) {
      setExpanded(true);
    } else if (previousRunningRef.current) {
      setExpanded(false);
    }
    previousRunningRef.current = running;
  }, [running]);

  useLayoutEffect(() => {
    onLayoutChange?.({ immediate: true });
  }, [expanded, onLayoutChange]);

  return (
    <section
      className={[
        "run-log-turn",
        className,
        running ? "is-running" : "is-completed",
        expanded ? "is-expanded" : "is-collapsed",
        animateExpansion ? "is-user-transitioning" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={running ? i18n.t("activity.process") : i18n.t("activity.turnResult")}
    >
      {leading}
      <button
        type="button"
        className="run-log-turn-toggle"
        onClick={() => {
          if (running) {
            return;
          }
          setAnimateExpansion(true);
          setExpanded((value) => !value);
        }}
        disabled={running}
        aria-expanded={expanded}
        aria-controls={contentId}
      >
        <span className="run-log-turn-heading">
          <span className="run-log-turn-status">{headingLabel}</span>
          {!running ? (
            <ChevronRight
              size={15}
              className={`run-log-turn-chevron${expanded ? " open" : ""}`}
              aria-hidden
            />
          ) : null}
        </span>
        <span className="run-log-turn-divider" aria-hidden />
      </button>
      <div
        id={contentId}
        className="run-log-turn-process"
        aria-label={i18n.t("activity.process")}
        aria-hidden={!expanded}
      >
        <div className={`run-log-turn-process-inner${processEmpty ? " is-empty" : ""}`}>{process}</div>
      </div>
      {final ? (
        <div className="run-log-turn-final" aria-label={i18n.t("activity.finalOutput")}>
          {final}
        </div>
      ) : null}
    </section>
  );
}

function formatRunLogTurnHeading(
  running: boolean,
  status: ThreadRunProjectionAttempt["status"] | undefined,
  durationMs: number,
): string {
  if (running) {
    const duration = formatDuration(durationMs);
    return `${i18n.t("activity.processing")}${duration ? ` ${duration}` : ""}`;
  }

  if (status === "cancelled" || status === "failed") {
    const duration = formatStoppedTurnDuration(durationMs);
    if (status === "cancelled") {
      return duration ? i18n.t("activity.stoppedByYouAfter", { duration }) : i18n.t("activity.stoppedByYou");
    }
    return duration
      ? i18n.t("activity.stoppedUnexpectedlyAfter", { duration })
      : i18n.t("activity.stoppedUnexpectedly");
  }

  const duration = formatDuration(durationMs);
  return `${i18n.t("activity.processed")}${duration ? ` ${duration}` : ""}`;
}

function formatStoppedTurnDuration(durationMs: number): string {
  const duration = formatDuration(durationMs);
  if (!duration || !i18n.resolvedLanguage?.toLowerCase().startsWith("zh")) {
    return duration;
  }
  return duration
    .replace(/(\d+)h\b/g, "$1小时")
    .replace(/(\d+)m\b/g, "$1分")
    .replace(/(\d+)s\b/g, "$1秒");
}

function useTurnDurationMs(startedAt: string, endedAt: string | undefined, running: boolean): number {
  const resolve = useCallback(() => {
    const startMs = Date.parse(startedAt);
    const endMs = endedAt ? Date.parse(endedAt) : Date.now();
    return Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;
  }, [endedAt, startedAt]);
  const [durationMs, setDurationMs] = useState(resolve);

  useEffect(() => {
    const update = () => {
      const next = resolve();
      setDurationMs((current) => (current === next ? current : next));
    };
    update();
    if (!running) return;
    const timer = setInterval(update, LIVE_DURATION_TICK_MS);
    return () => clearInterval(timer);
  }, [resolve, running]);

  return durationMs;
}

export function resolveActiveSubagentDurationMs(
  startedAt: string,
  projectedDurationMs: number,
  nowMs = Date.now(),
): number {
  const startedAtMs = Date.parse(startedAt);
  const elapsedSinceStartMs = Number.isFinite(startedAtMs) ? Math.max(0, nowMs - startedAtMs) : 0;
  return Math.max(0, projectedDurationMs, elapsedSinceStartMs);
}

function useSubagentDurationMs(agent: ThreadRunProjectionAgent, running: boolean): number {
  const resolve = useCallback(
    () =>
      running
        ? resolveActiveSubagentDurationMs(agent.startedAt, agent.durationMs)
        : Math.max(0, agent.durationMs),
    [agent.durationMs, agent.startedAt, running],
  );
  const [durationMs, setDurationMs] = useState(resolve);

  useEffect(() => {
    const update = () => {
      const next = resolve();
      setDurationMs((current) => (current === next ? current : next));
    };
    update();
    if (!running) return;
    const timer = setInterval(update, LIVE_DURATION_TICK_MS);
    return () => clearInterval(timer);
  }, [resolve, running]);

  return durationMs;
}

function isTightFeedDetailBlock(block: ActivityDetailBlock): boolean {
  if (block.kind === "action" && (block.bashRun || block.fileChange || block.webSearch || block.imageView)) {
    return false;
  }
  return (
    block.kind === "action" ||
    block.kind === "model-request" ||
    block.kind === "agent-request" ||
    block.kind === "thinking" ||
    block.kind === "reasoning-stage" ||
    block.kind === "tool-failed" ||
    block.kind === "unknown-item" ||
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

export function readImageGenerationToolUseId(item: ThreadRunProjectionTimelineItem): string | undefined {
  const rawTool = item.metadata?.tool;
  if (!rawTool || typeof rawTool !== "object" || Array.isArray(rawTool)) {
    return undefined;
  }
  const tool = rawTool as Record<string, unknown>;
  const name = typeof tool.name === "string" ? tool.name : undefined;
  const toolUseId = typeof tool.toolUseId === "string" ? tool.toolUseId.trim() : "";
  return name && toolUseId && isEcoImageGenerationToolName(name) ? toolUseId : undefined;
}

function ProjectionMainFeedEntry({
  entry,
  requestSpansById,
  finalSummaryItemIds,
  stickyFinalSummaryItemId,
  selectedSubagentAgentId,
  onOpenSubagent,
  onOpenImageGenerationTool,
  onRestorePrompt,
  onLoadUserMessageEdit,
  onRewriteUserMessage,
  historyRevision,
  agentDisplayNames,
  agentThemes,
}: {
  entry: ThreadRunProjectionMainFeedEntry;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
  finalSummaryItemIds: ReadonlySet<string>;
  stickyFinalSummaryItemId?: string;
  selectedSubagentAgentId?: string;
  onOpenSubagent?: OpenSubagentHandler;
  onOpenImageGenerationTool?: OpenImageGenerationToolHandler;
  onRestorePrompt?: RestorePromptHandler;
  onLoadUserMessageEdit?: LoadUserMessageEditHandler;
  onRewriteUserMessage?: RewriteUserMessageHandler;
  historyRevision: number;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  agentThemes?: RuntimeAgentThemes;
}) {
  if (entry.kind === "timeline") {
    const showMessageMeta = finalSummaryItemIds.has(entry.item.id);
    return (
      <ProjectionTimelineEntry
        item={entry.item}
        requestSpansById={requestSpansById}
        deferWaitingIndicator
        showMessageMeta={showMessageMeta}
        stickyMessageMeta={showMessageMeta && entry.item.id === stickyFinalSummaryItemId}
        {...(onRestorePrompt && { onRestorePrompt })}
        {...(onLoadUserMessageEdit && { onLoadUserMessageEdit })}
        {...(onRewriteUserMessage && { onRewriteUserMessage })}
        historyRevision={historyRevision ?? 0}
        {...(onOpenImageGenerationTool && { onOpenImageGenerationTool })}
      />
    );
  }
  if (entry.kind === "tool-group") {
    return wrapRunLogFeedEntry(
      <ProjectionToolGroupEntry
        entry={entry}
        requestSpansById={requestSpansById}
        {...(onOpenImageGenerationTool && { onOpenImageGenerationTool })}
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
  return wrapRunLogFeedEntry(<ProjectionAgentEchoEntry entry={entry} requestSpansById={requestSpansById} />, {
    tight: isTightAgentEchoEntry(entry),
  });
}

function isTightAgentEchoEntry(
  entry: Extract<ThreadRunProjectionMainFeedEntry, { kind: "agent-echo" }>,
): boolean {
  const block = projectionItemToDetailBlock(entry.item);
  return block ? isTightFeedDetailBlock(block) : false;
}

export function ProjectionToolGroupEntry({
  entry,
  requestSpansById,
  defaultExpanded = false,
  onOpenImageGenerationTool,
}: {
  entry: Extract<ThreadRunProjectionMainFeedEntry, { kind: "tool-group" }>;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
  defaultExpanded?: boolean;
  onOpenImageGenerationTool?: OpenImageGenerationToolHandler;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const blocks = useMemo(
    () =>
      entry.entries
        .map((child) => projectionItemToDetailBlock(child.item))
        .filter(
          (block): block is ToolGroupDetailBlock => block?.kind === "action" || block?.kind === "tool-failed",
        ),
    [entry.entries],
  );
  const currentSummary = useMemo(() => summarizeActionBlocks(blocks), [blocks]);
  const currentLifecycle = useMemo(() => resolveActionBlocksLifecycle(blocks), [blocks]);
  const currentActionIdentity = useMemo(
    () => resolveLatestToolGroupActionIdentity(entry.entries),
    [entry.entries],
  );
  const runningActionIdentity = useMemo(
    () => resolveLatestToolGroupActionIdentity(entry.entries, "running"),
    [entry.entries],
  );
  const { summary, lifecycle } = useMinimumVisibleToolRunningState({
    summary: currentSummary,
    ...(currentLifecycle && { lifecycle: currentLifecycle }),
    ...(currentActionIdentity && { currentActionIdentity }),
    ...(runningActionIdentity && { runningActionIdentity }),
  });
  const imageToolUseIds = [
    ...new Set(
      entry.entries
        .map((child) => readImageGenerationToolUseId(child.item))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const imageToolUseId = imageToolUseIds.length === 1 ? imageToolUseIds[0] : undefined;

  return (
    <div className={["run-log-tool-group", expanded ? "is-expanded" : ""].filter(Boolean).join(" ")}>
      <RunLogCollapsibleActionTrigger
        icon={summary.icon}
        label={
          lifecycle === "running" ? <ShimmerText>{summary.label}</ShimmerText> : summary.label
        }
        {...(lifecycle && { lifecycle })}
        expanded={expanded}
        onClick={() => {
          setExpanded((value) => !value);
          if (imageToolUseId) onOpenImageGenerationTool?.(imageToolUseId);
        }}
      />
      {expanded ? (
        <div className="run-log-tool-group-details">
          {entry.entries.map((child) => (
            <ProjectionToolGroupChildEntry
              key={child.key}
              entry={child}
              requestSpansById={requestSpansById}
              {...(onOpenImageGenerationTool && { onOpenImageGenerationTool })}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface MinimumVisibleToolRunningSnapshot {
  identity: string;
  startedAtMs: number;
  summary: { label: string; icon: ActivityActionIcon };
}

export function resolveMinimumVisibleToolRunningState(input: {
  nowMs: number;
  minimumMs: number;
  summary: { label: string; icon: ActivityActionIcon };
  lifecycle?: ToolActionLifecycle;
  currentActionIdentity?: string;
  runningActionIdentity?: string;
  previous?: MinimumVisibleToolRunningSnapshot;
}): {
  summary: { label: string; icon: ActivityActionIcon };
  lifecycle?: ToolActionLifecycle;
  running?: MinimumVisibleToolRunningSnapshot;
  remainingMs: number;
} {
  if (input.lifecycle === "running" && input.runningActionIdentity) {
    const running =
      input.previous?.identity === input.runningActionIdentity
        ? { ...input.previous, summary: input.summary }
        : {
            identity: input.runningActionIdentity,
            startedAtMs: input.nowMs,
            summary: input.summary,
          };
    return { summary: input.summary, lifecycle: input.lifecycle, running, remainingMs: 0 };
  }

  const previous = input.previous;
  const hasNewerAction = Boolean(
    previous && input.currentActionIdentity && input.currentActionIdentity !== previous.identity,
  );
  if (previous && !hasNewerAction) {
    const remainingMs = Math.max(0, input.minimumMs - (input.nowMs - previous.startedAtMs));
    if (remainingMs > 0) {
      return {
        summary: previous.summary,
        lifecycle: "running",
        running: previous,
        remainingMs,
      };
    }
  }

  return {
    summary: input.summary,
    ...(input.lifecycle && { lifecycle: input.lifecycle }),
    remainingMs: 0,
  };
}

function useMinimumVisibleToolRunningState(input: {
  summary: { label: string; icon: ActivityActionIcon };
  lifecycle?: ToolActionLifecycle;
  currentActionIdentity?: string;
  runningActionIdentity?: string;
}): {
  summary: { label: string; icon: ActivityActionIcon };
  lifecycle?: ToolActionLifecycle;
} {
  const runningRef = useRef<MinimumVisibleToolRunningSnapshot | undefined>(undefined);
  const [, refresh] = useState(0);
  const resolved = resolveMinimumVisibleToolRunningState({
    nowMs: Date.now(),
    minimumMs: TOOL_RUNNING_MIN_VISIBLE_MS,
    summary: input.summary,
    ...(input.lifecycle && { lifecycle: input.lifecycle }),
    ...(input.currentActionIdentity && { currentActionIdentity: input.currentActionIdentity }),
    ...(input.runningActionIdentity && { runningActionIdentity: input.runningActionIdentity }),
    ...(runningRef.current && { previous: runningRef.current }),
  });
  runningRef.current = resolved.running;

  useEffect(() => {
    if (resolved.remainingMs <= 0) {
      return;
    }
    const timer = window.setTimeout(() => refresh((value) => value + 1), resolved.remainingMs);
    return () => window.clearTimeout(timer);
  }, [resolved.remainingMs]);

  return { summary: resolved.summary, ...(resolved.lifecycle && { lifecycle: resolved.lifecycle }) };
}

function resolveLatestToolGroupActionIdentity(
  entries: readonly (ThreadRunProjectionTimelineFeedEntry | ThreadRunProjectionAgentEchoFeedEntry)[],
  lifecycle?: ToolActionLifecycle,
): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) {
      continue;
    }
    const block = projectionItemToDetailBlock(entry.item);
    if (block?.kind === "action" && (!lifecycle || block.lifecycle === lifecycle)) {
      return entry.key;
    }
  }
  return undefined;
}

function ProjectionToolGroupChildEntry({
  entry,
  requestSpansById,
  onOpenImageGenerationTool,
}: {
  entry: ThreadRunProjectionTimelineFeedEntry | ThreadRunProjectionAgentEchoFeedEntry;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
  onOpenImageGenerationTool?: OpenImageGenerationToolHandler;
}) {
  const block = projectionItemToDetailBlock(entry.item);
  if (block?.kind === "action" && block.bashRun) {
    return <ProjectionToolGroupBashChild block={block} />;
  }
  if (block?.kind === "tool-failed" && !block.recoveredResult && block.tool.trim().toLowerCase() === "bash") {
    return <ProjectionToolGroupBashChild block={block} />;
  }
  if (entry.kind === "timeline") {
    return (
      <ProjectionTimelineEntry
        item={entry.item}
        requestSpansById={requestSpansById}
        {...(block?.kind === "action" && {
          actionLabelOverride: formatToolGroupChildDetail(block),
        })}
        compact
        {...(onOpenImageGenerationTool && { onOpenImageGenerationTool })}
      />
    );
  }
  return <ProjectionAgentEchoEntry entry={entry} requestSpansById={requestSpansById} />;
}

function ProjectionToolGroupBashChild({
  block,
}: {
  block:
    | Extract<ActivityDetailBlock, { kind: "action" }>
    | Extract<ActivityDetailBlock, { kind: "tool-failed" }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const bashRun =
    block.kind === "action"
      ? block.bashRun
      : {
          ...(block.command && { command: block.command }),
          ...(block.error && { output: block.error }),
        };
  if (!bashRun) {
    return null;
  }
  const hasDetails = Boolean(bashRun.command || bashRun.output);
  const summary =
    block.kind === "tool-failed"
      ? clampActivityPreviewLine(block.command || block.tool, 64)
      : formatToolGroupChildDetail(block);
  const lifecycle = block.kind === "tool-failed" ? "failed" : block.lifecycle;
  const icon = block.kind === "tool-failed" ? iconForToolName(block.tool) : block.icon;

  return (
    <div className={`run-log-tool-group-child${expanded ? " is-expanded" : ""}`}>
      <button
        type="button"
        className={[
          "run-log-tool-group-trigger",
          "run-log-tool-group-child-trigger",
          lifecycle === "running" ? "is-running" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => hasDetails && setExpanded((value) => !value)}
        aria-expanded={hasDetails ? expanded : undefined}
      >
        <RunLogActionIcon icon={icon} />
        <span className="run-log-tool-group-summary">
          {lifecycle === "running" ? <ShimmerText>{summary}</ShimmerText> : summary}
        </span>
        {lifecycle === "failed" ? (
          <span className="run-log-tool-status-dot" title={i18n.t("activity.incomplete")} aria-hidden />
        ) : null}
        {hasDetails ? (
          <ChevronRight
            size={15}
            className={`run-log-tool-group-chevron${expanded ? " open" : ""}`}
            aria-hidden
          />
        ) : null}
      </button>
      {expanded ? (
        <div className="run-log-tool-group-child-details">
          <RunLogBashTerminal
            {...(bashRun.command && { command: bashRun.command })}
            {...(bashRun.output && { output: bashRun.output })}
          />
        </div>
      ) : null}
    </div>
  );
}

function summarizeActionBlocks(blocks: readonly ToolGroupDetailBlock[]): {
  label: string;
  icon: ActivityActionIcon;
} {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind === "tool-failed") {
      return {
        label: block.recoveredResult
          ? i18n.t("activity.patchRecovered")
          : summarizeFailedTool(block.tool, block.command),
        icon: iconForToolName(block.tool),
      };
    }
  }

  let runningBlock: Extract<ActivityDetailBlock, { kind: "action" }> | undefined;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind === "action" && block.lifecycle === "running") {
      runningBlock = block;
      break;
    }
  }
  if (runningBlock) {
    return {
      label: summarizeRunningActionBlock(runningBlock),
      icon: runningBlock.icon,
    };
  }
  const actionBlocks = blocks.filter(
    (block): block is Extract<ActivityDetailBlock, { kind: "action" }> => block.kind === "action",
  );
  if (actionBlocks.length === 1 && actionBlocks[0]) {
    return {
      label: summarizeCompletedActionBlock(actionBlocks[0]),
      icon: actionBlocks[0].icon,
    };
  }

  const editedFiles = new Set<string>();
  const readFiles = new Set<string>();
  const writtenFiles = new Set<string>();
  let searches = 0;
  let commands = 0;
  let agents = 0;
  let taskCreates = 0;
  let taskUpdates = 0;
  let otherTools = 0;

  for (const block of actionBlocks) {
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
    if (
      block.webSearch ||
      block.icon === "network" ||
      block.toolName === "WebSearch" ||
      block.toolName === "WebFetch"
    ) {
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
    clauses.push(i18n.t("activity.summary.readFiles", { count: readFiles.size }));
  }
  if (writtenFiles.size > 0) {
    clauses.push(i18n.t("activity.summary.writtenFiles", { count: writtenFiles.size }));
  }
  if (editedFiles.size > 0) {
    clauses.push(i18n.t("activity.summary.editedFiles", { count: editedFiles.size }));
  }
  if (searches > 0) {
    clauses.push(i18n.t("activity.summary.searched"));
  }
  if (commands > 0) {
    clauses.push(i18n.t("activity.summary.commands", { count: commands }));
  }
  if (taskCreates > 0) {
    clauses.push(i18n.t("activity.summary.createdTasks", { count: taskCreates }));
  }
  if (taskUpdates > 0) {
    clauses.push(i18n.t("activity.summary.updatedTasks", { count: taskUpdates }));
  }
  if (agents > 0) {
    clauses.push(i18n.t("activity.summary.agents", { count: agents }));
  }
  if (otherTools > 0) {
    clauses.push(i18n.t("activity.summary.tools", { count: otherTools }));
  }

  const label = joinChineseClauses(
    clauses.length ? clauses : [i18n.t("activity.summary.tools", { count: actionBlocks.length })],
  );
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

function summarizeRunningActionBlock(block: Extract<ActivityDetailBlock, { kind: "action" }>): string {
  const target = clampActivityPreviewLine(block.bashRun?.command ?? actionBlockTargetKey(block), 64);
  const suffix = target ? ` ${target}` : "";

  if (block.toolName === "TaskCreate") {
    return i18n.t("activity.running.createTask", { suffix });
  }
  if (block.toolName === "TaskUpdate" || block.toolName === "TodoWrite") {
    return i18n.t("activity.running.updateTask", { suffix });
  }
  if (block.toolName === "Write") {
    return i18n.t("activity.running.write", { suffix });
  }
  if (block.toolName === "Edit" || block.toolName === "MultiEdit" || block.fileChange) {
    return i18n.t("activity.running.edit", { suffix });
  }
  if (block.toolName === "Read" || block.toolName === "NotebookRead" || block.readTarget) {
    return i18n.t("activity.running.read", { suffix });
  }
  if (block.toolName === "Glob" || block.toolName === "Grep" || block.grepTarget || block.icon === "search") {
    return i18n.t("activity.running.search", { suffix });
  }
  if (
    block.toolName === "WebSearch" ||
    block.toolName === "WebFetch" ||
    block.webSearch ||
    block.icon === "network"
  ) {
    return i18n.t("activity.running.webSearch", { suffix });
  }
  if (block.toolName === "Bash" || block.bashRun || block.icon === "terminal") {
    return i18n.t("activity.running.command", { suffix });
  }
  if (block.toolName === "Agent" || block.toolName === "Task" || block.icon === "agent") {
    return i18n.t("activity.running.agent", { suffix });
  }
  return i18n.t("activity.running.tool", {
    suffix: suffix || ` ${block.toolName ?? i18n.t("activity.toolFallback")}`,
  });
}

function summarizeCompletedActionBlock(block: Extract<ActivityDetailBlock, { kind: "action" }>): string {
  const target = clampActivityPreviewLine(block.bashRun?.command ?? actionBlockTargetKey(block), 64);
  const suffix = target ? ` ${target}` : "";

  if (block.toolName === "TaskCreate") {
    return i18n.t("activity.completed.createTask", { suffix });
  }
  if (block.toolName === "TaskUpdate" || block.toolName === "TodoWrite") {
    return i18n.t("activity.completed.updateTask", { suffix });
  }
  if (block.toolName === "Write") {
    return i18n.t("activity.completed.write", { suffix });
  }
  if (block.toolName === "Edit" || block.toolName === "MultiEdit" || block.fileChange) {
    return i18n.t("activity.completed.edit", { suffix });
  }
  if (block.toolName === "Read" || block.toolName === "NotebookRead" || block.readTarget) {
    return i18n.t("activity.completed.read", { suffix });
  }
  if (
    block.toolName === "WebSearch" ||
    block.toolName === "WebFetch" ||
    block.webSearch ||
    block.icon === "network"
  ) {
    return i18n.t("activity.completed.webSearch", { suffix });
  }
  if (block.toolName === "Glob" || block.toolName === "Grep" || block.grepTarget || block.icon === "search") {
    return i18n.t("activity.completed.search", { suffix });
  }
  if (block.toolName === "Bash" || block.bashRun || block.icon === "terminal") {
    return i18n.t("activity.completed.command", { suffix });
  }
  if (block.toolName === "Agent" || block.toolName === "Task" || block.icon === "agent") {
    return i18n.t("activity.completed.agent", { suffix });
  }
  return i18n.t("activity.completed.tool", {
    suffix: suffix || ` ${block.toolName ?? i18n.t("activity.toolFallback")}`,
  });
}

function formatToolGroupChildDetail(block: Extract<ActivityDetailBlock, { kind: "action" }>): string {
  const target = clampActivityPreviewLine(block.bashRun?.command ?? actionBlockTargetKey(block), 64);
  if (block.toolName === "Bash" || block.bashRun || block.icon === "terminal") {
    return target || i18n.t("activity.completed.command");
  }

  const suffix = target ? ` ${target}` : "";
  if (block.toolName === "TaskCreate") {
    return i18n.t("activity.detail.createTask", { suffix });
  }
  if (block.toolName === "TaskUpdate" || block.toolName === "TodoWrite") {
    return i18n.t("activity.detail.updateTask", { suffix });
  }
  if (block.toolName === "Write") {
    return i18n.t("activity.detail.write", { suffix });
  }
  if (block.toolName === "Edit" || block.toolName === "MultiEdit" || block.fileChange) {
    return i18n.t("activity.detail.edit", { suffix });
  }
  if (block.toolName === "Read" || block.toolName === "NotebookRead" || block.readTarget) {
    return i18n.t("activity.detail.read", { suffix });
  }
  if (
    block.toolName === "WebSearch" ||
    block.toolName === "WebFetch" ||
    block.webSearch ||
    block.icon === "network"
  ) {
    return i18n.t("activity.detail.webSearch", { suffix });
  }
  if (block.toolName === "Glob" || block.toolName === "Grep" || block.grepTarget || block.icon === "search") {
    return i18n.t("activity.detail.search", { suffix });
  }
  if (block.toolName === "Agent" || block.toolName === "Task" || block.icon === "agent") {
    return i18n.t("activity.detail.agent", { suffix });
  }
  return i18n.t("activity.detail.tool", {
    suffix: suffix || ` ${block.toolName ?? i18n.t("activity.toolFallback")}`,
  });
}

function summarizeFailedTool(tool: string, command?: string): string {
  const target = clampActivityPreviewLine(command || tool, 64);
  return i18n.t("activity.completed.command", {
    suffix: target ? ` ${target}` : "",
  });
}

function actionBlockTargetKey(block: Extract<ActivityDetailBlock, { kind: "action" }>): string {
  const fallbackLabel = block.label.replace(/\s+\(\d+(?:\.\d+)?s\)\s*$/u, "").trim();
  return (
    block.webSearch?.query ||
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
    return i18n.t("activity.joinTwo", {
      first: clauses[0],
      second: clauses[1],
    });
  }
  return i18n.t("activity.joinMany", {
    head: clauses.slice(0, -1).join(i18n.language === "zh-CN" ? "、" : ", "),
    last: clauses.at(-1) ?? "",
  });
}

function resolveActionBlocksLifecycle(
  blocks: readonly ToolGroupDetailBlock[],
): ToolActionLifecycle | undefined {
  const lifecycles = blocks
    .filter((block): block is Extract<ActivityDetailBlock, { kind: "action" }> => block.kind === "action")
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

type SubagentDetailFeedEntry = ThreadRunProjectionTimelineFeedEntry;
type SubagentDetailDisplayEntry = SubagentDetailFeedEntry | ThreadRunProjectionToolGroupFeedEntry;

interface SubagentDetailTurn {
  key: string;
  prompt?: SubagentDetailFeedEntry;
  entries: SubagentDetailDisplayEntry[];
  finalResult?: SubagentDetailFeedEntry;
  running: boolean;
  startedAt: string;
  endedAt?: string;
  projectedDurationMs?: number;
}

function groupSubagentDetailFeedEntries(
  entries: readonly SubagentDetailFeedEntry[],
): SubagentDetailDisplayEntry[] {
  const grouped: SubagentDetailDisplayEntry[] = [];
  let pending: SubagentDetailFeedEntry[] = [];

  const flush = () => {
    const first = pending[0];
    if (first) {
      grouped.push({
        kind: "tool-group",
        key: `subagent-tool-group:${first.key}`,
        entries: pending,
        at: first.at,
        sequence: first.sequence,
      });
    }
    pending = [];
  };

  for (const entry of entries) {
    const block = projectionItemToDetailBlock(entry.item);
    if (block?.kind === "action" || block?.kind === "tool-failed") {
      pending.push(entry);
      continue;
    }
    flush();
    grouped.push(entry);
  }
  flush();
  return grouped;
}

function buildSubagentDetailTurns(
  entries: readonly SubagentDetailFeedEntry[],
  agent: ThreadRunProjectionAgent,
): SubagentDetailTurn[] {
  const running = agent.status === "active" || agent.status === "launching";
  const rawTurns: Array<{
    key: string;
    prompt?: SubagentDetailFeedEntry;
    entries: SubagentDetailFeedEntry[];
    startedAt: string;
  }> = [];
  let current: (typeof rawTurns)[number] | undefined;

  for (const entry of entries) {
    if (isProjectionSubagentPromptItem(entry.item)) {
      current = {
        key: `subagent-turn:${entry.item.requestId ?? entry.item.id}`,
        prompt: entry,
        entries: [],
        startedAt: entry.at,
      };
      rawTurns.push(current);
      continue;
    }
    if (!current) {
      current = {
        key: `subagent-turn:initial:${entry.item.requestId ?? entry.item.id}`,
        entries: [],
        startedAt: entry.at,
      };
      rawTurns.push(current);
    }
    current.entries.push(entry);
  }

  return rawTurns.map((turn, index) => {
    const turnRunning = running && index === rawTurns.length - 1;
    const finalResult = turnRunning ? undefined : resolveSubagentTurnFinalResult(turn.entries);
    const processEntries = (
      finalResult ? turn.entries.filter((entry) => entry.item.id !== finalResult.item.id) : turn.entries
    ).filter((entry) => !isDuplicateSubagentTurnResultPhase(entry, finalResult));
    const nextTurn = rawTurns[index + 1];
    const startedAt = index === 0 ? agent.startedAt : turn.startedAt;
    const endedAt = turnRunning
      ? undefined
      : (nextTurn?.startedAt ?? agent.endedAt ?? turn.entries.at(-1)?.at);
    return {
      key: turn.key,
      ...(turn.prompt && { prompt: turn.prompt }),
      entries: groupSubagentDetailFeedEntries(processEntries),
      ...(finalResult && { finalResult }),
      running: turnRunning,
      startedAt,
      ...(endedAt && { endedAt }),
      ...(rawTurns.length === 1 && { projectedDurationMs: agent.durationMs }),
    };
  });
}

function resolveSubagentTurnFinalResult(
  entries: readonly SubagentDetailFeedEntry[],
): SubagentDetailFeedEntry | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.item.eventType !== "message.final") {
      continue;
    }
    const block = projectionItemToDetailBlock(entry.item);
    if (block?.kind === "narrative" && !block.streaming && block.text.trim()) {
      return entry;
    }
  }
  return undefined;
}

function isDuplicateSubagentTurnResultPhase(
  entry: SubagentDetailFeedEntry,
  finalResult: SubagentDetailFeedEntry | undefined,
): boolean {
  if (!finalResult) {
    return false;
  }
  const block = projectionItemToDetailBlock(entry.item);
  return (
    block?.kind === "phase" &&
    entry.item.text.trim().replace(/\s+/gu, " ") === finalResult.item.text.trim().replace(/\s+/gu, " ")
  );
}

function projectionRequestSpanRenderSignature(span?: ProjectionRequestSpan): string {
  if (!span) {
    return "";
  }
  return [
    span.requestId,
    span.ownerAgentId ?? "",
    span.status,
    span.startedAt,
    span.firstTokenAt ?? "",
    span.endedAt ?? "",
    span.error ?? "",
  ].join(":");
}

function projectionTimelineItemRenderSignature(item: ThreadRunProjectionTimelineItem): string {
  return (
    JSON.stringify([
      item.id,
      item.sequence,
      item.eventType,
      item.scope,
      item.role ?? "",
      item.agentId ?? "",
      item.requestId ?? "",
      item.streamKey ?? "",
      item.at,
      item.text,
      item.metadata ?? null,
    ]) ?? ""
  );
}

function projectionSubagentDetailEntrySignature(entry: SubagentDetailFeedEntry): string {
  return [
    "timeline",
    entry.key,
    entry.at,
    entry.sequence,
    projectionTimelineItemRenderSignature(entry.item),
  ].join(":");
}

function projectionSubagentDetailEntryRequestSpanSignature(
  entry: SubagentDetailFeedEntry,
  requestSpansById: ProjectionRequestSpansById,
): string {
  return projectionSubagentDetailTimelineRequestSpanSignature([entry.item], requestSpansById);
}

function projectionSubagentDetailTimelineRequestSpanSignature(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  requestSpansById: ProjectionRequestSpansById,
): string {
  const requestIds = new Set<string>();
  const addItemRequestId = (item: ThreadRunProjectionTimelineItem) => {
    const requestId = item.requestId?.trim();
    if (requestId) {
      requestIds.add(requestId);
    }
  };

  for (const item of timeline) {
    addItemRequestId(item);
  }

  return [...requestIds]
    .sort()
    .map(
      (requestId) => `${requestId}:${projectionRequestSpanRenderSignature(requestSpansById.get(requestId))}`,
    )
    .join("|");
}

function useStableSubagentDetailFeedEntries(
  agentId: string,
  timeline: readonly ThreadRunProjectionTimelineItem[],
): SubagentDetailFeedEntry[] {
  const cacheRef = useRef(new Map<string, { signature: string; entry: SubagentDetailFeedEntry }>());
  const agentIdRef = useRef(agentId);
  return useMemo(() => {
    if (agentIdRef.current !== agentId) {
      agentIdRef.current = agentId;
      cacheRef.current.clear();
    }
    const activeKeys = new Set<string>();
    const entries = timeline.map((item) => {
      const key = `subagent-timeline:${agentId}:${item.id}`;
      activeKeys.add(key);
      const signature = projectionTimelineItemRenderSignature(item);
      const cached = cacheRef.current.get(key);
      if (cached?.signature === signature) {
        return cached.entry;
      }
      const entry: SubagentDetailFeedEntry = {
        kind: "timeline",
        key,
        item,
        at: item.at,
        sequence: item.sequence,
      };
      cacheRef.current.set(key, { signature, entry });
      return entry;
    });
    for (const key of cacheRef.current.keys()) {
      if (!activeKeys.has(key)) {
        cacheRef.current.delete(key);
      }
    }
    return entries;
  }, [agentId, timeline]);
}

function areProjectionSubagentDetailFeedEntryPropsEqual(
  prev: {
    entry: SubagentDetailFeedEntry;
    requestSpansById: ProjectionRequestSpansById;
  },
  next: {
    entry: SubagentDetailFeedEntry;
    requestSpansById: ProjectionRequestSpansById;
  },
): boolean {
  return (
    projectionSubagentDetailEntrySignature(prev.entry) ===
      projectionSubagentDetailEntrySignature(next.entry) &&
    projectionSubagentDetailEntryRequestSpanSignature(prev.entry, prev.requestSpansById) ===
      projectionSubagentDetailEntryRequestSpanSignature(next.entry, next.requestSpansById)
  );
}

const ProjectionSubagentDetailFeedEntry = memo(function ProjectionSubagentDetailFeedEntry({
  entry,
  requestSpansById,
}: {
  entry: SubagentDetailFeedEntry;
  requestSpansById: ProjectionRequestSpansById;
}) {
  return <ProjectionTimelineEntry item={entry.item} requestSpansById={requestSpansById} compact />;
}, areProjectionSubagentDetailFeedEntryPropsEqual);

function ProjectionSubagentTurn({
  turn,
  requestSpansById,
}: {
  turn: SubagentDetailTurn;
  requestSpansById: ProjectionRequestSpansById;
}) {
  return (
    <RunLogTurnSection
      turnKey={turn.key}
      running={turn.running}
      startedAt={turn.startedAt}
      {...(turn.endedAt && { endedAt: turn.endedAt })}
      {...(turn.projectedDurationMs !== undefined && {
        projectedDurationMs: turn.projectedDurationMs,
      })}
      className="subagent-conversation-turn"
      processEmpty={turn.entries.length === 0}
      {...(turn.prompt && {
        leading: (
          <ProjectionSubagentDetailFeedEntry entry={turn.prompt} requestSpansById={requestSpansById} />
        ),
      })}
      process={
        <>
          {turn.entries.map((entry) =>
            entry.kind === "tool-group" ? (
              <ProjectionToolGroupEntry key={entry.key} entry={entry} requestSpansById={requestSpansById} />
            ) : (
              <ProjectionSubagentDetailFeedEntry
                key={entry.key}
                entry={entry}
                requestSpansById={requestSpansById}
              />
            ),
          )}
          {turn.running && turn.entries.length === 0 ? <WaitingThinkingBlock active /> : null}
        </>
      }
      {...(turn.finalResult && {
        final: (
          <ProjectionSubagentDetailFeedEntry entry={turn.finalResult} requestSpansById={requestSpansById} />
        ),
      })}
    />
  );
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
      <ProjectionAgentEchoShell label={entry.agentLabel} agentId={entry.agent.agentId}>
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
      <ProjectionAgentEchoShell label={entry.agentLabel} agentId={entry.agent.agentId}>
        <ThinkingBlock
          text={block.text}
          {...(block.streaming !== undefined && { streaming: block.streaming })}
          {...(block.startedAt && { startedAt: block.startedAt })}
          {...(block.endedAt && { endedAt: block.endedAt })}
          {...(block.durationMs !== undefined && { durationMs: block.durationMs })}
        />
      </ProjectionAgentEchoShell>
    );
  }
  if (block.kind === "reasoning-stage") {
    return (
      <ProjectionAgentEchoShell label={entry.agentLabel} agentId={entry.agent.agentId}>
        <WaitingThinkingBlock active label={block.label} />
      </ProjectionAgentEchoShell>
    );
  }
  return (
    <ProjectionAgentEchoShell label={entry.agentLabel} agentId={entry.agent.agentId}>
      <DetailBlock
        block={block}
        requestActive={requestActive}
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
  children,
}: {
  label: string;
  agentId: string;
  children: ReactNode;
}) {
  return (
    <div className="run-log-agent-echo" data-agent-id={agentId}>
      <span className="run-log-subagent-badge run-log-agent-echo-badge" title={label}>
        {label}
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
  const liveDurationMs = useSubagentDurationMs(agent, running);

  const roleLabel =
    resolveRuntimeAgentName(agent.role, agentDisplayNames) ?? resolveSubagentRunDisplayTitle(agent.role);
  const titleLabel = resolveSubagentActivityTitle(roleLabel, agent.taskName);
  const rawStatus = resolveProjectionAgentStatusText(agent);
  const statusText =
    rawStatus && rawStatus !== roleLabel && rawStatus !== titleLabel
      ? rawStatus
      : agent.status === "active" || agent.status === "launching"
        ? i18n.t("activity.working")
        : i18n.t("activity.viewDetails");
  const elapsedMs = running ? liveDurationMs : agent.durationMs;
  const elapsedLabel = formatDuration(elapsedMs);
  const durationLabel = elapsedLabel
    ? running
      ? elapsedLabel
      : i18n.t("activity.duration", { duration: elapsedLabel })
    : undefined;
  const missionText = useLatchedAgentText(agent.agentId, incomingMissionText);
  return (
    <div
      className={`subagent-run-row-wrap has-agent-id${running ? " is-running" : ""}${selected ? " is-expanded" : ""}`}
      data-agent-id={agent.agentId}
      data-role={normalizeAgentDisplayRole(agent.role) ?? agent.role}
      style={resolveSubagentRowThemeStyle(agent.role, agentThemes)}
    >
      <SubagentRunCardButton
        roleLabel={titleLabel}
        running={running}
        statusText={statusText}
        {...(missionText && { missionText })}
        {...(durationLabel && { durationLabel })}
        selected={selected}
        onOpen={onOpen}
      />
    </div>
  );
}

interface ProjectionSubagentDetailFeedProps {
  agent: ThreadRunProjectionAgent;
  missionText: string;
  images?: readonly PromptImagePreview[];
  requestSpansById: ProjectionRequestSpansById;
  threadActive: boolean;
}

function projectionSubagentDetailAgentSignature(agent: ThreadRunProjectionAgent): string {
  const usage = agent.usage;
  return [
    agent.agentId,
    agent.status,
    agent.endedAt ?? "",
    agent.mission ?? "",
    agent.delegationPrompt ?? "",
    agent.delegationSummary ?? "",
    agent.timeline.map(projectionTimelineItemRenderSignature).join("|"),
    usage
      ? [
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheReadTokens,
          usage.cacheCreationTokens,
          usage.ecoCostUsd,
          usage.modelId ?? "",
        ].join("/")
      : "",
    agent.context?.occupancyPct ?? "",
  ].join(":");
}

function areProjectionSubagentDetailFeedPropsEqual(
  prev: ProjectionSubagentDetailFeedProps,
  next: ProjectionSubagentDetailFeedProps,
): boolean {
  return (
    prev.missionText === next.missionText &&
    promptImagePreviewSignature(prev.images) === promptImagePreviewSignature(next.images) &&
    projectionSubagentDetailTimelineRequestSpanSignature(prev.agent.timeline, prev.requestSpansById) ===
      projectionSubagentDetailTimelineRequestSpanSignature(next.agent.timeline, next.requestSpansById) &&
    projectionSubagentDetailAgentSignature(prev.agent) === projectionSubagentDetailAgentSignature(next.agent)
  );
}

export const ProjectionSubagentDetailFeed = memo(function ProjectionSubagentDetailFeed({
  agent,
  missionText,
  images,
  requestSpansById,
  threadActive,
}: ProjectionSubagentDetailFeedProps) {
  void threadActive;
  const feedRef = useRef<HTMLDivElement>(null);
  const userDetachedFromBottomRef = useRef(false);
  const scrollTopRef = useRef(0);
  const programmaticScrollRef = useRef(false);
  const delegation = readProjectionAgentDelegation(agent);
  const missionDisplay = resolveMissionDisplayText(
    missionText || delegation?.prompt || delegation?.summary || "",
  );
  const running = agent.status === "active" || agent.status === "launching";
  const visibleTimeline = useMemo(() => {
    const filtered = collapseEphemeralReasoningSummaryTimeline(
      collapseProjectionTimelineStreamsForDetail(
        collapseProjectionToolLifecycleItemsForDetail(filterSubagentDetailTimelineNoise(agent.timeline)),
      ).filter((item) => !shouldSuppressSubagentCardTimelineItem(item, missionDisplay)),
    );
    return collapseConsecutiveThinkingTimelineItems(filtered);
  }, [agent.timeline, missionDisplay]);
  const detailFeedEntries = useStableSubagentDetailFeedEntries(agent.agentId, visibleTimeline);
  const turns = useMemo(() => buildSubagentDetailTurns(detailFeedEntries, agent), [agent, detailFeedEntries]);
  const latestTimelineItem = visibleTimeline.at(-1);
  const layoutSignature = [
    agent.agentId,
    agent.status,
    missionDisplay.length,
    turns.length,
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
    const content = feed?.querySelector(".subagent-conversation-log-content");
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

  return (
    <div className="subagent-task-detail-feed subagent-conversation">
      <div ref={feedRef} className="subagent-conversation-log">
        <div className="subagent-conversation-log-content">
          {missionDisplay ? (
            <UserPromptBlock
              text={missionDisplay}
              className="subagent-conversation-prompt"
              {...(images && { images })}
            />
          ) : null}
          {turns.length > 0 ? (
            turns.map((turn) => (
              <ProjectionSubagentTurn key={turn.key} turn={turn} requestSpansById={requestSpansById} />
            ))
          ) : running ? (
            <WaitingThinkingBlock active />
          ) : (
            <p className="subagent-task-detail-empty">{i18n.t("activity.noDetails")}</p>
          )}
          {running ? <RunLogConversationTail /> : null}
        </div>
      </div>
      <ProjectionSubagentRunInstanceStrip agent={agent} />
    </div>
  );
}, areProjectionSubagentDetailFeedPropsEqual);

function promptImagePreviewSignature(images: readonly PromptImagePreview[] | undefined): string {
  return images?.map((image) => `${image.id}:${image.mediaType}:${image.data}`).join("|") ?? "";
}

function ProjectionSubagentRunInstanceStrip({ agent }: { agent: ThreadRunProjectionAgent }) {
  const usage = agent.usage;
  const context = agent.context;
  const contextLabel = context && context.limit > 0 ? `${context.occupancyPct}%` : undefined;
  const contextProgressWidth =
    context && context.limit > 0 ? `${Math.min(100, Math.max(0, context.occupancyPct))}%` : "0%";
  const contextDetail =
    context && context.limit > 0
      ? `${formatTokenCount(context.occupied)} / ${formatTokenCount(context.limit)}`
      : undefined;
  const modelId = agent.usage?.modelId ?? agent.context?.modelId;
  const modelLabel = modelId ? shortenModelId(modelId) : undefined;
  const costLabel = usage ? formatCostUsd(usage.ecoCostUsd) : undefined;

  if (!usage && !contextLabel && !modelLabel) {
    return null;
  }

  return (
    <section className="subagent-run-instance-strip" aria-label={i18n.t("activity.metrics")}>
      {usage ? (
        <>
          <div
            className="subagent-run-instance-metric subagent-run-instance-metric--io"
            title={i18n.t("activity.ioTitle", {
              input: formatTokenCount(usage.inputTokens),
              output: formatTokenCount(usage.outputTokens),
            })}
          >
            <span className="subagent-run-instance-heading">
              <ArrowDownToLine size={13} aria-hidden />
              <span className="subagent-run-instance-label">{i18n.t("activity.inputOutput")}</span>
            </span>
            <span className="subagent-run-instance-split-values">
              <span>
                <small>IN</small>
                {formatTokenCount(usage.inputTokens)}
              </span>
              <span>
                <small>OUT</small>
                {formatTokenCount(usage.outputTokens)}
              </span>
            </span>
          </div>
          <div
            className="subagent-run-instance-metric subagent-run-instance-metric--cache"
            title={i18n.t("activity.cacheTitle", {
              read: formatTokenCount(usage.cacheReadTokens),
              write: formatTokenCount(usage.cacheCreationTokens),
            })}
          >
            <span className="subagent-run-instance-heading">
              <Database size={13} aria-hidden />
              <span className="subagent-run-instance-label">{i18n.t("activity.cache")}</span>
            </span>
            <span className="subagent-run-instance-split-values">
              <span>
                <small>READ</small>
                {formatTokenCount(usage.cacheReadTokens)}
              </span>
              <span>
                <small>WRITE</small>
                {formatTokenCount(usage.cacheCreationTokens)}
              </span>
            </span>
          </div>
        </>
      ) : null}
      {contextLabel ? (
        <div
          className="subagent-run-instance-metric subagent-run-instance-metric--context"
          title={i18n.t("activity.contextTitle", {
            label: contextLabel,
            detail: contextDetail ? ` (${contextDetail})` : "",
          })}
        >
          <span className="subagent-run-instance-heading">
            <Gauge size={13} aria-hidden />
            <span className="subagent-run-instance-label">{i18n.t("activity.context")}</span>
          </span>
          <span className="subagent-run-instance-context-value">
            <strong>{contextLabel}</strong>
            <small>{contextDetail}</small>
          </span>
          <span className="subagent-run-instance-progress-track" aria-hidden="true">
            <span className="subagent-run-instance-progress-fill" style={{ width: contextProgressWidth }} />
          </span>
        </div>
      ) : null}
      {costLabel || modelLabel ? (
        <div
          className="subagent-run-instance-metric subagent-run-instance-metric--billing-model"
          title={[
            costLabel ? i18n.t("activity.billingTitle", { cost: costLabel }) : "",
            modelId ? i18n.t("activity.modelTitle", { model: modelId }) : "",
          ]
            .filter(Boolean)
            .join(" / ")}
        >
          <span className="subagent-run-instance-heading">
            <CircleDollarSign size={13} aria-hidden />
            <span className="subagent-run-instance-label">{i18n.t("activity.billingModel")}</span>
          </span>
          <span className="subagent-run-instance-billing-model-values">
            <strong>{costLabel ?? "-"}</strong>
            <small>{modelLabel ?? "-"}</small>
          </span>
        </div>
      ) : null}
    </section>
  );
}

function ProjectionTimelineEntry({
  item,
  requestSpansById,
  onRestorePrompt,
  onLoadUserMessageEdit,
  onRewriteUserMessage,
  historyRevision,
  compact = false,
  deferWaitingIndicator = false,
  forceActionDetailsExpanded = false,
  actionLabelOverride,
  showMessageMeta = false,
  stickyMessageMeta = false,
  onOpenImageGenerationTool,
}: {
  item: ThreadRunProjectionTimelineItem;
  requestSpansById: Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
  onRestorePrompt?: RestorePromptHandler;
  onLoadUserMessageEdit?: LoadUserMessageEditHandler;
  onRewriteUserMessage?: RewriteUserMessageHandler;
  historyRevision?: number;
  compact?: boolean;
  deferWaitingIndicator?: boolean;
  forceActionDetailsExpanded?: boolean;
  actionLabelOverride?: string;
  showMessageMeta?: boolean;
  stickyMessageMeta?: boolean;
  onOpenImageGenerationTool?: OpenImageGenerationToolHandler;
}) {
  if (deferWaitingIndicator && isWaitingThinkingItem(item, requestSpansById)) {
    return null;
  }
  if (isProjectionUserPromptItem(item)) {
    if (compact) {
      return null;
    }
    const rewindTarget = readProjectionRewindTarget(item);
    return wrapRunLogFeedEntry(
      <UserPromptBlock
        text={item.text}
        images={readPromptImagePreviews(item.metadata)}
        anchorId={item.id}
        createdAt={item.at}
        {...(rewindTarget && { rewindTarget })}
        {...(onRestorePrompt && { onRestorePrompt })}
        {...(onLoadUserMessageEdit && { onLoadUserMessageEdit })}
        {...(onRewriteUserMessage && { onRewriteUserMessage })}
        historyRevision={historyRevision ?? 0}
      />,
    );
  }

  const block = projectionItemToDetailBlock(item);
  if (!block) {
    return null;
  }

  const requestSpan = item.requestId ? requestSpansById.get(item.requestId) : undefined;
  const requestActive = isProjectionRequestActive(requestSpan);
  const imageToolUseId = readImageGenerationToolUseId(item);

  if (block.kind === "subagent-prompt") {
    return wrapRunLogFeedEntry(
      <UserPromptBlock text={block.text} className="subagent-conversation-prompt" createdAt={item.at} />,
      { compact },
    );
  }
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
        {...(block.startedAt && { startedAt: block.startedAt })}
        {...(block.endedAt && { endedAt: block.endedAt })}
        {...(block.durationMs !== undefined && { durationMs: block.durationMs })}
      />,
      { compact, tight: true },
    );
  }
  if (block.kind === "reasoning-stage") {
    return wrapRunLogFeedEntry(<WaitingThinkingBlock active label={block.label} />, {
      compact,
      tight: true,
    });
  }
  if (block.kind === "unknown-item") {
    return wrapRunLogFeedEntry(
      <UnknownItemBlock
        itemType={block.itemType}
        {...(block.phase && { phase: block.phase })}
        {...(block.payload && { payload: block.payload })}
        {...(block.streaming !== undefined && { streaming: block.streaming })}
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
      hideSubagentIdentity={compact}
      forceActionDetailsExpanded={forceActionDetailsExpanded}
      {...(actionLabelOverride && { actionLabelOverride })}
      {...(requestSpan && { requestSpan })}
      {...(imageToolUseId &&
        onOpenImageGenerationTool && {
          onActionActivate: () => onOpenImageGenerationTool(imageToolUseId),
        })}
    />,
    { compact, tight: isTightFeedDetailBlock(block) },
  );
}

function shouldSuppressSubagentCardTimelineItem(
  item: ThreadRunProjectionTimelineItem,
  missionText: string,
): boolean {
  if (
    item.eventType === "agent.started" ||
    item.eventType === "agent.stopped" ||
    item.eventType === "agent.abandoned"
  ) {
    return true;
  }
  if (isSubagentMissionEnvelope(item.text)) {
    return true;
  }
  if (!missionText) {
    return false;
  }
  const block = projectionItemToDetailBlock(item);
  if (block?.kind === "subagent-mission") {
    return true;
  }
  return (
    block?.kind === "subagent-prompt" &&
    resolveMissionDisplayText(block.text) === resolveMissionDisplayText(missionText)
  );
}

function filterSubagentDetailTimelineNoise(
  timeline: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem[] {
  const filtered = timeline.filter(
    (item) => !(item.eventType === "thinking.final" && item.text.trim().length === 0),
  );
  const ordered: ThreadRunProjectionTimelineItem[] = [];
  for (let index = 0; index < filtered.length; index += 1) {
    const item = filtered[index];
    const next = filtered[index + 1];
    if (
      item?.eventType === "request.started" &&
      item.requestId &&
      next?.requestId === item.requestId &&
      isProjectionSubagentPromptItem(next)
    ) {
      ordered.push(next, item);
      index += 1;
      continue;
    }
    if (item) {
      ordered.push(item);
    }
  }
  return ordered;
}

function SubagentRunCardButton({
  roleLabel,
  running,
  statusText,
  missionText,
  durationLabel,
  selected,
  onOpen,
}: {
  roleLabel: string;
  running: boolean;
  statusText: string;
  missionText?: string;
  durationLabel?: string;
  selected: boolean;
  onOpen: () => void;
}) {
  const resolvedMissionText = missionText ? resolveMissionDisplayText(missionText) : "";

  return (
    <button
      type="button"
      className={`subagent-run-row run-log-feed-surface${running ? " is-running" : ""}${selected ? " is-expanded" : ""}`}
      onClick={onOpen}
      aria-pressed={selected}
    >
      <div className="subagent-run-main">
        <div className="subagent-run-title-row">
          <span className="subagent-run-title-group">
            <Bot size={14} className="subagent-run-icon" aria-hidden />
            <span className="subagent-run-title">
              {running ? (
                <ShimmerText>{roleLabel}</ShimmerText>
              ) : (
                <span className="subagent-run-title-role">{roleLabel}</span>
              )}
            </span>
            {durationLabel ? <span className="subagent-run-duration">{durationLabel}</span> : null}
          </span>
        </div>
        {resolvedMissionText ? (
          <ExpandableMissionText
            text={resolvedMissionText}
            expanded={false}
            className="subagent-run-mission-preview"
          />
        ) : (
          <p className="subagent-run-mission-preview subagent-run-mission-placeholder" title={statusText}>
            {statusText || i18n.t("activity.waitingMission")}
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

function DetailBlock({
  block,
  modelByRole,
  usageByRole,
  hideSubagentIdentity,
  forceActionDetailsExpanded = false,
  actionLabelOverride,
  requestActive = false,
  requestSpan,
  agentThemes,
  createdAt,
  onActionActivate,
}: {
  block: ActivityDetailBlock;
  modelByRole?: Record<string, string>;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
  hideSubagentIdentity?: boolean;
  forceActionDetailsExpanded?: boolean;
  actionLabelOverride?: string;
  requestActive?: boolean;
  requestSpan?: ThreadRunProjectionRequestSpan;
  agentThemes?: RuntimeAgentThemes;
  createdAt?: string;
  onActionActivate?: () => void;
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
  if (block.kind === "subagent-prompt") {
    return <UserPromptBlock text={block.text} className="subagent-conversation-prompt" />;
  }
  if (block.kind === "model-request") {
    return <WaitingThinkingBlock active={requestActive} {...(requestSpan && { requestSpan })} />;
  }
  if (block.kind === "agent-request") {
    return <WaitingThinkingBlock active={requestActive} {...(requestSpan && { requestSpan })} />;
  }
  if (block.kind === "action") {
    if (block.imageView) {
      return (
        <ImageViewBlock
          imageView={block.imageView}
          {...(block.lifecycle && { lifecycle: block.lifecycle })}
          {...(block.subagent && { subagent: block.subagent })}
          omitRoleLabel={omitSubagent}
          {...(!omitSubagent && modelByRole && { modelByRole })}
        />
      );
    }
    return (
      <RunLogAction
        icon={block.icon}
        label={block.label}
        {...(actionLabelOverride && { displayLabelOverride: actionLabelOverride })}
        {...(block.bashRun && { bashRun: block.bashRun })}
        {...(block.fileChange && { fileChange: block.fileChange })}
        {...(block.webSearch && { webSearch: block.webSearch })}
        {...(block.readTarget && { readTarget: block.readTarget })}
        {...(block.grepTarget && { grepTarget: block.grepTarget })}
        {...(block.lifecycle && { lifecycle: block.lifecycle })}
        {...(block.subagent && { subagent: block.subagent })}
        omitRoleLabel={omitSubagent}
        forceDetailsExpanded={forceActionDetailsExpanded}
        {...(onActionActivate && { onActivate: onActionActivate })}
        {...(!omitSubagent && modelByRole && { modelByRole })}
      />
    );
  }
  if (block.kind === "tool-failed") {
    return (
      <ToolFailedBlock
        tool={block.tool}
        {...(block.command && { command: block.command })}
        {...(block.error && { error: block.error })}
        {...(block.recoveredResult && { recoveredResult: block.recoveredResult })}
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
        {...(block.title && { title: block.title })}
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
        {...(block.startedAt && { startedAt: block.startedAt })}
        {...(block.endedAt && { endedAt: block.endedAt })}
        {...(block.durationMs !== undefined && { durationMs: block.durationMs })}
      />
    );
  }
  if (block.kind === "reasoning-stage") {
    return <WaitingThinkingBlock active label={block.label} />;
  }
  if (block.kind === "unknown-item") {
    return (
      <UnknownItemBlock
        itemType={block.itemType}
        {...(block.phase && { phase: block.phase })}
        {...(block.payload && { payload: block.payload })}
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
    return (
      <div className="run-log-context-action" role="status" aria-live="polite">
        <RunLogAction icon="context" label={label} lifecycle={contextCompactionLifecycle(label)} />
      </div>
    );
  }
  if (isPromptCacheNoticePhaseLabel(label)) {
    return <PromptCacheNoticeDivider label={label} />;
  }
  if (reconnecting) {
    const isFailure = Boolean(reconnectFailed);
    const className = `run-log-reconnect${isFailure ? " run-log-reconnect--failed" : ""}`;
    const ReconnectIcon = isFailure ? CircleAlert : RefreshCw;
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
    /^正在压缩上下文$/u.test(label) ||
    /^上下文已压缩$/u.test(label) ||
    /^正在(?:自动|手动)压缩上下文$/u.test(label) ||
    /^上下文已(?:自动|手动)压缩$/u.test(label) ||
    /^上下文压缩失败/u.test(label)
  );
}

function contextCompactionLifecycle(label: string): ToolActionLifecycle {
  if (/^上下文压缩失败/u.test(label)) {
    return "failed";
  }
  if (/^正在(?:压缩|自动压缩|手动压缩)上下文$/u.test(label)) {
    return "running";
  }
  return "completed";
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
          <span>{i18n.t("activity.promptCacheTimeline")}</span>
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
  return date.toLocaleTimeString(i18n.resolvedLanguage, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ShimmerText({ children }: { children: string }) {
  return (
    <span className="run-log-shimmer-text" aria-live="polite">
      {children}
    </span>
  );
}

/** Empty/live thinking status — same shell for "正在思考" and ephemeral reasoning summary. */
function WaitingThinkingBlock({
  active,
  label,
}: {
  active?: boolean;
  /** Defaults to i18n "正在思考". Used by OpenAI reasoning summary stage lines. */
  label?: string;
  requestSpan?: ThreadRunProjectionRequestSpan;
}) {
  if (!active) {
    return null;
  }

  const displayLabel = label?.trim() || i18n.t("activity.thinking");

  return (
    <div className="run-log-thinking streaming empty" role="status" aria-live="polite">
      <div className="run-log-thinking-header">
        <span className="run-log-thinking-label">
          <ShimmerText>{displayLabel}</ShimmerText>
        </span>
      </div>
    </div>
  );
}

function isWaitingThinkingItem(
  item: ThreadRunProjectionTimelineItem,
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionRequestSpan>,
): boolean {
  const block = projectionItemToDetailBlock(item);
  if (!block) {
    return false;
  }
  if (block.kind === "model-request" || block.kind === "agent-request") {
    const requestSpan = item.requestId ? requestSpansById.get(item.requestId) : undefined;
    return isProjectionRequestActive(requestSpan);
  }
  return (
    (block.kind === "thinking" || block.kind === "narrative") &&
    Boolean(block.streaming) &&
    !block.text.trim()
  );
}

function RunLogConversationTail() {
  return (
    <div
      className="run-log-conversation-tail"
      role="status"
      aria-label={i18n.t("activity.conversationActive")}
    >
      <StreamingTypingIndicator />
    </div>
  );
}

function RunLogActiveTail({ waiting }: { waiting: boolean }) {
  return (
    <div className="run-log-feed-entry run-log-feed-entry--tight run-log-active-tail">
      {waiting ? <WaitingThinkingBlock active /> : <RunLogConversationTail />}
    </div>
  );
}

function ThinkingBlock({
  text,
  streaming,
  startedAt,
  endedAt,
  durationMs: projectedDurationMs = 0,
}: {
  text: string;
  streaming?: boolean;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
}) {
  const thinkingBodyInnerRef = useRef<HTMLDivElement>(null);
  const notifyLayoutChange = useActivityFeedLayoutChange();
  const displayText = usePacedStreamText(text, Boolean(streaming));
  const hasBody = displayText.trim().length > 0;
  const revealing = displayText !== text;
  const activelyStreaming = Boolean(streaming) || revealing;
  const [manualExpanded, setManualExpanded] = useState(false);
  const [settling, setSettling] = useState(false);
  const wasActiveRef = useRef(activelyStreaming);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wantOpen = resolveThinkingExpanded({
    activelyStreaming,
    settling,
    manualExpanded,
  });
  const [displayOpen, setDisplayOpen] = useState(wantOpen);
  const [collapsing, setCollapsing] = useState(false);
  const displayOpenRef = useRef(displayOpen);
  displayOpenRef.current = displayOpen;
  const measuredDurationMs = useTurnDurationMs(
    startedAt ?? "",
    endedAt,
    Boolean(startedAt) && activelyStreaming,
  );
  const durationMs = startedAt
    ? Math.max(measuredDurationMs, projectedDurationMs)
    : Math.max(0, projectedDurationMs);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    if (activelyStreaming) {
      clearHoldTimer();
      setSettling(false);
      setManualExpanded(false);
    } else if (wasActiveRef.current) {
      setManualExpanded(false);
      const prefersReducedMotion =
        typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const holdMs = resolveThinkingCollapseHoldMs(prefersReducedMotion);
      if (holdMs <= 0) {
        setSettling(false);
      } else {
        setSettling(true);
        clearHoldTimer();
        holdTimerRef.current = setTimeout(() => {
          holdTimerRef.current = null;
          setSettling(false);
        }, holdMs);
      }
    }
    wasActiveRef.current = activelyStreaming;
  }, [activelyStreaming, clearHoldTimer]);

  useEffect(() => () => clearHoldTimer(), [clearHoldTimer]);

  useLayoutEffect(() => {
    if (wantOpen) {
      setCollapsing(false);
      setDisplayOpen(true);
      return;
    }
    if (!displayOpenRef.current) {
      return;
    }
    const prefersReducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      setCollapsing(false);
      setDisplayOpen(false);
      return;
    }
    setCollapsing(true);
    const frame = requestAnimationFrame(() => {
      setDisplayOpen(false);
    });
    const timer = setTimeout(() => {
      setCollapsing(false);
    }, THINKING_COLLAPSE_ANIM_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [wantOpen]);

  useLayoutEffect(() => {
    notifyLayoutChange?.({ immediate: true });
  }, [displayOpen, notifyLayoutChange]);

  useLayoutEffect(() => {
    if (!activelyStreaming || !displayText.trim()) {
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
  }, [activelyStreaming, text, displayText]);

  if (Boolean(streaming) && !hasBody) {
    return <WaitingThinkingBlock active />;
  }

  if (!activelyStreaming && !settling && !manualExpanded && !hasBody && !collapsing) {
    return null;
  }

  const isExpanded = displayOpen;
  const showDetails = hasBody && (displayOpen || collapsing);
  const baseLabel = activelyStreaming ? i18n.t("activity.thinking") : i18n.t("activity.deepThinkingDone");
  const durationLabel = formatDuration(durationMs);
  const label = durationLabel ? `${baseLabel} ${durationLabel}` : baseLabel;

  return (
    <div
      className={[
        "run-log-thinking",
        activelyStreaming ? "streaming" : "",
        isExpanded ? "is-expanded" : "",
        collapsing ? "is-collapsing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className={[
          "run-log-thinking-trigger",
          activelyStreaming ? "is-running" : "",
          hasBody ? "is-expandable" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => {
          if (activelyStreaming || !hasBody) {
            return;
          }
          if (settling) {
            clearHoldTimer();
            setSettling(false);
            setManualExpanded(false);
            return;
          }
          setManualExpanded((value) => !value);
        }}
        aria-expanded={hasBody ? isExpanded : undefined}
      >
        <Sparkles size={14} className="run-log-thinking-icon" aria-hidden />
        <span className="run-log-thinking-summary">
          {activelyStreaming ? <ShimmerText>{label}</ShimmerText> : label}
        </span>
        {hasBody ? (
          <ChevronRight
            size={15}
            className={`run-log-thinking-chevron${isExpanded ? " open" : ""}`}
            aria-hidden
          />
        ) : null}
      </button>
      {showDetails ? (
        <div className="run-log-thinking-details" aria-hidden={!isExpanded}>
          <div className="run-log-thinking-details-inner">
            <div
              className="run-log-thinking-body-inner"
              ref={thinkingBodyInnerRef}
              role="region"
              aria-label={i18n.t("activity.thinkingContent")}
            >
              <div className="run-log-thinking-body">
                {activelyStreaming ? (
                  <div className="run-log-thinking-body-plain">{displayText}</div>
                ) : (
                  <MarkdownContent text={displayText} className="markdown-content" />
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Default-collapsed card for Codex item types Eco has not specialized yet. */
function UnknownItemBlock({
  itemType,
  phase,
  payload,
  streaming,
}: {
  itemType: string;
  phase?: "started" | "completed";
  payload?: string;
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const notifyLayoutChange = useActivityFeedLayoutChange();
  const hasBody = Boolean(payload?.trim());
  const activelyStreaming = Boolean(streaming) || phase === "started";
  const label = activelyStreaming
    ? i18n.t("activity.unknownItemRunning", { type: itemType })
    : i18n.t("activity.unknownItem", { type: itemType });

  useLayoutEffect(() => {
    notifyLayoutChange?.({ immediate: true });
  }, [expanded, notifyLayoutChange]);

  return (
    <div
      className={["run-log-unknown-item", activelyStreaming ? "streaming" : "", expanded ? "is-expanded" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className={[
          "run-log-unknown-item-trigger",
          activelyStreaming ? "is-running" : "",
          hasBody ? "is-expandable" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => {
          if (!hasBody) {
            return;
          }
          setExpanded((value) => !value);
        }}
        aria-expanded={hasBody ? expanded : undefined}
      >
        <CircleHelp size={14} className="run-log-unknown-item-icon" aria-hidden />
        <span className="run-log-unknown-item-summary">
          {activelyStreaming ? <ShimmerText>{label}</ShimmerText> : label}
        </span>
        {hasBody ? (
          <ChevronRight
            size={15}
            className={`run-log-unknown-item-chevron${expanded ? " open" : ""}`}
            aria-hidden
          />
        ) : null}
      </button>
      {expanded && hasBody ? (
        <div className="run-log-unknown-item-details">
          <pre
            className="run-log-unknown-item-payload"
            role="region"
            aria-label={i18n.t("activity.unknownItemPayload")}
          >
            {payload}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function UserPromptBlock({
  text,
  images = [],
  className,
  anchorId,
  createdAt,
  rewindTarget,
  onRestorePrompt,
  historyRevision = 0,
  onLoadUserMessageEdit,
  onRewriteUserMessage,
}: {
  text: string;
  images?: readonly PromptImagePreview[];
  className?: string;
  anchorId?: string;
  createdAt?: string;
  rewindTarget?: ThreadActivityRewindTarget;
  onRestorePrompt?: RestorePromptHandler;
  historyRevision?: number;
  onLoadUserMessageEdit?: LoadUserMessageEditHandler;
  onRewriteUserMessage?: RewriteUserMessageHandler;
}) {
  const bodyRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editRequestRef = useRef(0);
  const previousTextRef = useRef(text);
  const [expanded, setExpanded] = useState(false);
  const [canToggle, setCanToggle] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const [editImages, setEditImages] = useState<PromptImagePreview[]>(() => [...images]);
  const [editRevision, setEditRevision] = useState(historyRevision);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | undefined>();
  const canEdit = Boolean(rewindTarget && onLoadUserMessageEdit && onRewriteUserMessage);

  const makeEditImage = useCallback((attachment: PromptImageAttachment, index: number): PromptImagePreview => {
    return {
      ...attachment,
      id: `edit_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
    };
  }, []);

  const cancelEdit = useCallback(() => {
    editRequestRef.current += 1;
    setEditing(false);
    setEditLoading(false);
    setEditSaving(false);
    setEditError(undefined);
    setEditText(text);
    setEditImages([...images]);
    setEditRevision(historyRevision);
  }, [historyRevision, images, text]);

  const beginEdit = useCallback(() => {
    if (!canEdit || !rewindTarget || !onLoadUserMessageEdit) {
      return;
    }
    const requestId = ++editRequestRef.current;
    setEditing(true);
    setEditText(text);
    setEditImages([...images]);
    setEditRevision(historyRevision);
    setEditError(undefined);
    setEditLoading(true);
    void onLoadUserMessageEdit(rewindTarget.activityLineId)
      .then((result) => {
        if (requestId !== editRequestRef.current) {
          return;
        }
        if (result.capability.status !== "ready") {
          setEditError(
            result.capability.reason ??
              i18n.t("activity.editUnavailable", { defaultValue: "此消息当前无法编辑" }),
          );
          return;
        }
        setEditText(result.text);
        setEditImages(result.attachments.map((attachment, index) => makeEditImage(attachment, index)));
        setEditRevision(result.historyRevision);
      })
      .catch((caught) => {
        if (requestId === editRequestRef.current) {
          setEditError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (requestId === editRequestRef.current) {
          setEditLoading(false);
        }
      });
  }, [canEdit, historyRevision, images, makeEditImage, onLoadUserMessageEdit, rewindTarget, text]);

  const appendEditImages = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) {
        return;
      }
      void Promise.all(files.map((file) => readImageFileAsAttachment(file))).then((loaded) => {
        const valid = loaded.filter((attachment): attachment is NonNullable<typeof attachment> => Boolean(attachment));
        setEditImages((current) => {
          const remaining = Math.max(0, COMPOSER_MAX_IMAGES - current.length);
          const next = valid.slice(0, remaining).map((attachment, index) => makeEditImage(attachment, index));
          if (next.length < files.length) {
            setEditError(
              i18n.t("activity.editImageUnavailable", {
                defaultValue: "部分图片无法添加，支持常见图片格式且单张不超过 5 MB",
              }),
            );
          }
          return next.length === 0 ? current : [...current, ...next];
        });
      });
    },
    [makeEditImage],
  );

  const handleEditPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = event.clipboardData?.items;
      if (!items?.length || editLoading || editSaving) {
        return;
      }
      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }
      if (imageFiles.length === 0) {
        return;
      }
      event.preventDefault();
      appendEditImages(imageFiles);
    },
    [appendEditImages, editLoading, editSaving],
  );

  const submitEdit = useCallback(async () => {
    if (!rewindTarget || !onRewriteUserMessage || editLoading || editSaving) {
      return;
    }
    const prompt = editText.trim();
    if (!prompt && editImages.length === 0) {
      setEditError(i18n.t("activity.editEmptyMessage", { defaultValue: "消息不能为空" }));
      return;
    }
    setEditSaving(true);
    setEditError(undefined);
    try {
      await onRewriteUserMessage({
        activityLineId: rewindTarget.activityLineId,
        prompt,
        attachments: editImages.map(({ mediaType, data }) => ({ mediaType, data })),
        expectedHistoryRevision: editRevision,
      });
      setEditing(false);
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setEditSaving(false);
    }
  }, [editImages, editLoading, editRevision, editSaving, editText, onRewriteUserMessage, rewindTarget]);

  const handleEditKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!editSaving) {
          cancelEdit();
        }
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void submitEdit();
      }
    },
    [cancelEdit, editSaving, submitEdit],
  );

  useEffect(() => {
    if (!editing || editLoading) {
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.focus();
    const length = textarea.value.length;
    textarea.setSelectionRange(length, length);
  }, [editLoading, editing]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!editing || !textarea) {
      return;
    }
    textarea.style.height = "0px";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 72), Math.round(window.innerHeight * 0.42));
    textarea.style.height = `${nextHeight}px`;
  }, [editLoading, editText, editing, editImages.length]);

  useLayoutEffect(() => {
    if (previousTextRef.current === text) {
      return;
    }
    previousTextRef.current = text;
    editRequestRef.current += 1;
    setEditing(false);
    setEditLoading(false);
    setEditSaving(false);
    setEditError(undefined);
    setEditText(text);
    setEditImages([...images]);
    setEditRevision(historyRevision);
    setExpanded(false);
    setCanToggle(false);
  }, [historyRevision, images, text]);

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
      {editing ? (
        <div
          className="run-log-user-prompt-edit"
          role="group"
          aria-label={i18n.t("activity.editMessage", { defaultValue: "编辑消息" })}
          data-loading={editLoading ? "true" : undefined}
          data-saving={editSaving ? "true" : undefined}
        >
          {editImages.length > 0 ? (
            <div className="run-log-user-prompt-edit-attachments" aria-label={i18n.t("activity.userImages", { defaultValue: "消息图片" })}>
              {editImages.map((image, index) => (
                <div key={image.id} className="run-log-user-prompt-edit-attachment">
                  <img
                    src={`data:${image.mediaType};base64,${image.data}`}
                    alt={i18n.t("activity.userImageAlt", { count: index + 1 })}
                    loading="lazy"
                  />
                  <button
                    type="button"
                    className="run-log-user-prompt-edit-attachment-remove"
                    onClick={() => setEditImages((current) => current.filter((entry) => entry.id !== image.id))}
                    disabled={editLoading || editSaving}
                    aria-label={i18n.t("activity.removeImage", { defaultValue: "删除图片" })}
                    title={i18n.t("activity.removeImage", { defaultValue: "删除图片" })}
                  >
                    <X size={12} strokeWidth={ICON_STROKE} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            className="run-log-user-prompt-edit-textarea"
            value={editText}
            onChange={(event) => setEditText(event.target.value)}
            onPaste={handleEditPaste}
            onKeyDown={handleEditKeyDown}
            disabled={editLoading || editSaving}
            rows={2}
            spellCheck
            placeholder={i18n.t("activity.editPlaceholder", { defaultValue: "编辑消息…" })}
            aria-label={i18n.t("activity.messageContent", { defaultValue: "消息内容" })}
          />
          <div className="run-log-user-prompt-edit-bar">
            <div className="run-log-user-prompt-edit-meta">
              {editLoading ? (
                <span className="run-log-user-prompt-edit-status" role="status">
                  {i18n.t("activity.loadingMessage", { defaultValue: "正在加载…" })}
                </span>
              ) : editError ? (
                <span className="run-log-user-prompt-edit-error" role="alert">
                  {editError}
                </span>
              ) : editImages.length < COMPOSER_MAX_IMAGES ? (
                <span className="run-log-user-prompt-edit-hint">
                  {i18n.t("activity.editPasteHint", { defaultValue: "粘贴添加图片" })}
                </span>
              ) : null}
            </div>
            <div className="run-log-user-prompt-edit-actions">
              <button
                type="button"
                className="run-log-user-prompt-edit-action is-cancel"
                onClick={cancelEdit}
                disabled={editSaving}
              >
                {i18n.t("activity.cancelEdit", { defaultValue: "取消" })}
              </button>
              <button
                type="button"
                className="run-log-user-prompt-edit-action is-confirm"
                onClick={() => void submitEdit()}
                disabled={editLoading || editSaving}
              >
                {editSaving
                  ? i18n.t("activity.editSaving", { defaultValue: "发送中…" })
                  : i18n.t("activity.confirmEdit", { defaultValue: "发送" })}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className={contentClassName}>
          <div className="run-log-user-prompt-bubble">
            {images.length > 0 ? (
              <div className="run-log-user-prompt-images">
                {images.map((image, index) => (
                  <img
                    key={image.id}
                    src={`data:${image.mediaType};base64,${image.data}`}
                    alt={i18n.t("activity.userImageAlt", { count: index + 1 })}
                    loading="lazy"
                  />
                ))}
              </div>
            ) : null}
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
                {expanded ? i18n.t("activity.collapse") : i18n.t("activity.expandFull")}
              </button>
            ) : null}
          </div>
        </div>
      )}
      <RunLogMessageMeta
        align="end"
        copyText={text}
        {...(createdAt && { createdAt })}
        {...(onRestorePrompt &&
          rewindTarget &&
          !canEdit && {
            restorePrompt: {
              text,
              rewindTarget,
              onRestorePrompt,
            },
          })}
        {...(!editing && canEdit && { editUserMessage: { onEdit: beginEdit } })}
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
    <div
      className="clarification-answer-card"
      role="group"
      aria-label={i18n.t("activity.clarificationAnswer")}
    >
      <div className="clarification-answer-header">
        <span className="clarification-answer-title">
          <CircleHelp
            className="clarification-answer-icon"
            size={ICON_SIZE.sm}
            strokeWidth={ICON_STROKE}
            aria-hidden
          />
          {i18n.t("activity.clarificationAnswer")}
        </span>
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
          <span className="run-log-mission-tag">{i18n.t("activity.mission")}</span>
        </span>
        <ChevronDown size={16} className={`run-log-mission-chevron${expanded ? " open" : ""}`} aria-hidden />
      </div>
      {fullText ? (
        <ExpandableMissionText text={fullText} expanded={expanded} className="run-log-mission-preview" />
      ) : (
        <p className="run-log-mission-summary run-log-mission-summary-muted">
          {i18n.t("activity.waitingMission")}
        </p>
      )}
    </button>
  );
}

function ToolFailedBlock({
  tool,
  command,
  error,
  recoveredResult,
  subagent,
  modelByRole,
  omitRoleLabel,
}: {
  tool: string;
  command?: string;
  error?: string;
  recoveredResult?: Extract<ActivityDetailBlock, { kind: "tool-failed" }>["recoveredResult"];
  subagent?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
}) {
  const isBash = tool.trim().toLowerCase() === "bash";

  if (!recoveredResult) {
    const label = summarizeFailedTool(tool, command);
    return (
      <RunLogAction
        icon={iconForToolName(tool)}
        label={label}
        lifecycle="failed"
        {...(isBash && {
          bashRun: {
            title: label,
            ...(command && { command }),
            ...(error && { output: error }),
          },
        })}
        {...(!isBash && error && { error })}
        {...(subagent && { subagent })}
        {...(modelByRole && { modelByRole })}
        {...(omitRoleLabel !== undefined && { omitRoleLabel })}
      />
    );
  }

  return (
    <div className="run-log-tool-failed" role="status">
      {subagent && !omitRoleLabel ? (
        <span className="run-log-tool-failed-role">
          {formatRoleModelLabel(subagent, modelByRole?.[subagent])}
        </span>
      ) : null}
      <span className={`run-log-tool-failed-label${recoveredResult ? " is-recovered" : ""}`}>
        <span>
          {recoveredResult ? i18n.t("activity.patchRecovered") : summarizeFailedTool(tool, command)}
        </span>
        {!recoveredResult ? (
          <span className="run-log-tool-status-dot" title={i18n.t("activity.incomplete")} aria-hidden />
        ) : null}
      </span>
      {isBash && command ? (
        <RunLogBashTerminal command={command} />
      ) : command ? (
        <div className="run-log-tool-failed-command-wrap">
          <pre className="run-log-tool-failed-command">{command}</pre>
        </div>
      ) : null}
      {recoveredResult ? (
        <div className="run-log-tool-result-panel is-success">
          <div className="run-log-tool-result-header">
            <ShieldCheck size={14} aria-hidden />
            <span>{i18n.t("activity.noResidue")}</span>
          </div>
          <ul className="run-log-tool-result-files">
            {recoveredResult.files.map((file) => (
              <li key={`${file.status}:${file.path}`}>
                <span className="run-log-tool-result-file-status">{file.status}</span>
                <FileText size={13} aria-hidden />
                <code>{file.path}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : error && !isBash ? (
        <div className="run-log-tool-result-panel">
          <div className="run-log-tool-result-header">
            <Terminal size={14} aria-hidden />
            <span>{i18n.t("activity.commandOutput")}</span>
          </div>
          <pre className="run-log-tool-failed-error">{error}</pre>
        </div>
      ) : null}
    </div>
  );
}

function ApiErrorBlock({
  message,
  title: explicitTitle,
  statusCode,
  subagent,
  modelByRole,
  omitRoleLabel,
}: {
  message: string;
  title?: string;
  statusCode?: number;
  subagent?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
}) {
  const title =
    explicitTitle ??
    (statusCode !== undefined
      ? i18n.t("activity.connectionFailedHttp", { status: statusCode })
      : i18n.t("activity.connectionFailed"));

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

type ImageViewLoadState =
  | { status: "loading" }
  | {
      status: "ready";
      src: string;
      fileName: string;
    }
  | {
      status: "error";
      code?: import("../shared/ipc").ImageViewReadFailureCode | "bridge_unavailable";
      detail?: string;
    };

export function ImageViewBlock({
  imageView,
  lifecycle,
  subagent,
  modelByRole,
  omitRoleLabel,
}: {
  imageView: { path: string; eventId: string };
  lifecycle?: ToolActionLifecycle;
  subagent?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
}) {
  const [loadState, setLoadState] = useState<ImageViewLoadState>({ status: "loading" });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const fallbackFileName = imageView.path.split(/[\\/]/u).at(-1) || imageView.path;
  const roleLabel =
    subagent && !omitRoleLabel ? formatRoleModelLabel(subagent, modelByRole?.[subagent]) : undefined;

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    setDetailsOpen(false);
    setLightboxOpen(false);
    const api = window.eco;
    if (!api) {
      setLoadState({ status: "error", code: "bridge_unavailable" });
      return () => {
        cancelled = true;
      };
    }
    void api
      .readImageView({ path: imageView.path })
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          setLoadState({ status: "error", code: result.code });
          return;
        }
        setLoadState({
          status: "ready",
          src: `data:${result.mimeType};base64,${result.dataBase64}`,
          fileName: result.fileName,
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadState({
            status: "error",
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [imageView.eventId, imageView.path, retryToken]);

  useEffect(() => {
    if (!lightboxOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightboxOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxOpen]);

  const fileName = loadState.status === "ready" ? loadState.fileName : fallbackFileName;
  const statusLabel =
    lifecycle === "running" ? i18n.t("activity.imageView.viewing") : i18n.t("activity.imageView.viewed");
  const previewAlt = i18n.t("activity.imageView.previewAlt", { name: fileName });

  return (
    <div className="run-log-image-view-wrap">
      {roleLabel ? <span className="run-log-action-role">{roleLabel}</span> : null}
      <article className="run-log-image-view" aria-busy={loadState.status === "loading"}>
        <RunLogCollapsibleActionTrigger
          className="run-log-image-view-summary"
          icon="image"
          label={statusLabel}
          {...(lifecycle && { lifecycle })}
          expanded={detailsOpen}
          onClick={() => setDetailsOpen((value) => !value)}
        />

        {detailsOpen ? (
          <div className="run-log-image-view-body">
            {loadState.status === "loading" ? (
              <div className="run-log-image-view-state" aria-label={i18n.t("activity.imageView.loading")}>
                <RefreshCw size={18} className="run-log-image-view-spinner" aria-hidden />
                <span>{i18n.t("activity.imageView.loading")}</span>
              </div>
            ) : null}
            {loadState.status === "error" ? (
              <div className="run-log-image-view-state is-error" role="alert">
                <CircleAlert size={18} aria-hidden />
                <span className="run-log-image-view-error-copy">
                  <strong>{imageViewFailureLabel(loadState.code)}</strong>
                  {loadState.detail ? <span>{loadState.detail}</span> : null}
                </span>
                <button
                  type="button"
                  className="run-log-image-view-icon-button"
                  onClick={() => setRetryToken((value) => value + 1)}
                  title={i18n.t("common.retry")}
                  aria-label={i18n.t("common.retry")}
                >
                  <RefreshCw size={15} aria-hidden />
                </button>
              </div>
            ) : null}
            {loadState.status === "ready" ? (
              <button
                type="button"
                className="run-log-image-view-preview"
                onClick={() => setLightboxOpen(true)}
                aria-label={i18n.t("activity.imageView.open", { name: fileName })}
                title={fileName}
              >
                <img src={loadState.src} alt={previewAlt} />
              </button>
            ) : null}
          </div>
        ) : null}
      </article>

      {lightboxOpen && loadState.status === "ready" && typeof document !== "undefined"
        ? createPortal(
            <div
              className="run-log-image-view-lightbox"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setLightboxOpen(false);
                }
              }}
            >
              <div
                className="run-log-image-view-lightbox-content"
                role="dialog"
                aria-modal="true"
                aria-label={i18n.t("activity.imageView.open", { name: fileName })}
              >
                <div className="run-log-image-view-lightbox-bar">
                  <span title={fileName}>{fileName}</span>
                  <button
                    type="button"
                    className="run-log-image-view-lightbox-close"
                    onClick={() => setLightboxOpen(false)}
                    title={i18n.t("common.close")}
                    aria-label={i18n.t("common.close")}
                  >
                    <X size={18} aria-hidden />
                  </button>
                </div>
                <img src={loadState.src} alt={previewAlt} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

type ImageViewFailureCode = Extract<ImageViewLoadState, { status: "error" }>["code"];

function imageViewFailureLabel(code: ImageViewFailureCode): string {
  switch (code) {
    case "invalid_path":
      return i18n.t("activity.imageView.error.invalidPath");
    case "not_found":
      return i18n.t("activity.imageView.error.notFound");
    case "symbolic_link":
      return i18n.t("activity.imageView.error.symbolicLink");
    case "not_file":
      return i18n.t("activity.imageView.error.notFile");
    case "too_large":
      return i18n.t("activity.imageView.error.tooLarge");
    case "unsupported_type":
      return i18n.t("activity.imageView.error.unsupportedType");
    case "bridge_unavailable":
      return i18n.t("activity.imageView.error.bridgeUnavailable");
    default:
      return i18n.t("activity.imageView.error.readFailed");
  }
}

function RunLogAction({
  icon,
  label,
  displayLabelOverride,
  lifecycle,
  bashRun,
  fileChange,
  webSearch,
  readTarget,
  grepTarget,
  error,
  subagent,
  modelByRole,
  omitRoleLabel,
  forceDetailsExpanded = false,
  onActivate,
}: {
  icon: ActivityActionIcon;
  label: string;
  displayLabelOverride?: string;
  lifecycle?: ToolActionLifecycle;
  bashRun?: import("../shared/activity-display").BashRunCardDisplay;
  fileChange?: import("../shared/activity-display").FileChangeCardDisplay;
  webSearch?: import("../shared/activity-display").WebSearchCardDisplay;
  readTarget?: import("../shared/tool-target").ReadToolTargetDisplay;
  grepTarget?: import("../shared/tool-target").GrepToolTargetDisplay;
  error?: string;
  subagent?: string;
  modelByRole?: Record<string, string>;
  omitRoleLabel?: boolean;
  forceDetailsExpanded?: boolean;
  onActivate?: () => void;
}) {
  const isTerminal = icon === "terminal";
  const [expanded, setExpanded] = useState(false);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [canExpand, setCanExpand] = useState(false);
  const subagentRole = subagent?.trim() ? subagent : undefined;
  const showRoleLabel =
    subagentRole !== undefined &&
    !omitRoleLabel &&
    !activityLabelIncludesAgentRole(subagentRole, label, { modelId: modelByRole?.[subagentRole] });
  const roleLabel =
    showRoleLabel && subagentRole
      ? formatRoleModelLabel(subagentRole, modelByRole?.[subagentRole])
      : undefined;
  const displayLabel =
    displayLabelOverride ?? bashRun?.title ?? fileChange?.fileName ?? webSearch?.title ?? label;
  const hasHeavyDetails = Boolean(bashRun?.command || bashRun?.output || fileChange || webSearch || error);
  const detailsExpanded = forceDetailsExpanded || expanded;
  const canToggleDetails = !forceDetailsExpanded && (hasHeavyDetails || (isTerminal && canExpand));

  useLayoutEffect(() => {
    if (bashRun || webSearch || !isTerminal || expanded) {
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
  }, [bashRun, webSearch, expanded, isTerminal, label]);

  const triggerClassName = [
    "run-log-action-trigger",
    lifecycle === "running" ? "is-running" : "",
    lifecycle === "approval-pending" ? "is-pending" : "",
    canToggleDetails ? "is-expandable" : "",
    detailsExpanded ? "is-expanded" : "",
    fileChange ? "is-file-change" : "",
    webSearch ? "is-web-search" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const row = (
    <>
      <RunLogActionIcon icon={icon} {...(lifecycle && { lifecycle })} />
      <span ref={labelRef} className="run-log-action-label">
        {displayLabel}
      </span>
      {lifecycle === "failed" ? (
        <span className="run-log-tool-status-dot" title={i18n.t("activity.incomplete")} aria-hidden />
      ) : null}
      {fileChange && !detailsExpanded && (fileChange.additions > 0 || fileChange.deletions > 0) ? (
        <span className="run-log-file-change-card-stats run-log-action-file-stats">
          {fileChange.additions > 0 ? <span className="stat-add">+{fileChange.additions}</span> : null}
          {fileChange.deletions > 0 ? <span className="stat-del">-{fileChange.deletions}</span> : null}
        </span>
      ) : null}
      {webSearch?.statusText && !detailsExpanded ? (
        <span className="run-log-action-meta run-log-web-search-status-pill">{webSearch.statusText}</span>
      ) : null}
      {bashRun?.meta ? <span className="run-log-action-meta">{bashRun.meta}</span> : null}
      {webSearch?.meta && !bashRun?.meta ? (
        <span className="run-log-action-meta">{webSearch.meta}</span>
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
        <div className="run-log-action-main run-log-feed-surface">
          {canToggleDetails ? (
            <button
              type="button"
              className={`${triggerClassName} run-log-feed-surface-header`}
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={detailsExpanded}
              title={detailsExpanded ? undefined : bashRun.title}
            >
              {row}
            </button>
          ) : (
            <div className={`${triggerClassName} run-log-feed-surface-header`}>{row}</div>
          )}
          {detailsExpanded ? (
            <div className="run-log-action-card-detail run-log-feed-surface-body">
              <RunLogBashTerminal
                {...(bashRun.command && { command: bashRun.command })}
                {...(bashRun.output && { output: bashRun.output })}
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (webSearch) {
    return (
      <div className="run-log-action run-log-action--with-card run-log-action--web-search-card">
        {roleLabel ? <span className="run-log-action-role">{roleLabel}</span> : null}
        <div className="run-log-action-main run-log-feed-surface">
          {canToggleDetails ? (
            <button
              type="button"
              className={`${triggerClassName} run-log-feed-surface-header`}
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={detailsExpanded}
              title={detailsExpanded ? undefined : webSearch.title}
            >
              {row}
            </button>
          ) : (
            <div className={`${triggerClassName} run-log-feed-surface-header`}>{row}</div>
          )}
          {detailsExpanded ? (
            <div className="run-log-action-card-detail run-log-feed-surface-body run-log-web-search-detail">
              <RunLogWebSearchDetail display={webSearch} {...(lifecycle ? { lifecycle } : {})} />
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
              <RunLogFileChangeCard display={fileChange} {...(lifecycle && { lifecycle })} />
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
        <RunLogReadTargetLine readTarget={readTarget} {...(lifecycle && { lifecycle })} />
      </div>
    );
  }

  if (grepTarget) {
    return (
      <div className="run-log-action run-log-action--grep-target">
        {roleLabel ? <span className="run-log-action-role">{roleLabel}</span> : null}
        <RunLogGrepTargetLine grepTarget={grepTarget} {...(lifecycle && { lifecycle })} />
      </div>
    );
  }

  return (
    <div
      className={["run-log-action", isTerminal ? "run-log-action--terminal" : ""].filter(Boolean).join(" ")}
    >
      {roleLabel ? <span className="run-log-action-role">{roleLabel}</span> : null}
      <div className="run-log-action-main">
        {canToggleDetails || onActivate ? (
          <button
            type="button"
            className={triggerClassName}
            onClick={onActivate ?? (() => setExpanded((value) => !value))}
            {...(canToggleDetails && { "aria-expanded": detailsExpanded })}
            title={detailsExpanded ? undefined : label}
          >
            {row}
          </button>
        ) : (
          <div className={triggerClassName}>{row}</div>
        )}
        {error && detailsExpanded ? (
          <div className="run-log-tool-result-panel">
            <div className="run-log-tool-result-header">
              <Terminal size={14} aria-hidden />
              <span>{i18n.t("activity.commandOutput")}</span>
            </div>
            <pre className="run-log-tool-failed-error">{error}</pre>
          </div>
        ) : isTerminal && canExpand && detailsExpanded ? (
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

/** Expanded body only — outer shell is already one feed-surface card. */
function RunLogWebSearchDetail({
  display,
  lifecycle,
}: {
  display: import("../shared/activity-display").WebSearchCardDisplay;
  lifecycle?: ToolActionLifecycle;
}) {
  const status =
    display.statusText ||
    (lifecycle === "running"
      ? i18n.t("activity.webSearch.searching")
      : lifecycle === "failed"
        ? i18n.t("activity.webSearch.failed")
        : undefined);

  return (
    <div className="run-log-web-search-detail-body">
      <div className="run-log-web-search-detail-row">
        <span className="run-log-web-search-detail-label">
          {display.kind === "fetch"
            ? i18n.t("activity.webSearch.fetchKicker")
            : i18n.t("activity.webSearch.queryLabel")}
        </span>
        <span className="run-log-web-search-detail-value">{display.query}</span>
      </div>
      {status ? (
        <div className="run-log-web-search-detail-row">
          <span className="run-log-web-search-detail-label">{i18n.t("activity.webSearch.statusLabel")}</span>
          <span className="run-log-web-search-detail-value is-muted">{status}</span>
        </div>
      ) : null}
      {display.actionLabel ? (
        <div className="run-log-web-search-detail-row">
          <span className="run-log-web-search-detail-label">{i18n.t("activity.webSearch.actionLabel")}</span>
          <span className="run-log-web-search-detail-value is-muted">{display.actionLabel}</span>
        </div>
      ) : null}
      {display.url ? (
        <div className="run-log-web-search-detail-row">
          <span className="run-log-web-search-detail-label">URL</span>
          <span className="run-log-web-search-detail-value is-url" title={display.url}>
            {display.url}
          </span>
        </div>
      ) : null}
      {display.queries && display.queries.length > 1 ? (
        <div className="run-log-web-search-detail-row">
          <span className="run-log-web-search-detail-label">{i18n.t("activity.webSearch.queriesLabel")}</span>
          <ul className="run-log-web-search-detail-queries">
            {display.queries.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {display.note ? <p className="run-log-web-search-detail-note">{display.note}</p> : null}
    </div>
  );
}

function RunLogReadTargetLine({
  readTarget,
  lifecycle,
}: {
  readTarget: import("../shared/tool-target").ReadToolTargetDisplay;
  lifecycle?: ToolActionLifecycle;
}) {
  return (
    <p
      className={["run-log-read-target", lifecycle === "running" ? "is-running" : ""]
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
      {lifecycle === "failed" ? (
        <span className="run-log-tool-status-dot" title={i18n.t("activity.incomplete")} aria-hidden />
      ) : null}
    </p>
  );
}

function RunLogGrepTargetLine({
  grepTarget,
  lifecycle,
}: {
  grepTarget: import("../shared/tool-target").GrepToolTargetDisplay;
  lifecycle?: ToolActionLifecycle;
}) {
  return (
    <p
      className={["run-log-grep-target", lifecycle === "running" ? "is-running" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="run-log-grep-target-verb">Grepped</span>{" "}
      <span className="run-log-grep-target-detail">{formatGrepTargetInlineDetail(grepTarget)}</span>
      {lifecycle === "failed" ? (
        <span className="run-log-tool-status-dot" title={i18n.t("activity.incomplete")} aria-hidden />
      ) : null}
    </p>
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
        expanded ? "is-expanded" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => setExpanded((value) => !value)}
      aria-expanded={expanded}
    >
      <div className="run-log-file-change-card-header">
        <span className="run-log-file-change-card-title">{display.fileName}</span>
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

function RunLogBashTerminal({ command, output }: { command?: string; output?: string }) {
  return (
    <div className="run-log-bash-terminal">
      {command ? <RunLogBashCommand command={command} /> : null}
      {output ? <RunLogBashOutput output={output} /> : null}
    </div>
  );
}

function RunLogBashCommand({ command }: { command: string }) {
  return (
    <div className="run-log-bash-command" onWheel={scrollBashOutputFromCommand}>
      <span className="run-log-bash-prompt" aria-hidden>
        $
      </span>
      <pre className="run-log-bash-command-text">{command}</pre>
      <button
        type="button"
        className="run-log-bash-copy"
        onClick={(event) => {
          event.stopPropagation();
          copyRunLogMessageText(command);
        }}
        aria-label={i18n.t("activity.copyBash")}
        title={i18n.t("activity.copyCommand")}
      >
        <Copy size={13} aria-hidden />
      </button>
    </div>
  );
}

function RunLogBashOutput({ output }: { output: string }) {
  return (
    <div className="run-log-bash-output-wrap">
      <div className="run-log-bash-output-actions">
        <button
          type="button"
          className="run-log-bash-copy run-log-bash-output-copy"
          onClick={(event) => {
            event.stopPropagation();
            copyRunLogMessageText(output);
          }}
          aria-label={i18n.t("activity.copyCommandOutput")}
          title={i18n.t("activity.copyOutput")}
        >
          <Copy size={13} aria-hidden />
        </button>
      </div>
      <pre className="run-log-bash-output">{output}</pre>
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

function lifecycleStatusLabel(lifecycle: ToolActionLifecycle): string {
  switch (lifecycle) {
    case "approval-pending":
      return i18n.t("activity.lifecycle.pending");
    case "approval-approved":
      return i18n.t("activity.lifecycle.approved");
    case "approval-rejected":
      return i18n.t("activity.lifecycle.rejected");
    case "running":
      return i18n.t("activity.lifecycle.running");
    case "completed":
      return i18n.t("activity.lifecycle.completed");
    case "failed":
      return i18n.t("activity.lifecycle.failed");
  }
}

const actionIcons = {
  search: Search,
  file: FileSearch,
  image: ImageIcon,
  browser: AppWindow,
  edit: Pencil,
  terminal: Terminal,
  agent: Bot,
  context: Minimize2,
  network: Globe2,
} as const;

function RunLogActionIcon({
  icon,
  lifecycle,
}: {
  icon: ActivityActionIcon;
  lifecycle?: ToolActionLifecycle;
}) {
  const Icon = actionIcons[icon];
  const approvalLifecycle = lifecycle && isApprovalLifecycle(lifecycle) ? lifecycle : undefined;
  const StatusIcon = approvalLifecycle ? approvalLifecycleStatusIcons[approvalLifecycle] : undefined;
  const statusLabel = approvalLifecycle ? lifecycleStatusLabel(approvalLifecycle) : undefined;
  return (
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
  );
}

function RunLogCollapsibleActionTrigger({
  icon,
  label,
  lifecycle,
  expanded,
  onClick,
  className,
}: {
  icon: ActivityActionIcon;
  label: ReactNode;
  lifecycle?: ToolActionLifecycle;
  expanded: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={[
        "run-log-tool-group-trigger",
        lifecycle === "running" ? "is-running" : "",
        lifecycle === "approval-pending" ? "is-pending" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
      aria-expanded={expanded}
    >
      <RunLogActionIcon icon={icon} {...(lifecycle && { lifecycle })} />
      <span className="run-log-tool-group-summary">{label}</span>
      <ChevronRight
        size={15}
        className={`run-log-tool-group-chevron${expanded ? " open" : ""}`}
        aria-hidden
      />
    </button>
  );
}

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
