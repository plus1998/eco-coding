import { shortenModelId } from "@eco/runtime";
import { Bot, Circle, ExternalLink, ListChecks, Plus, Square, Terminal } from "lucide-react";
import { useMemo } from "react";
import type {
  BackgroundTerminalTask,
  ThreadRunProjectionSnapshot,
  ThreadStatus,
  WorkspaceDiffResult,
} from "../shared/ipc";
import { ProjectionSubagentDetailFeed } from "./ActivityLogView";
import { resolveSubagentRunDisplayTitle } from "./activity-log";
import { type RuntimeAgentDisplayNames, resolveRuntimeAgentName } from "./runtime-agent-display";
import { type RuntimeAgentThemes, resolveSubagentRowThemeStyle } from "./runtime-agent-theme";
import type { ThreadRunProjectionSubagentCard } from "./thread-run-projection-view";
import { WorkspaceDiffPanel } from "./WorkspaceDiffDrawer";

export const TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID = "__background_terminal_tasks__";
export const TASK_PANEL_REVIEW_TAB_ID = "__review__";

export type TaskPanelActiveTab =
  | typeof TASK_PANEL_REVIEW_TAB_ID
  | typeof TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID
  | string;

function isThreadActive(status?: ThreadStatus | string): boolean {
  return status === "running" || status === "queued" || status === "awaiting_plan";
}

function subagentRoleLabel(role: string, displayNames?: RuntimeAgentDisplayNames): string {
  return resolveRuntimeAgentName(role, displayNames) ?? resolveSubagentRunDisplayTitle(role);
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

export function SubagentTaskDrawer({
  open,
  cards,
  projection,
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
  onSelectBackgroundTasks,
  onSelectReview,
  onSelectReviewPath,
  onOpenTerminalTask,
  onStopTerminalTask,
}: {
  open: boolean;
  cards: readonly ThreadRunProjectionSubagentCard[];
  projection?: ThreadRunProjectionSnapshot;
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
  onSelectBackgroundTasks: () => void;
  onSelectReview: () => void;
  onSelectReviewPath: (path: string) => void;
  onOpenTerminalTask: (task: BackgroundTerminalTask) => void;
  onStopTerminalTask: (task: BackgroundTerminalTask) => void;
}) {
  const requestSpansById = useMemo(
    () => new Map((projection?.requestSpans ?? []).map((span) => [span.requestId, span])),
    [projection?.requestSpans],
  );
  const reviewSelected = activeTab === TASK_PANEL_REVIEW_TAB_ID;
  const terminalTasksSelected = activeTab === TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID;
  const openSubagentCards = useMemo(
    () =>
      openSubagentTabIds
        .map((tabId) => cards.find((card) => card.key === tabId))
        .filter((card): card is ThreadRunProjectionSubagentCard => card !== undefined),
    [cards, openSubagentTabIds],
  );
  const activeSubagentCard =
    !reviewSelected && !terminalTasksSelected
      ? cards.find((card) => card.key === activeTab)
      : undefined;

  if (!open) {
    return null;
  }

  return (
    <section id="task-panel" className="subagent-task-side-panel is-open" aria-label="任务面板">
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
          {openSubagentCards.map((card) => {
            const roleLabel = subagentRoleLabel(card.agent.role, agentDisplayNames);
            const modelId = card.agent.usage?.modelId ?? card.agent.context?.modelId;
            const modelShort = modelId ? shortenModelId(modelId) : undefined;
            const isActive = activeTab === card.key;
            return (
              <button
                key={card.key}
                type="button"
                className={`subagent-task-panel-tab subagent-task-panel-tab--subagent${
                  isActive ? " is-active" : ""
                }${card.running ? " is-running" : ""}`}
                style={resolveSubagentRowThemeStyle(card.agent.role, agentThemes)}
                role="tab"
                aria-selected={isActive}
                aria-controls={`subagent-task-tab-${card.key}`}
                onClick={() => onSelectAgent(card.key)}
              >
                <Bot size={15} aria-hidden />
                <span className="subagent-task-panel-tab-label">
                  {roleLabel}
                  {modelShort ? (
                    <span className="subagent-task-panel-tab-model"> · {modelShort}</span>
                  ) : null}
                </span>
              </button>
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
        {activeSubagentCard ? (
          <div
            id={`subagent-task-tab-${activeSubagentCard.key}`}
            className="subagent-task-panel-tab-pane"
            role="tabpanel"
          >
            <div className="subagent-task-detail">
              <ProjectionSubagentDetailFeed
                agent={activeSubagentCard.agent}
                missionText={activeSubagentCard.missionText}
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
