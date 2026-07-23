import { shortenModelId } from "@eco/runtime/usage";
import {
  Bot,
  Circle,
  ExternalLink,
  FileText,
  ListChecks,
  Maximize2,
  Minimize2,
  Plus,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BackgroundTerminalTask,
  ThreadPendingPlan,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
  ThreadStatus,
  WorkspaceDiffResult,
} from "../shared/ipc";
import { ProjectionSubagentDetailFeed } from "./ActivityLogView";
import { resolveSubagentRunDisplayTitle } from "./activity-log";
import { MarkdownContent } from "./MarkdownContent";
import { type RuntimeAgentDisplayNames, resolveRuntimeAgentName } from "./runtime-agent-display";
import { type RuntimeAgentThemes, resolveSubagentRowThemeStyle } from "./runtime-agent-theme";
import type { ThreadRunProjectionSubagentCard } from "./thread-run-projection-view";
import { WorkspaceDiffPanel } from "./WorkspaceDiffDrawer";

export const TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID = "__background_terminal_tasks__";
export const TASK_PANEL_REVIEW_TAB_ID = "__review__";
export const TASK_PANEL_PLAN_TAB_ID = "__plan__";

type ProjectionRequestSpan = ThreadRunProjectionSnapshot["requestSpans"][number];

type SubagentDetailState = {
  threadId: string;
  agentId: string;
  agent: ThreadRunProjectionSubagentCard["agent"];
  timeline: ThreadRunProjectionTimelineItem[];
  hasEarlier: boolean;
  beforeSequence?: number;
};

const emptyRequestSpansById = new Map<string, ProjectionRequestSpan>();

type StableSubagentCardSnapshot = {
  active: boolean;
  card: ThreadRunProjectionSubagentCard;
  signature: string;
};

type StableSubagentRequestSpansSnapshot = {
  active: boolean;
  signature: string;
  spansById: Map<string, ProjectionRequestSpan>;
};

export type TaskPanelActiveTab =
  | typeof TASK_PANEL_REVIEW_TAB_ID
  | typeof TASK_PANEL_PLAN_TAB_ID
  | typeof TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID
  | string;

function isThreadActive(status?: ThreadStatus | string): boolean {
  return status === "running" || status === "queued" || status === "awaiting_plan";
}

function isSubagentActive(card: ThreadRunProjectionSubagentCard): boolean {
  return card.agent.status === "active" || card.agent.status === "launching" || card.running;
}

function subagentRoleLabel(role: string, displayNames?: RuntimeAgentDisplayNames): string {
  return resolveRuntimeAgentName(role, displayNames) ?? resolveSubagentRunDisplayTitle(role);
}

function subagentTimelineItemSignature(
  item: ThreadRunProjectionSubagentCard["agent"]["timeline"][number],
): string {
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

function subagentCardSignature(card: ThreadRunProjectionSubagentCard): string {
  const timeline = card.agent.timeline;
  const usage = card.agent.usage;
  return [
    card.agent.agentId,
    card.agent.status,
    card.agent.endedAt ?? "",
    card.missionText,
    card.agent.mission ?? "",
    card.agent.delegationPrompt ?? "",
    card.agent.delegationSummary ?? "",
    timeline.map(subagentTimelineItemSignature).join("|"),
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
    card.agent.context?.occupancyPct ?? "",
  ].join(":");
}

function requestSpanSignature(span: ProjectionRequestSpan): string {
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

function subagentRequestSpanKeys(card: ThreadRunProjectionSubagentCard): string[] {
  const keys = new Set<string>();
  for (const item of card.agent.timeline) {
    const key = item.requestId?.trim();
    if (key) {
      keys.add(key);
    }
  }
  return [...keys];
}

function useStableSubagentCard(
  card: ThreadRunProjectionSubagentCard | undefined,
): ThreadRunProjectionSubagentCard | undefined {
  const snapshotsRef = useRef(new Map<string, StableSubagentCardSnapshot>());

  if (!card) {
    return undefined;
  }
  const active = isSubagentActive(card);
  const snapshot = snapshotsRef.current.get(card.key);
  if (!active && snapshot && !snapshot.active) {
    return snapshot.card;
  }

  const signature = subagentCardSignature(card);
  if (active) {
    if (!snapshot?.active || snapshot.signature !== signature) {
      snapshotsRef.current.set(card.key, { active, card, signature });
      return card;
    }
    return snapshot.card;
  }

  if (!snapshot || snapshot.active) {
    snapshotsRef.current.set(card.key, { active, card, signature });
    return card;
  }
  return snapshot.card;
}

function useStableSubagentRequestSpansById(
  card: ThreadRunProjectionSubagentCard | undefined,
  requestSpans: readonly ProjectionRequestSpan[],
): Map<string, ProjectionRequestSpan> {
  const snapshotsRef = useRef(new Map<string, StableSubagentRequestSpansSnapshot>());

  if (!card) {
    return emptyRequestSpansById;
  }

  const active = isSubagentActive(card);
  const snapshot = snapshotsRef.current.get(card.key);
  if (!active && snapshot && !snapshot.active) {
    return snapshot.spansById;
  }

  const requestSpanKeys = subagentRequestSpanKeys(card);
  const spanById = new Map(requestSpans.map((span) => [span.requestId, span]));
  const spans = requestSpanKeys
    .map((key) => spanById.get(key))
    .filter((span): span is ProjectionRequestSpan => Boolean(span));
  const signature = spans.map(requestSpanSignature).join("|");
  if (active) {
    if (!snapshot?.active || snapshot.signature !== signature) {
      const spansById = new Map(spans.map((span) => [span.requestId, span]));
      snapshotsRef.current.set(card.key, { active, signature, spansById });
      return spansById;
    }
    return snapshot.spansById;
  }

  if (!snapshot || snapshot.active) {
    const spansById = new Map(spans.map((span) => [span.requestId, span]));
    snapshotsRef.current.set(card.key, { active, signature, spansById });
    return spansById;
  }
  return snapshot.spansById;
}

function mergeDetailTimeline(
  current: readonly ThreadRunProjectionTimelineItem[],
  incoming: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()].sort(
    (left, right) => left.sequence - right.sequence || left.at.localeCompare(right.at),
  );
}

function SubagentProjectionDetail({
  card,
  projection,
  requestSpansById,
  threadActive,
}: {
  card: ThreadRunProjectionSubagentCard;
  projection?: ThreadRunProjectionSnapshot;
  requestSpansById: Map<string, ProjectionRequestSpan>;
  threadActive: boolean;
}) {
  const threadId = projection?.thread.threadId;
  const [detail, setDetail] = useState<SubagentDetailState>();
  const [loading, setLoading] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState<string>();
  const detailRef = useRef<SubagentDetailState | undefined>(undefined);
  const refreshInFlightRef = useRef(false);
  const feedSequence = useMemo(() => {
    if (!projection) return undefined;
    let maximum: number | undefined;
    for (const item of [
      ...projection.timeline,
      ...projection.agents.flatMap((agent) => agent.timeline),
    ]) {
      maximum = maximum === undefined ? item.sequence : Math.max(maximum, item.sequence);
    }
    return maximum;
  }, [projection]);
  const detailSequence = detail?.timeline.at(-1)?.sequence;

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  useEffect(() => {
    if (!threadId || !window.eco?.getThreadRunProjectionDetail) {
      setDetail(undefined);
      setError(threadId ? "当前桌面桥接未提供子代理详情接口。" : undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void window.eco
      .getThreadRunProjectionDetail({
        threadId,
        kind: "agent",
        key: card.agent.agentId,
        tail: true,
        limit: 500,
      })
      .then((result) => {
        if (cancelled) return;
        if (!result?.agent) {
          setDetail(undefined);
          setError("未找到该子代理的完整投影数据。");
          return;
        }
        setDetail({
          threadId,
          agentId: card.agent.agentId,
          agent: result.agent,
          timeline: result.timeline,
          hasEarlier: result.hasEarlier === true,
          ...(result.previousBeforeSequence !== undefined
            ? { beforeSequence: result.previousBeforeSequence }
            : {}),
        });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setDetail(undefined);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [card.agent.agentId, threadId]);

  useEffect(() => {
    void detailSequence;
    void feedSequence;
    const current = detailRef.current;
    if (
      !threadId ||
      !current ||
      current.threadId !== threadId ||
      current.agentId !== card.agent.agentId ||
      refreshInFlightRef.current ||
      !window.eco?.getThreadRunProjectionDetail
    ) {
      return;
    }
    const afterSequence = current.timeline.at(-1)?.sequence;
    if (afterSequence === undefined) return;
    refreshInFlightRef.current = true;
    void window.eco
      .getThreadRunProjectionDetail({
        threadId,
        kind: "agent",
        key: card.agent.agentId,
        afterSequence,
        limit: 500,
      })
      .then((result) => {
        if (!result?.agent || result.timeline.length === 0) return;
        const resultAgent = result.agent;
        setDetail((previous) =>
          previous && previous.threadId === threadId && previous.agentId === card.agent.agentId
            ? {
                ...previous,
                agent: resultAgent,
                timeline: mergeDetailTimeline(previous.timeline, result.timeline),
              }
            : previous,
        );
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        refreshInFlightRef.current = false;
      });
  }, [card.agent.agentId, detailSequence, feedSequence, threadId]);

  const loadEarlier = useCallback(() => {
    const current = detailRef.current;
    if (
      !current?.hasEarlier ||
      current.beforeSequence === undefined ||
      !window.eco?.getThreadRunProjectionDetail
    ) {
      return;
    }
    setLoadingEarlier(true);
    setError(undefined);
    void window.eco
      .getThreadRunProjectionDetail({
        threadId: current.threadId,
        kind: "agent",
        key: current.agentId,
        beforeSequence: current.beforeSequence,
        tail: true,
        limit: 500,
      })
      .then((result) => {
        if (!result?.agent) {
          setError("无法读取更早的子代理历史。");
          return;
        }
        const resultAgent = result.agent;
        setDetail((previous) =>
          previous
            ? {
                ...previous,
                agent: resultAgent,
                timeline: mergeDetailTimeline(result.timeline, previous.timeline),
                hasEarlier: result.hasEarlier === true,
                ...(result.previousBeforeSequence !== undefined
                  ? { beforeSequence: result.previousBeforeSequence }
                  : {}),
              }
            : previous,
        );
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setLoadingEarlier(false));
  }, []);

  const resolvedAgent = detail
    ? { ...card.agent, ...detail.agent, timeline: detail.timeline }
    : card.agent;

  return (
    <>
      {detail?.hasEarlier ? (
        <button type="button" className="task-panel-load-earlier" disabled={loadingEarlier} onClick={loadEarlier}>
          {loadingEarlier ? "正在加载…" : "加载更早记录"}
        </button>
      ) : null}
      {loading ? <div className="subagent-task-detail-status">正在加载完整记录…</div> : null}
      {error ? <div className="subagent-task-detail-status is-error">{error}</div> : null}
      <ProjectionSubagentDetailFeed
        agent={resolvedAgent}
        missionText={card.missionText}
        requestSpansById={requestSpansById}
        threadActive={threadActive}
      />
    </>
  );
}

function taskStatusLabel(status: BackgroundTerminalTask["status"]): string {
  switch (status) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "exited":
      return "已退出";
    case "failed":
      return "失败";
    case "stopped":
      return "已停止";
  }
}

function taskStatusTone(status: BackgroundTerminalTask["status"]): string {
  if (status === "running" || status === "starting") {
    return "running";
  }
  if (status === "failed") {
    return "failed";
  }
  return "done";
}

function formatCommand(command: readonly string[]): string {
  return command.join(" ");
}

export function BackgroundTerminalTasksPanel({
  tasks,
  onOpenTask,
  onStopTask,
}: {
  tasks: readonly BackgroundTerminalTask[];
  onOpenTask: (task: BackgroundTerminalTask) => void;
  onStopTask: (task: BackgroundTerminalTask) => void;
}) {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <section className="background-terminal-tasks" aria-label="后台终端任务">
      <div className="subagent-task-section-head">
        <span className="subagent-task-section-title">
          <Terminal size={14} aria-hidden />
          后台终端
        </span>
        <span className="subagent-task-section-count">{tasks.length}</span>
      </div>
      <div className="background-terminal-task-list">
        {tasks.map((task) => {
          const running = task.status === "running" || task.status === "starting";
          return (
            <div key={task.taskId} className="background-terminal-task-row">
              <button
                type="button"
                className="background-terminal-task-open"
                onClick={() => onOpenTask(task)}
                title={formatCommand(task.command)}
              >
                <span className={`background-terminal-task-dot tone-${taskStatusTone(task.status)}`}>
                  <Circle size={8} aria-hidden />
                </span>
                <span className="background-terminal-task-main">
                  <span className="background-terminal-task-label">{task.label}</span>
                  <span className="background-terminal-task-command">{formatCommand(task.command)}</span>
                </span>
                <span className="background-terminal-task-status">{taskStatusLabel(task.status)}</span>
                <ExternalLink size={13} aria-hidden />
              </button>
              <button
                type="button"
                className="background-terminal-task-stop"
                onClick={() => onStopTask(task)}
                disabled={!running}
                title={running ? "停止后台终端" : "任务已结束"}
                aria-label={`停止 ${task.label}`}
              >
                <Square size={12} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PlanDetailPanel({ plan }: { plan: ThreadPendingPlan }) {
  const planPath = plan.planFilePath?.trim();
  const userPrompt = plan.userPrompt.trim();
  const analysis = plan.analysis.trim();

  return (
    <section className="task-plan-detail" aria-label="完整实施计划">
      <header className="task-plan-detail-header">
        <span className="task-plan-detail-kicker">
          <FileText size={14} aria-hidden />
          实施计划
        </span>
        {planPath ? <span className="task-plan-detail-path">{planPath}</span> : null}
      </header>
      <div className="task-plan-detail-body">
        {userPrompt ? (
          <section className="task-plan-detail-section">
            <h3>用户目标</h3>
            <p>{userPrompt}</p>
          </section>
        ) : null}
        <section className="task-plan-detail-section">
          <h3>计划</h3>
          <div className="task-plan-detail-markdown">
            <MarkdownContent text={plan.plan} />
          </div>
        </section>
        {analysis ? (
          <section className="task-plan-detail-section task-plan-detail-section--analysis">
            <h3>分析</h3>
            <pre>{analysis}</pre>
          </section>
        ) : null}
      </div>
    </section>
  );
}

export function SubagentTaskDrawer({
  open,
  fullscreen,
  cards,
  projection,
  plan,
  activeTab,
  openSubagentTabIds,
  threadStatus,
  agentDisplayNames,
  agentThemes,
  backgroundTasks,
  reviewDiff,
  reviewLoading,
  reviewError,
  reviewSelectedPath,
  onSelectAgent,
  onSelectPlan,
  onCloseAgent,
  onSelectBackgroundTasks,
  onSelectReview,
  onToggleFullscreen,
  onSelectReviewPath,
  onOpenTerminalTask,
  onStopTerminalTask,
}: {
  open: boolean;
  fullscreen: boolean;
  cards: readonly ThreadRunProjectionSubagentCard[];
  projection?: ThreadRunProjectionSnapshot;
  plan?: ThreadPendingPlan;
  activeTab: TaskPanelActiveTab;
  openSubagentTabIds: readonly string[];
  threadStatus?: ThreadStatus;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  agentThemes?: RuntimeAgentThemes;
  backgroundTasks: readonly BackgroundTerminalTask[];
  reviewDiff?: WorkspaceDiffResult;
  reviewLoading?: boolean;
  reviewError?: string;
  reviewSelectedPath?: string;
  onSelectAgent: (agentId: string) => void;
  onSelectPlan: () => void;
  onCloseAgent: (agentId: string) => void;
  onSelectBackgroundTasks: () => void;
  onSelectReview: () => void;
  onToggleFullscreen: () => void;
  onSelectReviewPath: (path: string) => void;
  onOpenTerminalTask: (task: BackgroundTerminalTask) => void;
  onStopTerminalTask: (task: BackgroundTerminalTask) => void;
}) {
  const reviewSelected = activeTab === TASK_PANEL_REVIEW_TAB_ID;
  const planSelected = activeTab === TASK_PANEL_PLAN_TAB_ID;
  const terminalTasksSelected = activeTab === TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID;
  const openSubagentCards = useMemo(
    () =>
      openSubagentTabIds
        .map((tabId) => cards.find((card) => card.key === tabId))
        .filter((card): card is ThreadRunProjectionSubagentCard => card !== undefined),
    [cards, openSubagentTabIds],
  );
  const liveActiveSubagentCard =
    !reviewSelected && !planSelected && !terminalTasksSelected
      ? cards.find((card) => card.key === activeTab)
      : undefined;
  const activeSubagentCard = useStableSubagentCard(liveActiveSubagentCard);
  const requestSpansById = useStableSubagentRequestSpansById(
    activeSubagentCard,
    projection?.requestSpans ?? [],
  );

  if (!open) {
    return null;
  }

  return (
    <section
      id="task-panel"
      className={["subagent-task-side-panel", "is-open", fullscreen ? "is-fullscreen" : ""]
        .filter(Boolean)
        .join(" ")}
      aria-label={fullscreen ? "全屏任务面板" : "任务面板"}
    >
      <header className="subagent-task-panel-topbar">
        <div className="subagent-task-panel-tabs" role="tablist" aria-label="任务标签">
          <button
            type="button"
            className={`subagent-task-panel-tab subagent-task-panel-tab--review${reviewSelected ? " is-active" : ""}`}
            role="tab"
            aria-selected={reviewSelected}
            aria-controls="subagent-task-tab-review"
            onClick={onSelectReview}
          >
            <ListChecks size={15} aria-hidden />
            <span>审查</span>
          </button>
          {plan ? (
            <button
              type="button"
              className={`subagent-task-panel-tab subagent-task-panel-tab--plan${planSelected ? " is-active" : ""}`}
              role="tab"
              aria-selected={planSelected}
              aria-controls="subagent-task-tab-plan"
              onClick={onSelectPlan}
            >
              <FileText size={15} aria-hidden />
              <span>计划</span>
            </button>
          ) : null}
          {openSubagentCards.map((card) => {
            const roleLabel = subagentRoleLabel(card.agent.role, agentDisplayNames);
            const modelId = card.agent.usage?.modelId ?? card.agent.context?.modelId;
            const modelShort = modelId ? shortenModelId(modelId) : undefined;
            const runningStatusText = card.running ? card.statusText?.trim() || "处理中" : undefined;
            const tabTitle = [roleLabel, modelShort, runningStatusText].filter(Boolean).join(" · ");
            const isActive = activeTab === card.key;
            return (
              <span
                key={card.key}
                className={`subagent-task-panel-tab-shell${isActive ? " is-active" : ""}`}
                style={resolveSubagentRowThemeStyle(card.agent.role, agentThemes)}
              >
                <button
                  type="button"
                  className={`subagent-task-panel-tab subagent-task-panel-tab--subagent${
                    isActive ? " is-active" : ""
                  }${card.running ? " is-running" : ""}`}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`subagent-task-tab-${card.key}`}
                  title={tabTitle}
                  onClick={() => onSelectAgent(card.key)}
                >
                  <Bot size={15} aria-hidden />
                  <span className="subagent-task-panel-tab-label">
                    {roleLabel}
                    {modelShort ? (
                      <span className="subagent-task-panel-tab-model"> · {modelShort}</span>
                    ) : null}
                  </span>
                  {runningStatusText ? (
                    <span className="subagent-task-panel-tab-meta">{runningStatusText}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="subagent-task-panel-tab-close"
                  aria-label={`关闭 ${roleLabel} 标签`}
                  title="关闭标签"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseAgent(card.key);
                  }}
                >
                  <X size={13} aria-hidden />
                </button>
              </span>
            );
          })}
          {terminalTasksSelected ? (
            <button
              type="button"
              className="subagent-task-panel-tab subagent-task-panel-tab--terminal is-active"
              role="tab"
              aria-selected="true"
              aria-controls="subagent-task-tab-background-terminal"
              onClick={onSelectBackgroundTasks}
            >
              <Terminal size={15} aria-hidden />
              <span>终端</span>
            </button>
          ) : null}
          <button
            type="button"
            className="subagent-task-panel-tab-add"
            aria-label="添加标签"
            title="添加标签"
            disabled
          >
            <Plus size={17} aria-hidden />
          </button>
        </div>
        <button
          type="button"
          className={["subagent-task-panel-fullscreen", fullscreen ? "is-active" : ""]
            .filter(Boolean)
            .join(" ")}
          aria-label={fullscreen ? "退出全屏任务面板" : "全屏显示任务面板"}
          title={fullscreen ? "退出全屏" : "全屏显示任务面板"}
          aria-pressed={fullscreen}
          onClick={onToggleFullscreen}
        >
          {fullscreen ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
        </button>
      </header>

      <div className="subagent-task-panel-body">
        {reviewSelected ? (
          <div
            id="subagent-task-tab-review"
            className="subagent-task-panel-tab-pane subagent-task-panel-tab-pane--review"
            role="tabpanel"
          >
            <WorkspaceDiffPanel
              loading={reviewLoading ?? false}
              {...(reviewError && { error: reviewError })}
              {...(reviewDiff && { diff: reviewDiff })}
              {...(reviewSelectedPath && { selectedPath: reviewSelectedPath })}
              onSelectPath={onSelectReviewPath}
            />
          </div>
        ) : null}
        {planSelected && plan ? (
          <div id="subagent-task-tab-plan" className="subagent-task-panel-tab-pane" role="tabpanel">
            <PlanDetailPanel plan={plan} />
          </div>
        ) : null}
        {activeSubagentCard ? (
          <div
            id={`subagent-task-tab-${activeSubagentCard.key}`}
            className="subagent-task-panel-tab-pane"
            role="tabpanel"
          >
            <div className="subagent-task-detail">
              <SubagentProjectionDetail
                card={activeSubagentCard}
                {...(projection && { projection })}
                requestSpansById={requestSpansById}
                threadActive={isThreadActive(threadStatus ?? projection?.thread.status)}
              />
            </div>
          </div>
        ) : null}
        {terminalTasksSelected ? (
          <div
            id="subagent-task-tab-background-terminal"
            className="subagent-task-panel-tab-pane"
            role="tabpanel"
          >
            <BackgroundTerminalTasksPanel
              tasks={backgroundTasks}
              onOpenTask={onOpenTerminalTask}
              onStopTask={onStopTerminalTask}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
