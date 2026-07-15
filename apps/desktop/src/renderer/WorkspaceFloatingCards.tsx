import { resolveMissionDisplayText } from "@eco/runtime/agent-mission";
import {
  Bot,
  ChevronDown,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  ListTodo,
  PanelRightOpen,
  Plug,
  Users,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { countEnabledMcpServers } from "../shared/composer-mcp";
import type {
  CoderTodoItem,
  GitSettingsSnapshot,
  GitWorkingTreeStatus,
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
import type { McpServersEnabledSettings } from "../shared/thread-runtime-config";
import { resolveSubagentRunDisplayTitle, thinkingPreviewLine } from "./activity-log";
import { CoderTodoPanel } from "./CoderTodoPanel";
import { ComposerAgentModelsCardBody } from "./ComposerAgentModels";
import { ComposerMcpCardBody } from "./ComposerMcpServers";
import type { ComposerAgentModelLabel } from "./composer-agent-model-labels";
import { type RuntimeAgentDisplayNames, resolveRuntimeAgentName } from "./runtime-agent-display";
import { type RuntimeAgentThemes, resolveSubagentRowThemeStyle } from "./runtime-agent-theme";
import type { ThreadRunProjectionSubagentCard } from "./thread-run-projection-view";
import { WorkspaceGitCommitGraph } from "./WorkspaceGitCommitGraph";
import { WorkspaceGitSection } from "./WorkspaceGitSection";
import { persistCardExpanded, readCardExpanded } from "./workspace-floating-card-storage";

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
  profileId?: string;
  gitSettings?: GitSettingsSnapshot;
  onCheckoutGitBranch?: (branch: string) => void | Promise<void>;
  onCreateGitBranch?: (branch: string) => void | Promise<void>;
  onOpenGitSettings?: () => void;
  onSaveCommitModelPreference?: (candidateModelId: string) => void | Promise<void>;
  onCommitSuccess?: () => void | Promise<void>;
  onOpenChangesReview?: () => void;
  onChangesDiffLoaded?: (diff: import("../shared/ipc").WorkspaceDiffResult) => void | Promise<void>;
  onChangesDiffLoadingChange?: (loading: boolean) => void;
  onChangesDiffError?: (error?: string) => void;
  onPullSuccess?: () => void | Promise<void>;
  onResolveConflictsWithAgent?: (conflictFiles: string[]) => void | Promise<void>;
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
  onToggleComposerSubagent?: (role: SubagentRole, enabled: boolean) => void | Promise<void>;
  onToggleComposerMcpServer?: (serverKey: string, enabled: boolean) => void | Promise<void>;
  approvedPlan?: ThreadPendingPlan;
  onOpenPlan?: () => void;
  subagentRunCards?: readonly ThreadRunProjectionSubagentCard[];
  selectedSubagentAgentId?: string;
  agentDisplayNames?: RuntimeAgentDisplayNames;
  agentThemes?: RuntimeAgentThemes;
  onOpenSubagent?: (agentId: string) => void;
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
}: {
  id: string;
  title: string;
  summary: ReactNode;
  children: ReactNode;
  defaultExpanded?: boolean;
  persistExpanded?: boolean;
  maxBodyHeight?: number;
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
        <span className="workspace-panel-section-summary">{summary}</span>
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
        const missionText = card.missionText
          ? thinkingPreviewLine(resolveMissionDisplayText(card.missionText), 92)
          : (card.statusText ?? "");
        return (
          <button
            key={card.key}
            type="button"
            className={`workspace-subagent-run-item${selectedAgentId === card.key ? " is-active" : ""}`}
            style={resolveSubagentRowThemeStyle(card.agent.role, agentThemes)}
            onClick={() => onOpenSubagent?.(card.key)}
            aria-pressed={selectedAgentId === card.key}
            title={missionText || roleLabel}
          >
            <span className="workspace-subagent-run-avatar" aria-hidden>
              <Bot size={16} />
            </span>
            <span className="workspace-subagent-run-main">
              <span className="workspace-subagent-run-name">{roleLabel}</span>
              {missionText ? <span className="workspace-subagent-run-mission">{missionText}</span> : null}
            </span>
            {card.running ? <span className="workspace-subagent-run-live" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

function PlanWorkspaceCardBody({ plan, onOpenPlan }: { plan: ThreadPendingPlan; onOpenPlan?: () => void }) {
  const preview = thinkingPreviewLine(resolveMissionDisplayText(plan.plan), 150);
  const planPath = plan.planFilePath?.trim();

  return (
    <button
      type="button"
      className="workspace-plan-card-trigger"
      onClick={onOpenPlan}
      disabled={!onOpenPlan}
      title="在右侧面板查看完整计划"
    >
      <span className="workspace-plan-card-main">
        <span className="workspace-plan-card-title">已批准计划</span>
        {planPath ? <span className="workspace-plan-card-path">{planPath}</span> : null}
        <span className="workspace-plan-card-preview">{preview || "打开右侧面板查看完整实施计划"}</span>
      </span>
      <PanelRightOpen size={15} className="workspace-plan-card-icon" aria-hidden />
    </button>
  );
}

export function WorkspaceFloatingCards({
  workspace,
  workspacePath,
  workspaceLabel,
  gitStatus,
  gitBusy,
  commitDisabled,
  profileId,
  gitSettings,
  onCheckoutGitBranch,
  onCreateGitBranch,
  onOpenGitSettings,
  onSaveCommitModelPreference,
  onCommitSuccess,
  onOpenChangesReview,
  onChangesDiffLoaded,
  onChangesDiffLoadingChange,
  onChangesDiffError,
  onPullSuccess,
  onResolveConflictsWithAgent,
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
  onToggleComposerSubagent,
  onToggleComposerMcpServer,
  approvedPlan,
  onOpenPlan,
  subagentRunCards = [],
  selectedSubagentAgentId,
  agentDisplayNames,
  agentThemes,
  onOpenSubagent,
}: WorkspaceFloatingCardsProps) {
  const projectLabel =
    workspaceLabel?.trim() ||
    workspacePath?.split("/").filter(Boolean).pop() ||
    workspace?.name ||
    "未打开项目";
  const showProgress = hasProgressInfo(todos);
  const [commitsRefreshKey, setCommitsRefreshKey] = useState(0);
  const showCommitGraph = Boolean(workspacePath && gitStatus?.isGitRepository && gitStatus.hasGitCommits);
  const branchLabel = gitStatus?.branch ?? "—";
  const insertions = gitStatus?.insertions ?? 0;
  const deletions = gitStatus?.deletions ?? 0;
  const enabledMcpCount = composerMcpSettings ? countEnabledMcpServers(composerMcpSettings) : 0;
  const enabledMcpServers = mcpServers.filter((server) => server.enabled && server.name.trim());
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
    <section className="workspace-floating-cards" aria-label={`${projectLabel} 工作区面板`}>
      <div className="workspace-floating-cards-sections">
        <WorkspacePanelSection
          id="workspace-env"
          title="环境信息"
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
        >
          <WorkspaceGitSection
            {...(workspacePath && { workspacePath })}
            workspaceLabel={projectLabel}
            {...(gitStatus && { gitStatus })}
            gitBusy={gitBusy ?? false}
            commitDisabled={commitDisabled ?? false}
            {...(profileId && { profileId })}
            {...(gitSettings && { gitSettings })}
            {...(onCheckoutGitBranch && { onCheckoutGitBranch })}
            {...(onCreateGitBranch && { onCreateGitBranch })}
            {...(onOpenGitSettings && { onOpenGitSettings })}
            {...(onSaveCommitModelPreference && { onSaveCommitModelPreference })}
            onCommitSuccess={() => void handleCommitSuccess()}
            {...(onOpenChangesReview && { onOpenChangesReview })}
            {...(onChangesDiffLoaded && { onChangesDiffLoaded })}
            {...(onChangesDiffLoadingChange && { onChangesDiffLoadingChange })}
            {...(onChangesDiffError && { onChangesDiffError })}
            onPullSuccess={() => void handlePullSuccess()}
            {...(onResolveConflictsWithAgent && { onResolveConflictsWithAgent })}
            {...(scriptsDisabled !== undefined && { scriptsDisabled })}
            {...(onOpenScriptsDialog && { onOpenScriptsDialog })}
          />
        </WorkspacePanelSection>

        {hasActiveThread && subagentRunCards.length > 0 ? (
          <WorkspacePanelSection
            id="workspace-subagent-runs"
            title="子智能体"
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
            title="实施计划"
            defaultExpanded
            summary={
              <>
                <FileText size={14} aria-hidden />
                <span>已批准</span>
              </>
            }
            maxBodyHeight={220}
          >
            <PlanWorkspaceCardBody plan={approvedPlan} {...(onOpenPlan && { onOpenPlan })} />
          </WorkspacePanelSection>
        ) : null}

        {showProgress ? (
          <WorkspacePanelSection
            id="workspace-progress"
            title="任务进度"
            defaultExpanded
            summary={
              <>
                <ListTodo size={14} aria-hidden />
                <span>{countRunningTodos(todos)} 项进行中</span>
              </>
            }
            maxBodyHeight={280}
          >
            <CoderTodoPanel todos={todos} embedded compact />
          </WorkspacePanelSection>
        ) : null}

        {hasActiveThread && agentModelLabels.length > 0 ? (
          <WorkspacePanelSection
            id="workspace-agents"
            title="智能体编排"
            defaultExpanded={!exploreOnlyEnabled}
            summary={
              <>
                <Users size={14} aria-hidden />
                <span>
                  {subagentLabels.length > 0
                    ? `${enabledSubagents}/${subagentLabels.length}`
                    : String(agentModelLabels.length)}
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
            title="MCP"
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

        {showCommitGraph && workspacePath ? (
          <WorkspacePanelSection
            id="workspace-git-graph"
            title="Git 图形"
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
