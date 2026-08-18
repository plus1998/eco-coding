import { shortenModelId } from "@eco/runtime/usage";
import {
  Bot,
  Circle,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  ListChecks,
  Plus,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  BackgroundTerminalTask,
  ImageGenerationArtifact,
  ThreadPendingPlan,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
  ThreadStatus,
  WorkspaceDiffResult,
} from "../shared/ipc";
import {
  imageGenerationTaskTabId,
  parseImageGenerationTaskTabId,
} from "../shared/image-generation";
import { ProjectionSubagentDetailFeed } from "./ActivityLogView";
import { resolveSubagentRunDisplayTitle } from "./activity-log";
import { MarkdownContent } from "./MarkdownContent";
import { type RuntimeAgentDisplayNames, resolveRuntimeAgentName } from "./runtime-agent-display";
import { type RuntimeAgentThemes, resolveSubagentRowThemeStyle } from "./runtime-agent-theme";
import type { ThreadRunProjectionSubagentCard } from "./thread-run-projection-view";
import { WorkspaceDiffPanel, useEcoWorkspaceFileDiffLoader } from "./WorkspaceDiffDrawer";
import { WorkspaceFileBrowser } from "./WorkspaceFileBrowser";
import { WorkspaceFileViewer } from "./WorkspaceFileViewer";
import { BrowserPanel } from "./BrowserPanel";
import { i18n } from "./i18n";
import { basename } from "./workspace-file-browser-logic";
import type { WorkspaceFileReference } from "./workspace-file-reference";
import {
  browserTaskTabId,
  isBrowserTaskTabId,
  parseBrowserTaskTabId,
} from "../shared/browser";
import "./subagent-task-drawer-home.css";

export const TASK_PANEL_HOME_TAB_ID = "__home__";
export const TASK_PANEL_FILES_TAB_ID = "__files__";
export const TASK_PANEL_FILE_VIEWER_TAB_ID = "__file_viewer__";
export const TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID = "__background_terminal_tasks__";
export const TASK_PANEL_REVIEW_TAB_ID = "__review__";
export const TASK_PANEL_PLAN_TAB_ID = "__plan__";
/** @deprecated Single-browser tab id; use browserTaskTabId(browserId). */
export const TASK_PANEL_BROWSER_TAB_ID = "__browser__";

export type TaskPanelBrowserInstance = {
  id: string;
  title: string;
  url: string;
  faviconUrl?: string;
};

function TaskBrowserTabIcon({
  faviconUrl,
  label,
}: {
  faviconUrl?: string;
  label: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!faviconUrl || failed) {
    return <Globe size={15} aria-hidden />;
  }
  return (
    <img
      className="subagent-task-panel-tab-favicon"
      src={faviconUrl}
      alt=""
      title={label}
      draggable={false}
      onError={() => setFailed(true)}
      aria-hidden
    />
  );
}

export type TaskPanelActiveTab =
  | typeof TASK_PANEL_HOME_TAB_ID
  | typeof TASK_PANEL_FILES_TAB_ID
  | typeof TASK_PANEL_FILE_VIEWER_TAB_ID
  | typeof TASK_PANEL_REVIEW_TAB_ID
  | typeof TASK_PANEL_PLAN_TAB_ID
  | typeof TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID
  | typeof TASK_PANEL_BROWSER_TAB_ID
  | string;

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
    card.promptImages?.map((image) => `${image.id}:${image.mediaType}:${image.data}`).join("|") ?? "",
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
  const { t } = useTranslation();
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
      setError(threadId ? t("task.detailUnavailable") : undefined);
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
          setError(t("task.detailNotFound"));
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
          setError(t("task.earlierFailed"));
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
          {loadingEarlier ? t("task.loadingEarlier") : t("task.loadEarlier")}
        </button>
      ) : null}
      {loading ? (
        <div className="subagent-task-detail-status">{t("task.loadingFull")}</div>
      ) : null}
      {error ? <div className="subagent-task-detail-status is-error">{error}</div> : null}
      <ProjectionSubagentDetailFeed
        agent={resolvedAgent}
        missionText={card.missionText}
        requestSpansById={requestSpansById}
        threadActive={threadActive}
        {...(card.promptImages && { images: card.promptImages })}
      />
    </>
  );
}

function taskStatusLabel(status: BackgroundTerminalTask["status"]): string {
  switch (status) {
    case "running":
      return i18n.t("task.status.running");
    case "starting":
      return i18n.t("task.status.starting");
    case "exited":
      return i18n.t("task.status.exited");
    case "failed":
      return i18n.t("task.status.failed");
    case "stopped":
      return i18n.t("task.status.stopped");
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
  const { t } = useTranslation();
  if (tasks.length === 0) {
    return null;
  }

  return (
    <section className="background-terminal-tasks" aria-label={t("task.background")}>
      <div className="subagent-task-section-head">
        <span className="subagent-task-section-title">
          <Terminal size={14} aria-hidden />
          {t("task.backgroundLabel")}
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
                title={running ? t("task.stopBackground") : t("task.ended")}
                aria-label={t("task.stopNamed", { name: task.label })}
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
  const { t } = useTranslation();
  const planPath = plan.planFilePath?.trim();
  const userPrompt = plan.userPrompt.trim();
  const analysis = plan.analysis.trim();

  return (
    <section className="task-plan-detail" aria-label={t("task.fullPlan")}>
      <header className="task-plan-detail-header">
        <span className="task-plan-detail-kicker">
          <FileText size={14} aria-hidden />
          {t("task.implementationPlan")}
        </span>
        {planPath ? <span className="task-plan-detail-path">{planPath}</span> : null}
      </header>
      <div className="task-plan-detail-body">
        {userPrompt ? (
          <section className="task-plan-detail-section">
            <h3>{t("task.userGoal")}</h3>
            <p>{userPrompt}</p>
          </section>
        ) : null}
        <section className="task-plan-detail-section">
          <h3>{t("task.plan")}</h3>
          <div className="task-plan-detail-markdown">
            <MarkdownContent text={plan.plan} />
          </div>
        </section>
        {analysis ? (
          <section className="task-plan-detail-section task-plan-detail-section--analysis">
            <h3>{t("task.analysis")}</h3>
            <pre>{analysis}</pre>
          </section>
        ) : null}
      </div>
    </section>
  );
}

function ImageGenerationArtifactDetail({ artifact }: { artifact: ImageGenerationArtifact }) {
  const { t } = useTranslation();
  const [images, setImages] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [revealError, setRevealError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setImages([]);
    setLoadError(undefined);
    setRevealError(undefined);
    if (artifact.images.length === 0 || !window.eco?.readImageGenerationArtifact) return;
    void Promise.all(
      artifact.images.map((_, imageIndex) =>
        window.eco!.readImageGenerationArtifact({ artifactId: artifact.id, imageIndex }),
      ),
    ).then((results) => {
      if (!cancelled) setImages(results.map((result) => `data:${result.mimeType};base64,${result.dataBase64}`));
    }).catch((error) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [artifact.id, artifact.images.length]);

  async function handleRevealImage(imageIndex: number) {
    if (!window.eco?.revealImageGenerationArtifact) {
      setRevealError(t("task.image.openLocationUnavailable"));
      return;
    }
    setRevealError(undefined);
    try {
      await window.eco.revealImageGenerationArtifact({ artifactId: artifact.id, imageIndex });
    } catch (error) {
      setRevealError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="image-artifact-detail">
      <header>
        <span className={`image-artifact-status is-${artifact.status}`}>
          {t(`task.image.status.${artifact.status}`)}
        </span>
        <span>{artifact.profileName} · {artifact.model}</span>
      </header>
      <section>
        <h3>{t("task.image.prompt")}</h3>
        <p className="image-artifact-prompt">{artifact.prompt}</p>
      </section>
      <section>
        <h3>{t("task.image.parameters")}</h3>
        <pre>{JSON.stringify(artifact.parameters, null, 2)}</pre>
      </section>
      {artifact.errorMessage ? (
        <section className="image-artifact-error">
          <h3>{artifact.errorCode ?? t("task.image.error")}</h3>
          <p>{artifact.errorMessage}</p>
        </section>
      ) : null}
      {loadError ? <p className="image-artifact-error">{loadError}</p> : null}
      {revealError ? <p className="image-artifact-error" role="alert">{revealError}</p> : null}
      {images.length > 0 ? (
        <div className="image-artifact-gallery">
          {images.map((source, index) => (
            <figure key={artifact.images[index]?.relativePath ?? index}>
              <img src={source} alt={`${t("task.image.generated")} ${index + 1}`} />
              <figcaption className="image-artifact-caption">
                <span>{artifact.images[index]?.relativePath}</span>
                <button
                  type="button"
                  className="image-artifact-location-button"
                  onClick={() => void handleRevealImage(index)}
                  title={t("task.image.openLocation")}
                  aria-label={t("task.image.openLocation")}
                >
                  <FolderOpen size={13} aria-hidden />
                  <span>{t("task.image.openLocation")}</span>
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function SubagentTaskDrawer({
  open,
  surfaceActive = open,
  fullscreen,
  cards,
  projection,
  plan,
  activeTab,
  openTabIds,
  threadStatus,
  agentDisplayNames,
  agentThemes,
  backgroundTasks,
  imageArtifacts = [],
  reviewDiff,
  reviewLoading,
  reviewError,
  reviewSelectedPath,
  onSelectAgent,
  onSelectPlan,
  onCloseTab,
  onSelectBackgroundTasks,
  onSelectReview,
  workspacePath,
  fileTarget,
  onSelectFiles,
  onSelectFileViewer,
  onSelectBrowser,
  browserInstances,
  onViewedFileChange,
  onOpenTerminal,
  onShowHome,
  onSelectReviewPath,
  onOpenTerminalTask,
  onStopTerminalTask,
  onSelectImageArtifact,
}: {
  open: boolean;
  /**
   * False while the panel is exit-animating (or fully closed).
   * Keeps drawer chrome mounted for exit motion, but parks the native browser host.
   */
  surfaceActive?: boolean;
  fullscreen: boolean;
  cards: readonly ThreadRunProjectionSubagentCard[];
  projection?: ThreadRunProjectionSnapshot;
  plan?: ThreadPendingPlan;
  activeTab: TaskPanelActiveTab;
  openTabIds: readonly TaskPanelActiveTab[];
  threadStatus?: ThreadStatus;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  agentThemes?: RuntimeAgentThemes;
  backgroundTasks: readonly BackgroundTerminalTask[];
  imageArtifacts?: readonly ImageGenerationArtifact[];
  reviewDiff?: WorkspaceDiffResult;
  reviewLoading?: boolean;
  reviewError?: string;
  reviewSelectedPath?: string;
  onSelectAgent: (agentId: string) => void;
  onSelectPlan: () => void;
  onCloseTab: (tabId: TaskPanelActiveTab) => void;
  onSelectBackgroundTasks: () => void;
  onSelectReview: () => void;
  workspacePath: string;
  fileTarget?: WorkspaceFileReference & { requestId: number; restricted?: boolean };
  onSelectFiles: () => void;
  onSelectFileViewer: () => void;
  onSelectBrowser: (browserId?: string) => void;
  browserInstances?: readonly TaskPanelBrowserInstance[];
  onViewedFileChange: (target: WorkspaceFileReference & { requestId: number }) => void;
  onOpenTerminal: () => void;
  onShowHome: () => void;
  onSelectReviewPath: (path: string) => void;
  onOpenTerminalTask: (task: BackgroundTerminalTask) => void;
  onStopTerminalTask: (task: BackgroundTerminalTask) => void;
  onSelectImageArtifact: (artifactId: string) => void;
}) {
  const { t } = useTranslation();
  const loadFileDiff = useEcoWorkspaceFileDiffLoader();
  const homeSelected = activeTab === TASK_PANEL_HOME_TAB_ID;
  const filesSelected = activeTab === TASK_PANEL_FILES_TAB_ID;
  const fileViewerSelected = activeTab === TASK_PANEL_FILE_VIEWER_TAB_ID;
  const reviewSelected = activeTab === TASK_PANEL_REVIEW_TAB_ID;
  const planSelected = activeTab === TASK_PANEL_PLAN_TAB_ID;
  const terminalTasksSelected = activeTab === TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID;
  const activeBrowserId = parseBrowserTaskTabId(String(activeTab));
  const browserSelected = Boolean(activeBrowserId);
  const activeImageArtifactId = parseImageGenerationTaskTabId(String(activeTab));
  const imageSelected = Boolean(activeImageArtifactId);
  const activeImageArtifact = imageArtifacts.find((artifact) => artifact.id === activeImageArtifactId);
  const openImageArtifacts = openTabIds
    .map((tabId) => parseImageGenerationTaskTabId(String(tabId)))
    .filter((id): id is string => Boolean(id))
    .map((id) => imageArtifacts.find((artifact) => artifact.id === id))
    .filter((artifact): artifact is ImageGenerationArtifact => Boolean(artifact));
  const browserTabIds = openTabIds.filter((tabId) => isBrowserTaskTabId(String(tabId)));
  const openBrowserInstances = (browserInstances ?? []).filter((instance) =>
    browserTabIds.includes(browserTaskTabId(instance.id)),
  );
  // Also show tabs for openTabIds that mention browser ids even if state lag.
  const browserTabsFromOpenIds = browserTabIds
    .map((tabId) => {
      const id = parseBrowserTaskTabId(String(tabId));
      if (!id) return undefined;
      const known = (browserInstances ?? []).find((item) => item.id === id);
      return known ?? { id, title: t("browser.title"), url: "about:blank" };
    })
    .filter((item): item is TaskPanelBrowserInstance => Boolean(item));
  const browserTabs =
    openBrowserInstances.length > 0
      ? openBrowserInstances
      : browserTabsFromOpenIds;
  const filesOpen = openTabIds.includes(TASK_PANEL_FILES_TAB_ID);
  const fileViewerOpen = openTabIds.includes(TASK_PANEL_FILE_VIEWER_TAB_ID);
  const reviewOpen = openTabIds.includes(TASK_PANEL_REVIEW_TAB_ID);
  const planOpen = openTabIds.includes(TASK_PANEL_PLAN_TAB_ID);
  const terminalTasksOpen = openTabIds.includes(TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID);
  const browserOpen = browserTabs.length > 0;
  const openSubagentCards = useMemo(
    () =>
      openTabIds
        .map((tabId) => cards.find((card) => card.key === tabId))
        .filter((card): card is ThreadRunProjectionSubagentCard => card !== undefined),
    [cards, openTabIds],
  );
  const liveActiveSubagentCard =
    !homeSelected &&
    !filesSelected &&
    !fileViewerSelected &&
    !reviewSelected &&
    !planSelected &&
    !terminalTasksSelected &&
    !browserSelected &&
    !imageSelected
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
      aria-label={fullscreen ? t("app.taskPanelFullscreen") : t("app.taskPanel")}
    >
      <header className="subagent-task-panel-topbar">
        <div className="subagent-task-panel-tabs" role="tablist" aria-label={t("task.tabs")}>
          {filesOpen ? (
            <span
              className={`subagent-task-panel-tab-shell${filesSelected ? " is-active" : ""}`}
            >
              <button
                type="button"
                className={`subagent-task-panel-tab subagent-task-panel-tab--files${
                  filesSelected ? " is-active" : ""
                }`}
                role="tab"
                aria-selected={filesSelected}
                aria-controls="subagent-task-tab-files"
                onClick={onSelectFiles}
              >
                <FolderOpen size={15} aria-hidden />
                <span>{t("task.files")}</span>
              </button>
              <button
                type="button"
                className="subagent-task-panel-tab-close"
                aria-label={t("task.closeTab", { label: t("task.files") })}
                title={t("task.closeTabTitle")}
                onClick={() => onCloseTab(TASK_PANEL_FILES_TAB_ID)}
              >
                <X size={13} aria-hidden />
              </button>
            </span>
          ) : null}
          {fileViewerOpen ? (
            <span
              className={`subagent-task-panel-tab-shell${fileViewerSelected ? " is-active" : ""}`}
            >
              <button
                type="button"
                className={`subagent-task-panel-tab subagent-task-panel-tab--file-viewer${
                  fileViewerSelected ? " is-active" : ""
                }`}
                role="tab"
                aria-selected={fileViewerSelected}
                aria-controls="subagent-task-tab-file-viewer"
                aria-label={t("fileViewer.tabLabel", {
                  name: fileTarget ? basename(fileTarget.path) : t("fileViewer.title"),
                })}
                title={fileTarget?.path ?? t("fileViewer.title")}
                onClick={onSelectFileViewer}
              >
                <FileText size={15} aria-hidden />
                <span>{fileTarget ? basename(fileTarget.path) : t("fileViewer.title")}</span>
              </button>
              <button
                type="button"
                className="subagent-task-panel-tab-close"
                aria-label={t("task.closeTab", {
                  label: fileTarget ? basename(fileTarget.path) : t("fileViewer.title"),
                })}
                title={t("task.closeTabTitle")}
                onClick={() => onCloseTab(TASK_PANEL_FILE_VIEWER_TAB_ID)}
              >
                <X size={13} aria-hidden />
              </button>
            </span>
          ) : null}
          {reviewOpen ? (
            <span
              className={`subagent-task-panel-tab-shell${reviewSelected ? " is-active" : ""}`}
            >
              <button
                type="button"
                className={`subagent-task-panel-tab subagent-task-panel-tab--review${
                  reviewSelected ? " is-active" : ""
                }`}
                role="tab"
                aria-selected={reviewSelected}
                aria-controls="subagent-task-tab-review"
                onClick={onSelectReview}
              >
                <ListChecks size={15} aria-hidden />
                <span>{t("task.review")}</span>
              </button>
              <button
                type="button"
                className="subagent-task-panel-tab-close"
                aria-label={t("task.closeTab", { label: t("task.review") })}
                title={t("task.closeTabTitle")}
                onClick={() => onCloseTab(TASK_PANEL_REVIEW_TAB_ID)}
              >
                <X size={13} aria-hidden />
              </button>
            </span>
          ) : null}
          {browserTabs.map((instance) => {
            const tabId = browserTaskTabId(instance.id);
            const isActive = activeTab === tabId;
            const label =
              instance.title?.trim() ||
              (instance.url && instance.url !== "about:blank" ? instance.url : t("browser.title"));
            return (
              <span
                key={tabId}
                className={`subagent-task-panel-tab-shell${isActive ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  className={`subagent-task-panel-tab subagent-task-panel-tab--browser${
                    isActive ? " is-active" : ""
                  }`}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`subagent-task-tab-browser-${instance.id}`}
                  title={instance.url || label}
                  onClick={() => onSelectBrowser(instance.id)}
                >
                  <TaskBrowserTabIcon
                    {...(instance.faviconUrl ? { faviconUrl: instance.faviconUrl } : {})}
                    label={label}
                  />
                  <span className="subagent-task-panel-tab-label">{label}</span>
                </button>
                <button
                  type="button"
                  className="subagent-task-panel-tab-close"
                  aria-label={t("task.closeTab", { label })}
                  title={t("task.closeTabTitle")}
                  onClick={() => onCloseTab(tabId)}
                >
                  <X size={13} aria-hidden />
                </button>
              </span>
            );
          })}
          {plan && planOpen ? (
            <span className={`subagent-task-panel-tab-shell${planSelected ? " is-active" : ""}`}>
              <button
                type="button"
                className={`subagent-task-panel-tab subagent-task-panel-tab--plan${
                  planSelected ? " is-active" : ""
                }`}
                role="tab"
                aria-selected={planSelected}
                aria-controls="subagent-task-tab-plan"
                onClick={onSelectPlan}
              >
                <FileText size={15} aria-hidden />
                <span>{t("task.plan")}</span>
              </button>
              <button
                type="button"
                className="subagent-task-panel-tab-close"
                aria-label={t("task.closeTab", { label: t("task.plan") })}
                title={t("task.closeTabTitle")}
                onClick={() => onCloseTab(TASK_PANEL_PLAN_TAB_ID)}
              >
                <X size={13} aria-hidden />
              </button>
            </span>
          ) : null}
          {openImageArtifacts.map((artifact) => {
            const tabId = imageGenerationTaskTabId(artifact.id);
            const isActive = activeTab === tabId;
            return (
              <span key={tabId} className={`subagent-task-panel-tab-shell${isActive ? " is-active" : ""}`}>
                <button
                  type="button"
                  className={`subagent-task-panel-tab${isActive ? " is-active" : ""}`}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onSelectImageArtifact(artifact.id)}
                >
                  <ImageIcon size={15} aria-hidden />
                  <span className="subagent-task-panel-tab-label">{t("task.image.title")}</span>
                </button>
                <button type="button" className="subagent-task-panel-tab-close" title={t("task.closeTabTitle")} onClick={() => onCloseTab(tabId)}>
                  <X size={13} aria-hidden />
                </button>
              </span>
            );
          })}
          {openSubagentCards.map((card) => {
            const roleLabel = subagentRoleLabel(card.agent.role, agentDisplayNames);
            const modelId = card.agent.usage?.modelId ?? card.agent.context?.modelId;
            const modelShort = modelId ? shortenModelId(modelId) : undefined;
            const runningStatusText = card.running
              ? card.statusText?.trim() || t("task.processing")
              : undefined;
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
                  aria-label={t("task.closeTab", { label: roleLabel })}
                  title={t("task.closeTabTitle")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(card.key);
                  }}
                >
                  <X size={13} aria-hidden />
                </button>
              </span>
            );
          })}
          {terminalTasksOpen ? (
            <span
              className={`subagent-task-panel-tab-shell${terminalTasksSelected ? " is-active" : ""}`}
            >
              <button
                type="button"
                className={`subagent-task-panel-tab subagent-task-panel-tab--terminal${
                  terminalTasksSelected ? " is-active" : ""
                }`}
                role="tab"
                aria-selected={terminalTasksSelected}
                aria-controls="subagent-task-tab-background-terminal"
                onClick={onSelectBackgroundTasks}
              >
                <Terminal size={15} aria-hidden />
                <span>{t("task.terminal")}</span>
              </button>
              <button
                type="button"
                className="subagent-task-panel-tab-close"
                aria-label={t("task.closeTab", { label: t("task.terminal") })}
                title={t("task.closeTabTitle")}
                onClick={() => onCloseTab(TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID)}
              >
                <X size={13} aria-hidden />
              </button>
            </span>
          ) : null}
          <button
            type="button"
            className="subagent-task-panel-tab-add"
            aria-label={t("task.home")}
            title={t("task.home")}
            onClick={onShowHome}
          >
            <Plus size={17} aria-hidden />
          </button>
        </div>
      </header>

      <div className="subagent-task-panel-body">
        {homeSelected ? (
          <section className="task-panel-home-actions" aria-labelledby="task-panel-home-title">
            <h2 id="task-panel-home-title">{t("task.home")}</h2>
            <button type="button" onClick={onOpenTerminal}>
              <Terminal size={17} aria-hidden />
              <span>{t("task.terminal")}</span>
            </button>
            <button type="button" onClick={onSelectFiles}>
              <FolderOpen size={17} aria-hidden />
              <span>{t("task.files")}</span>
            </button>
            <button type="button" onClick={onSelectReview}>
              <ListChecks size={17} aria-hidden />
              <span>{t("task.review")}</span>
            </button>
            <button type="button" onClick={() => onSelectBrowser()}>
              <Globe size={17} aria-hidden />
              <span>{t("browser.title")}</span>
            </button>
          </section>
        ) : null}
        {filesSelected ? (
          <div id="subagent-task-tab-files" className="subagent-task-panel-tab-pane" role="tabpanel">
            <WorkspaceFileBrowser workspacePath={workspacePath} />
          </div>
        ) : null}
        {fileViewerSelected ? (
          <div
            id="subagent-task-tab-file-viewer"
            className="subagent-task-panel-tab-pane subagent-task-panel-tab-pane--file-viewer"
            role="tabpanel"
          >
            <WorkspaceFileViewer
              workspacePath={workspacePath}
              {...(fileTarget ? { target: fileTarget } : {})}
              onViewedFileChange={onViewedFileChange}
            />
          </div>
        ) : null}
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
              loadFileDiff={loadFileDiff}
              onSelectPath={onSelectReviewPath}
            />
          </div>
        ) : null}
        {browserTabs.map((instance) => {
          const tabId = browserTaskTabId(instance.id);
          const isActive = activeTab === tabId;
          return (
            <div
              key={tabId}
              id={`subagent-task-tab-browser-${instance.id}`}
              className={[
                "subagent-task-panel-tab-pane",
                "subagent-task-panel-tab-pane--browser",
                isActive ? "is-active" : "is-inactive",
              ].join(" ")}
              role="tabpanel"
              hidden={!isActive}
            >
              <BrowserPanel active={isActive && surfaceActive} browserId={instance.id} />
            </div>
          );
        })}
        {planSelected && plan ? (
          <div id="subagent-task-tab-plan" className="subagent-task-panel-tab-pane" role="tabpanel">
            <PlanDetailPanel plan={plan} />
          </div>
        ) : null}
        {imageSelected && activeImageArtifact ? (
          <div
            className="subagent-task-panel-tab-pane subagent-task-panel-tab-pane--image-artifact"
            role="tabpanel"
          >
            <ImageGenerationArtifactDetail artifact={activeImageArtifact} />
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
