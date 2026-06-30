import { GitBranch, GitCommitHorizontal, ListTodo, Plug, Users } from "lucide-react";
import { useState } from "react";
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
import { countEnabledMcpServers } from "../shared/composer-mcp";
import { CoderTodoPanel } from "./CoderTodoPanel";
import { ComposerAgentModelsCardBody } from "./ComposerAgentModels";
import { ComposerMcpCardBody } from "./ComposerMcpServers";
import { FloatingWorkspaceCard } from "./FloatingWorkspaceCard";
import { WorkspaceGitCommitGraph } from "./WorkspaceGitCommitGraph";
import { WorkspaceGitSection } from "./WorkspaceGitSection";
import type { ComposerAgentModelLabel } from "./composer-agent-model-labels";

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
  onChangesDiffLoaded?: (diff: import("../shared/ipc").WorkspaceDiffResult) => void | Promise<void>;
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
}

function hasProgressInfo(todos: CoderTodoItem[]): boolean {
  return todos.some(
    (todo) => todo.status === "pending" || todo.status === "running" || todo.status === "blocked",
  );
}

function countRunningTodos(todos: CoderTodoItem[]): number {
  return todos.filter((todo) => todo.status === "running").length;
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
  onChangesDiffLoaded,
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
}: WorkspaceFloatingCardsProps) {
  const projectLabel =
    workspaceLabel?.trim() ||
    workspacePath?.split("/").filter(Boolean).pop() ||
    workspace?.name ||
    "未打开项目";
  const showProgress = hasProgressInfo(todos);
  const [commitsRefreshKey, setCommitsRefreshKey] = useState(0);
  const showCommitGraph = Boolean(
    workspacePath && gitStatus?.isGitRepository && gitStatus.hasGitCommits,
  );
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
    <div className="workspace-floating-cards" aria-label="工作区悬浮卡片">
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
          {...(onChangesDiffLoaded && { onChangesDiffLoaded })}
          onPullSuccess={() => void handlePullSuccess()}
          {...(onResolveConflictsWithAgent && { onResolveConflictsWithAgent })}
          {...(scriptsDisabled !== undefined && { scriptsDisabled })}
          {...(onOpenScriptsDialog && { onOpenScriptsDialog })}
        />
      </FloatingWorkspaceCard>

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

      {showCommitGraph ? (
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
            workspacePath={workspacePath!}
            refreshToken={`${commitsRefreshKey}:${gitStatus?.branch ?? ""}`}
            embedded
          />
        </FloatingWorkspaceCard>
      ) : null}
    </div>
  );
}
