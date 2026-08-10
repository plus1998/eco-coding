import {
  Bot,
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  Image as ImageIcon,
  Lightbulb,
  ListTodo,
  Plug,
  Sparkles,
  Users,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { countEnabledMcpServers } from "../shared/composer-mcp";
import type { SkillsEnabledSettings } from "../shared/composer-skills-settings";
import type {
  CoderTodoItem,
  GitSettingsSnapshot,
  GitWorkingTreeStatus,
  ImageGenerationArtifact,
  McpServerConfigView,
  SubagentEnabledSettings,
  SubagentRole,
  ThreadBillingSnapshot,
  ThreadContextSnapshot,
  ThreadPendingPlan,
  ThreadRuntimeConfig,
  ThreadStatus,
  WorkspaceInfo,
} from "../shared/ipc";
import type { SkillInfo } from "../shared/skills";
import type { McpServersEnabledSettings } from "../shared/thread-runtime-config";
import { webChatHostname } from "../shared/web-chat-list";
import { resolveSubagentRunDisplayTitle } from "./activity-log";
import { CoderTodoPanel } from "./CoderTodoPanel";
import { ComposerAgentModelsCardBody } from "./ComposerAgentModels";
import { ComposerMcpCardBody } from "./ComposerMcpServers";
import { ComposerSkillsCardBody } from "./ComposerSkillsControl";
import type { ComposerAgentModelLabel } from "./composer-agent-model-labels";
import { type RuntimeAgentDisplayNames, resolveRuntimeAgentName } from "./runtime-agent-display";
import { type RuntimeAgentThemes, resolveSubagentRowThemeStyle } from "./runtime-agent-theme";
import type { ThreadRunProjectionSubagentCard } from "./thread-run-projection-view";
import { formatSubagentTaskNameLabel } from "../shared/subagent-task-name";
import { WorkspaceGitCommitGraph } from "./WorkspaceGitCommitGraph";
import { WorkspaceGitSection } from "./WorkspaceGitSection";
import { persistCardExpanded, readCardExpanded } from "./workspace-floating-card-storage";
import { resolveWorkspacePlanTitle } from "./workspace-plan-title";

export interface ThreadUsageSummary {
  billing?: ThreadBillingSnapshot;
  context?: ThreadContextSnapshot;
  contextTokens?: number;
}

export interface WorkspaceFloatingCardsProps {
  workspace?: WorkspaceInfo;
  workspacePath?: string;
  workspaceLabel?: string;
  gitStatus?: GitWorkingTreeStatus;
  gitBusy?: boolean;
  commitDisabled?: boolean;
  mainAgentConfigId?: string;
  defaultCommitCandidateModelId?: string;
  gitSettings?: GitSettingsSnapshot;
  onCheckoutGitBranch?: (branch: string) => void | Promise<void>;
  onCreateGitBranch?: (branch: string) => void | Promise<void>;
  onOpenGitSettings?: () => void;
  onSaveCommitModelPreference?: (candidateModelId: string) => void | Promise<void>;
  onCommitSuccess?: () => void | Promise<void>;
  onPushSuccess?: () => void | Promise<void>;
  onOpenChangesReview?: () => void;
  onChangesDiffLoaded?: (diff: import("../shared/ipc").WorkspaceDiffResult) => void | Promise<void>;
  onChangesDiffLoadingChange?: (loading: boolean) => void;
  onChangesDiffError?: (error?: string) => void;
  onPullSuccess?: () => void | Promise<void>;
  onResolveConflictsWithAgent?: (conflictFiles: string[]) => void | Promise<void>;
  onRefreshGitStatus?: (force?: boolean) => void | Promise<void>;
  scriptsDisabled?: boolean;
  onOpenScriptsDialog?: () => void;
  todos?: CoderTodoItem[];
  threadStatus?: ThreadStatus;
  hasActiveThread?: boolean;
  agentModelLabels?: ComposerAgentModelLabel[];
  composerRuntimeConfig?: ThreadRuntimeConfig;
  subagentEnabled?: SubagentEnabledSettings;
  canEditComposerConfig?: boolean;
  isSavingSettings?: boolean;
  mcpServers?: readonly McpServerConfigView[];
  composerMcpSettings?: McpServersEnabledSettings;
  skills?: readonly SkillInfo[];
  composerSkillsEnabled?: SkillsEnabledSettings;
  onToggleComposerSubagent?: (role: SubagentRole, enabled: boolean) => void | Promise<void>;
  onToggleComposerMcpServer?: (serverKey: string, enabled: boolean) => void | Promise<void>;
  onToggleComposerSkill?: (settingsKey: string, enabled: boolean) => void | Promise<void>;
  approvedPlan?: ThreadPendingPlan;
  onOpenPlan?: () => void;
  browserInstances?: readonly WorkspaceBrowserInstance[];
  onOpenBrowser?: (browserId: string) => void;
  imageArtifacts?: readonly ImageGenerationArtifact[];
  onOpenImageArtifact?: (artifactId: string) => void;
  subagentRunCards?: readonly ThreadRunProjectionSubagentCard[];
  selectedSubagentAgentId?: string;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  agentThemes?: RuntimeAgentThemes;
  onOpenSubagent?: (agentId: string) => void;
}

/** Open built-in browser surfaces listed in the workspace cards panel. */
export interface WorkspaceBrowserInstance {
  id: string;
  title: string;
  url: string;
  faviconUrl?: string;
}

function BrowserFavicon({
  faviconUrl,
  title,
}: {
  faviconUrl?: string;
  title: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!faviconUrl || failed) {
    return <Globe size={16} strokeWidth={1.75} />;
  }
  return (
    <img
      className="workspace-resource-row-favicon"
      src={faviconUrl}
      alt=""
      title={title}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

function hasProgressInfo(todos: CoderTodoItem[]): boolean {
  return todos.some(
    (todo) => todo.status === "pending" || todo.status === "running" || todo.status === "blocked",
  );
}

function countRunningTodos(todos: CoderTodoItem[]): number {
  return todos.filter((todo) => todo.status === "running").length;
}

function subagentRoleLabel(role: string, displayNames?: RuntimeAgentDisplayNames): string {
  return resolveRuntimeAgentName(role, displayNames) ?? resolveSubagentRunDisplayTitle(role);
}

function WorkspacePanelSection({
  id,
  title,
  summary,
  children,
  defaultExpanded = true,
  persistExpanded = true,
  maxBodyHeight = 360,
  onExpandedChange,
}: {
  id: string;
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  defaultExpanded?: boolean;
  persistExpanded?: boolean;
  maxBodyHeight?: number;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(() =>
    persistExpanded ? readCardExpanded(id, defaultExpanded) : defaultExpanded,
  );
  const bodyId = `${id}-body`;

  function toggleExpanded() {
    setExpanded((current) => {
      const next = !current;
      if (persistExpanded) {
        persistCardExpanded(id, next);
      }
      onExpandedChange?.(next);
      return next;
    });
  }

  return (
    <section className={`workspace-panel-section${expanded ? " is-expanded" : " is-collapsed"}`}>
      <button
        type="button"
        className="workspace-panel-section-header"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <span className="workspace-panel-section-title">{title}</span>
        {summary ? <span className="workspace-panel-section-summary">{summary}</span> : null}
        <ChevronDown size={14} className="workspace-panel-section-chevron" aria-hidden />
      </button>
      {expanded ? (
        <div
          id={bodyId}
          className="workspace-panel-section-body floating-workspace-card-body"
          style={maxBodyHeight > 0 ? { maxHeight: maxBodyHeight } : undefined}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function isExploreOnlyEnabled(
  labels: readonly ComposerAgentModelLabel[],
  settings: SubagentEnabledSettings | null | undefined,
): boolean {
  const enabled = labels.filter(({ subagentRole }) => !subagentRole || !settings || settings[subagentRole]);
  return enabled.length === 1 && enabled[0]?.role === "explore";
}

function SubagentRunsCardBody({
  cards,
  selectedAgentId,
  agentDisplayNames,
  agentThemes,
  onOpenSubagent,
}: {
  cards: readonly ThreadRunProjectionSubagentCard[];
  selectedAgentId?: string;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  agentThemes?: RuntimeAgentThemes;
  onOpenSubagent?: (agentId: string) => void;
}) {
  return (
    <div className="workspace-subagent-runs-list">
      {cards.map((card) => {
        const roleLabel = subagentRoleLabel(card.agent.role, agentDisplayNames);
        const titleLabel = card.agent.nickname?.trim() || roleLabel;
        const taskLabel = card.agent.taskName
          ? formatSubagentTaskNameLabel(card.agent.taskName)
          : "";
        return (
          <button
            key={card.key}
            type="button"
            className={`workspace-subagent-run-item${selectedAgentId === card.key ? " is-active" : ""}`}
            style={resolveSubagentRowThemeStyle(card.agent.role, agentThemes)}
            onClick={() => onOpenSubagent?.(card.key)}
            aria-pressed={selectedAgentId === card.key}
            title={taskLabel || titleLabel}
          >
            <span className="workspace-subagent-run-avatar" aria-hidden>
              <Bot size={14} strokeWidth={1.75} />
            </span>
            <span className="workspace-subagent-run-main">
              <span className="workspace-subagent-run-name">{titleLabel}</span>
              {taskLabel ? <span className="workspace-subagent-run-mission">{taskLabel}</span> : null}
            </span>
            {card.running ? <span className="workspace-subagent-run-live" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

function PlanWorkspaceCardBody({ plan, onOpenPlan }: { plan: ThreadPendingPlan; onOpenPlan?: () => void }) {
  const { t } = useTranslation();
  const title = resolveWorkspacePlanTitle({
    plan: plan.plan,
    userPrompt: plan.userPrompt,
    fallback: t("workspaceCards.approvedPlan"),
  });

  return (
    <button
      type="button"
      className="workspace-resource-row workspace-plan-card-trigger"
      onClick={onOpenPlan}
      disabled={!onOpenPlan}
      title={t("workspaceCards.openFullPlan")}
    >
      <span className="workspace-resource-row-icon" aria-hidden>
        <Lightbulb size={16} strokeWidth={1.75} />
      </span>
      <span className="workspace-resource-row-title">{title}</span>
    </button>
  );
}

function BrowserWorkspaceCardBody({
  instances,
  onOpenBrowser,
}: {
  instances: readonly WorkspaceBrowserInstance[];
  onOpenBrowser?: (browserId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="workspace-resource-list">
      {instances.map((instance) => {
        const host = webChatHostname(instance.url);
        const title =
          instance.title.trim() &&
          instance.title.trim() !== "about:blank" &&
          instance.url.trim() !== "about:blank"
            ? instance.title.trim()
            : host || t("browser.title");
        const showHost = Boolean(host) && host !== title && instance.url.trim() !== "about:blank";
        return (
          <button
            key={instance.id}
            type="button"
            className="workspace-resource-row workspace-browser-card-trigger"
            onClick={() => onOpenBrowser?.(instance.id)}
            disabled={!onOpenBrowser}
            title={showHost ? `${title} · ${host}` : title}
          >
            <span className="workspace-resource-row-icon" aria-hidden>
              <BrowserFavicon
                {...(instance.faviconUrl ? { faviconUrl: instance.faviconUrl } : {})}
                title={title}
              />
            </span>
            <span className="workspace-resource-row-title">{title}</span>
            {showHost ? <span className="workspace-resource-row-meta">{host}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function ImageGenerationWorkspaceCardBody({
  artifacts,
  onOpenImageArtifact,
}: {
  artifacts: readonly ImageGenerationArtifact[];
  onOpenImageArtifact?: (artifactId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="workspace-resource-list workspace-image-artifact-list">
      {artifacts.map((artifact) => {
        const prompt = artifact.prompt.trim() || t("task.image.title");
        const status = t(`task.image.status.${artifact.status}`);
        const meta = [status, artifact.model].filter(Boolean).join(" · ");
        return (
          <button
            key={artifact.id}
            type="button"
            className="workspace-resource-row workspace-image-artifact-trigger"
            onClick={() => onOpenImageArtifact?.(artifact.id)}
            disabled={!onOpenImageArtifact}
            title={prompt}
          >
            <span className="workspace-resource-row-icon" aria-hidden>
              <ImageIcon size={16} strokeWidth={1.75} />
            </span>
            <span className="workspace-resource-row-title">{prompt}</span>
            <span className="workspace-resource-row-meta">{meta}</span>
          </button>
        );
      })}
    </div>
  );
}

export function WorkspaceFloatingCards({
  workspace,
  workspacePath,
  workspaceLabel,
  gitStatus,
  gitBusy,
  commitDisabled,
  mainAgentConfigId,
  defaultCommitCandidateModelId,
  gitSettings,
  onCheckoutGitBranch,
  onCreateGitBranch,
  onOpenGitSettings,
  onSaveCommitModelPreference,
  onCommitSuccess,
  onPushSuccess,
  onOpenChangesReview,
  onChangesDiffLoaded,
  onChangesDiffLoadingChange,
  onChangesDiffError,
  onPullSuccess,
  onResolveConflictsWithAgent,
  onRefreshGitStatus,
  scriptsDisabled,
  onOpenScriptsDialog,
  todos = [],
  hasActiveThread = false,
  agentModelLabels = [],
  composerRuntimeConfig,
  subagentEnabled,
  canEditComposerConfig,
  isSavingSettings,
  mcpServers = [],
  composerMcpSettings,
  skills = [],
  composerSkillsEnabled,
  onToggleComposerSubagent,
  onToggleComposerMcpServer,
  onToggleComposerSkill,
  approvedPlan,
  onOpenPlan,
  browserInstances = [],
  onOpenBrowser,
  imageArtifacts = [],
  onOpenImageArtifact,
  subagentRunCards = [],
  selectedSubagentAgentId,
  agentDisplayNames,
  agentThemes,
  onOpenSubagent,
}: WorkspaceFloatingCardsProps) {
  const { t } = useTranslation();
  const projectLabel =
    workspaceLabel?.trim() ||
    workspacePath?.split("/").filter(Boolean).pop() ||
    workspace?.name ||
    t("workspaceCards.noProject");
  const showProgress = hasProgressInfo(todos);
  const [commitsRefreshKey, setCommitsRefreshKey] = useState(0);
  const showCommitGraph = Boolean(workspacePath && gitStatus?.isGitRepository && gitStatus.hasGitCommits);
  const branchLabel = gitStatus?.branch ?? "—";
  const insertions = gitStatus?.insertions ?? 0;
  const deletions = gitStatus?.deletions ?? 0;
  const enabledMcpCount = composerMcpSettings ? countEnabledMcpServers(composerMcpSettings) : 0;
  const enabledMcpServers = mcpServers.filter((server) => server.enabled && server.name.trim());
  const enabledSkillsCount = skills.filter(
    (skill) => composerSkillsEnabled?.[skill.settingsKey ?? skill.skillFilePath],
  ).length;
  const subagentLabels = agentModelLabels.filter((label) => !label.main);
  const subagentSettings = composerRuntimeConfig?.subagentEnabled ?? subagentEnabled;
  const composerConfigEditableInWorkspace = Boolean(canEditComposerConfig);
  const enabledSubagents = subagentLabels.filter(
    ({ subagentRole }) => !subagentRole || !subagentSettings || subagentSettings[subagentRole],
  ).length;
  const exploreOnlyEnabled = isExploreOnlyEnabled(subagentLabels, subagentSettings);

  async function handleCommitSuccess() {
    setCommitsRefreshKey((current) => current + 1);
    await onCommitSuccess?.();
  }

  async function handlePullSuccess() {
    setCommitsRefreshKey((current) => current + 1);
    await onPullSuccess?.();
  }

  return (
    <section
      className="workspace-floating-cards"
      aria-label={t("workspaceCards.workspacePanels", { project: projectLabel })}
    >
      <div className="workspace-floating-cards-sections">
        <WorkspacePanelSection
          id="workspace-env"
          title={t("workspaceCards.environment")}
          defaultExpanded
          summary={
            <>
              <GitBranch size={14} aria-hidden />
              <span>{branchLabel}</span>
              <span className="floating-workspace-card-bubble-stats">
                <span className="git-commit-stat-add">+{insertions}</span>
                <span className="git-commit-stat-del">-{deletions}</span>
              </span>
            </>
          }
          onExpandedChange={() => void onRefreshGitStatus?.(false)}
        >
          <WorkspaceGitSection
            {...(workspacePath && { workspacePath })}
            workspaceLabel={projectLabel}
            {...(gitStatus && { gitStatus })}
            gitBusy={gitBusy ?? false}
            commitDisabled={commitDisabled ?? false}
            {...(mainAgentConfigId && { mainAgentConfigId })}
            {...(defaultCommitCandidateModelId && { defaultCommitCandidateModelId })}
            {...(gitSettings && { gitSettings })}
            {...(onCheckoutGitBranch && { onCheckoutGitBranch })}
            {...(onCreateGitBranch && { onCreateGitBranch })}
            {...(onOpenGitSettings && { onOpenGitSettings })}
            {...(onSaveCommitModelPreference && { onSaveCommitModelPreference })}
            onCommitSuccess={() => void handleCommitSuccess()}
            {...(onPushSuccess && { onPushSuccess })}
            {...(onOpenChangesReview && { onOpenChangesReview })}
            {...(onChangesDiffLoaded && { onChangesDiffLoaded })}
            {...(onChangesDiffLoadingChange && { onChangesDiffLoadingChange })}
            {...(onChangesDiffError && { onChangesDiffError })}
            onPullSuccess={() => void handlePullSuccess()}
            {...(onResolveConflictsWithAgent && { onResolveConflictsWithAgent })}
            {...(onRefreshGitStatus && { onRefreshGitStatus })}
            {...(scriptsDisabled !== undefined && { scriptsDisabled })}
            {...(onOpenScriptsDialog && { onOpenScriptsDialog })}
          />
        </WorkspacePanelSection>

        {hasActiveThread && subagentRunCards.length > 0 ? (
          <WorkspacePanelSection
            id="workspace-subagent-runs"
            title={t("workspaceCards.subagents")}
            defaultExpanded
            summary={
              <>
                <Bot size={14} aria-hidden />
                <span>{subagentRunCards.length}</span>
              </>
            }
            maxBodyHeight={260}
          >
            <SubagentRunsCardBody
              cards={subagentRunCards}
              {...(selectedSubagentAgentId && { selectedAgentId: selectedSubagentAgentId })}
              {...(agentDisplayNames && { agentDisplayNames })}
              {...(agentThemes && { agentThemes })}
              {...(onOpenSubagent && { onOpenSubagent })}
            />
          </WorkspacePanelSection>
        ) : null}

        {approvedPlan ? (
          <WorkspacePanelSection
            id="workspace-approved-plan"
            title={t("workspaceCards.plan")}
            defaultExpanded
            maxBodyHeight={120}
          >
            <PlanWorkspaceCardBody plan={approvedPlan} {...(onOpenPlan && { onOpenPlan })} />
          </WorkspacePanelSection>
        ) : null}

        {browserInstances.length > 0 ? (
          <WorkspacePanelSection
            id="workspace-browser-tabs"
            title={t("workspaceCards.browser")}
            defaultExpanded
            maxBodyHeight={220}
          >
            <BrowserWorkspaceCardBody
              instances={browserInstances}
              {...(onOpenBrowser && { onOpenBrowser })}
            />
          </WorkspacePanelSection>
        ) : null}

        {showProgress ? (
          <WorkspacePanelSection
            id="workspace-progress"
            title={t("workspaceCards.progress")}
            defaultExpanded
            summary={
              <>
                <ListTodo size={14} aria-hidden />
                <span>{t("workspaceCards.runningTodos", { count: countRunningTodos(todos) })}</span>
              </>
            }
            maxBodyHeight={280}
          >
            <CoderTodoPanel todos={todos} embedded compact />
          </WorkspacePanelSection>
        ) : null}

        {imageArtifacts.length > 0 ? (
          <WorkspacePanelSection
            id="workspace-image-artifacts"
            title={t("task.image.history")}
            defaultExpanded
            summary={
              <>
                <ImageIcon size={14} aria-hidden />
                <span>{imageArtifacts.length}</span>
              </>
            }
            maxBodyHeight={280}
          >
            <ImageGenerationWorkspaceCardBody
              artifacts={imageArtifacts}
              {...(onOpenImageArtifact && { onOpenImageArtifact })}
            />
          </WorkspacePanelSection>
        ) : null}

        {hasActiveThread && subagentLabels.length > 0 ? (
          <WorkspacePanelSection
            id="workspace-agents"
            title={t("workspaceCards.orchestration")}
            defaultExpanded={!exploreOnlyEnabled}
            summary={
              <>
                <Users size={14} aria-hidden />
                <span>
                  {enabledSubagents}/{subagentLabels.length}
                </span>
              </>
            }
            maxBodyHeight={320}
          >
            <ComposerAgentModelsCardBody
              embedded
              labels={agentModelLabels}
              subagentSettings={subagentSettings ?? null}
              canEditSubagents={composerConfigEditableInWorkspace}
              {...(isSavingSettings !== undefined && { subagentSaving: isSavingSettings })}
              {...(onToggleComposerSubagent && { onToggleSubagent: onToggleComposerSubagent })}
            />
          </WorkspacePanelSection>
        ) : null}

        {hasActiveThread && enabledMcpServers.length > 0 && composerMcpSettings ? (
          <WorkspacePanelSection
            id="workspace-mcp"
            title={t("settings.mcp.title")}
            defaultExpanded={enabledMcpCount > 0}
            summary={
              <>
                <Plug size={14} aria-hidden />
                <span>
                  {enabledMcpCount}/{enabledMcpServers.length}
                </span>
              </>
            }
            maxBodyHeight={280}
          >
            <ComposerMcpCardBody
              servers={mcpServers}
              enabledSettings={composerMcpSettings}
              canEdit={composerConfigEditableInWorkspace}
              {...(isSavingSettings !== undefined && { saving: isSavingSettings })}
              {...(onToggleComposerMcpServer && { onToggleServer: onToggleComposerMcpServer })}
            />
          </WorkspacePanelSection>
        ) : null}

        {hasActiveThread && skills.length > 0 && composerSkillsEnabled ? (
          <WorkspacePanelSection
            id="workspace-skills"
            title={t("composer.skills.title")}
            defaultExpanded={false}
            summary={
              <>
                <Sparkles size={14} aria-hidden />
                <span>
                  {enabledSkillsCount}/{skills.length}
                </span>
              </>
            }
            maxBodyHeight={320}
          >
            <ComposerSkillsCardBody
              skills={skills}
              enabledSettings={composerSkillsEnabled}
              canEdit={composerConfigEditableInWorkspace}
              {...(isSavingSettings !== undefined && { saving: isSavingSettings })}
              {...(onToggleComposerSkill && { onToggleSkill: onToggleComposerSkill })}
            />
          </WorkspacePanelSection>
        ) : null}

        {showCommitGraph && workspacePath ? (
          <WorkspacePanelSection
            id="workspace-git-graph"
            title={t("workspaceCards.gitGraph")}
            defaultExpanded={false}
            persistExpanded={false}
            summary={
              <>
                <GitCommitHorizontal size={14} aria-hidden />
                <span className="floating-workspace-card-bubble-detail">{branchLabel}</span>
              </>
            }
            maxBodyHeight={300}
          >
            <WorkspaceGitCommitGraph
              workspacePath={workspacePath}
              refreshToken={`${commitsRefreshKey}:${gitStatus?.branch ?? ""}`}
              embedded
            />
          </WorkspacePanelSection>
        ) : null}
      </div>
    </section>
  );
}
