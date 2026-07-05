import { resolveMissionDisplayText } from "@eco/runtime";
import { Bot, GitBranch, GitCommitHorizontal, ListTodo, Plug, Users } from "lucide-react";
import { useState } from "react";
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
import { FloatingWorkspaceCard } from "./FloatingWorkspaceCard";
import { type RuntimeAgentDisplayNames, resolveRuntimeAgentName } from "./runtime-agent-display";
import { type RuntimeAgentThemes, resolveSubagentRowThemeStyle } from "./runtime-agent-theme";
import type { ThreadRunProjectionSubagentCard } from "./thread-run-projection-view";
import { WorkspaceGitCommitGraph } from "./WorkspaceGitCommitGraph";
import { WorkspaceGitSection } from "./WorkspaceGitSection";

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
  const enabledSubagents = subagentLabels.filter(
    ({ subagentRole }) => !subagentRole || !subagentSettings || subagentSettings[subagentRole],
  ).length;

  async function handleCommitSuccess() {
    setCommitsRefreshKey((current) => current + 1);
    await onCommitSuccess?.();
  }

  async function handlePullSuccess() {
    setCommitsRefreshKey((current) => current + 1);
    await onPullSuccess?.();
  }

  return (
    <div className="workspace-floating-cards">
      <FloatingWorkspaceCard
        id="workspace-env"
        title="环境信息"
        defaultExpanded
        bubble={
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
      </FloatingWorkspaceCard>

      {hasActiveThread && subagentRunCards.length > 0 ? (
        <FloatingWorkspaceCard
          id="workspace-subagent-runs"
          title="子智能体"
          defaultExpanded
          bubble={
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
            agentDisplayNames={agentDisplayNames}
            agentThemes={agentThemes}
            onOpenSubagent={onOpenSubagent}
          />
        </FloatingWorkspaceCard>
      ) : null}

      {showProgress ? (
        <FloatingWorkspaceCard
          id="workspace-progress"
          title="任务进度"
          defaultExpanded
          bubble={
            <>
              <ListTodo size={14} aria-hidden />
              <span>{countRunningTodos(todos)} 项进行中</span>
            </>
          }
          maxBodyHeight={280}
        >
          <CoderTodoPanel todos={todos} embedded compact />
        </FloatingWorkspaceCard>
      ) : null}

      {hasActiveThread && agentModelLabels.length > 0 ? (
        <FloatingWorkspaceCard
          id="workspace-agents"
          title="子代理"
          defaultExpanded
          bubble={
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
            canEditSubagents={Boolean(canEditComposerConfig)}
            {...(isSavingSettings !== undefined && { subagentSaving: isSavingSettings })}
            {...(onToggleComposerSubagent && { onToggleSubagent: onToggleComposerSubagent })}
          />
        </FloatingWorkspaceCard>
      ) : null}

      {hasActiveThread && enabledMcpServers.length > 0 && composerMcpSettings ? (
        <FloatingWorkspaceCard
          id="workspace-mcp"
          title="MCP"
          defaultExpanded={false}
          bubble={
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
            canEdit={Boolean(canEditComposerConfig)}
            {...(isSavingSettings !== undefined && { saving: isSavingSettings })}
            {...(onToggleComposerMcpServer && { onToggleServer: onToggleComposerMcpServer })}
          />
        </FloatingWorkspaceCard>
      ) : null}

      {showCommitGraph && workspacePath ? (
        <FloatingWorkspaceCard
          id="workspace-git-graph"
          title="Git 图形"
          defaultExpanded={false}
          bubble={
            <>
              <GitCommitHorizontal size={14} aria-hidden />
              <span>Git 图形</span>
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
        </FloatingWorkspaceCard>
      ) : null}
    </div>
  );
}
