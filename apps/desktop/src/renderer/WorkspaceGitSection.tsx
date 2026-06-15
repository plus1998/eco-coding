import { ChevronDown, GitBranch, GitCommitHorizontal, Laptop, PlusSquare } from "lucide-react";
import { useState } from "react";
import type {
  GitSettingsSnapshot,
  GitWorkingTreeStatus,
  RoutePricingHint,
  RuntimeRoleRouteConfig,
  SubagentEnabledSettings,
  RuntimeAgentRole,
} from "../shared/ipc";
import type { ComposerAgentModelLabel } from "./composer-agent-model-labels";
import { GitCommitDialog } from "./GitCommitDialog";

export interface WorkspaceGitSectionProps {
  workspacePath?: string;
  workspaceLabel: string;
  gitStatus?: GitWorkingTreeStatus;
  gitBusy?: boolean;
  commitDisabled?: boolean;
  profileId?: string;
  agentModelLabels?: ComposerAgentModelLabel[];
  routes?: readonly RuntimeRoleRouteConfig[];
  routePricingHints?: RoutePricingHint[];
  subagentEnabled?: SubagentEnabledSettings;
  gitSettings?: GitSettingsSnapshot;
  onCheckoutGitBranch?: (branch: string) => void | Promise<void>;
  onOpenGitSettings?: () => void;
  onSaveCommitRolePreference?: (role: RuntimeAgentRole | "auto") => void | Promise<void>;
  onCommitSuccess?: () => void | Promise<void>;
}

export function WorkspaceGitSection({
  workspacePath,
  workspaceLabel,
  gitStatus,
  gitBusy,
  commitDisabled,
  profileId,
  agentModelLabels = [],
  routes = [],
  routePricingHints = [],
  subagentEnabled,
  gitSettings,
  onCheckoutGitBranch,
  onSaveCommitRolePreference,
  onCommitSuccess,
}: WorkspaceGitSectionProps) {
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);

  const showCommitEntry = Boolean(
    workspacePath &&
      profileId &&
      gitSettings &&
      subagentEnabled &&
      onSaveCommitRolePreference &&
      onCommitSuccess &&
      gitStatus?.isGitRepository,
  );

  const insertions = gitStatus?.insertions ?? 0;
  const deletions = gitStatus?.deletions ?? 0;
  const branchLabel = gitStatus?.isGitRepository ? gitStatus.branch ?? "detached" : "非 Git 仓库";

  return (
    <div className="thread-info-workspace-git">
      <ul className="thread-info-workspace-git-list">
        <li className="thread-info-workspace-git-changes-row">
          <PlusSquare size={14} aria-hidden />
          <span>变更</span>
          <span className="thread-info-workspace-git-stats" aria-label="变更行数">
            {gitBusy ? (
              <span className="thread-info-workspace-git-stats-busy">…</span>
            ) : (
              <>
                <span className="git-commit-stat-add">+{insertions}</span>
                <span className="git-commit-stat-del">-{deletions}</span>
              </>
            )}
          </span>
        </li>

        <li className="thread-info-workspace-git-picker-row">
          <Laptop size={14} aria-hidden />
          <span className="thread-info-workspace-git-picker-label" title={workspacePath ?? workspaceLabel}>
            本地
          </span>
          <ChevronDown size={12} className="thread-info-workspace-git-chevron" aria-hidden />
        </li>

        <li className="thread-info-workspace-git-picker-row">
          <GitBranch size={14} aria-hidden />
          {gitStatus?.isGitRepository && gitStatus.branches.length > 0 && onCheckoutGitBranch ? (
            <label className="thread-info-workspace-git-picker">
              <select
                className="thread-info-workspace-git-picker-select"
                value={gitStatus.branch ?? ""}
                disabled={gitBusy}
                aria-label="切换分支"
                onChange={(event) => void onCheckoutGitBranch(event.target.value)}
              >
                {gitStatus.branches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
              <span className="thread-info-workspace-git-picker-label">{branchLabel}</span>
              <ChevronDown size={12} className="thread-info-workspace-git-chevron" aria-hidden />
            </label>
          ) : (
            <>
              <span className="thread-info-workspace-git-picker-label">{branchLabel}</span>
              <ChevronDown size={12} className="thread-info-workspace-git-chevron" aria-hidden />
            </>
          )}
        </li>

        {showCommitEntry ? (
          <li>
            <button
              type="button"
              className="thread-info-workspace-git-action"
              disabled={gitBusy || commitDisabled}
              onClick={() => setCommitDialogOpen(true)}
            >
              <GitCommitHorizontal size={14} aria-hidden />
              <span>提交或推送</span>
            </button>
          </li>
        ) : null}
      </ul>

      {showCommitEntry ? (
        <GitCommitDialog
          open={commitDialogOpen}
          workspacePath={workspacePath!}
          profileId={profileId!}
          {...(gitStatus && { gitStatus })}
          agentModelLabels={agentModelLabels}
          routes={routes}
          routePricingHints={routePricingHints}
          subagentEnabled={subagentEnabled!}
          gitSettings={gitSettings!}
          {...(gitBusy !== undefined && { busy: gitBusy })}
          {...(commitDisabled !== undefined && { disabled: commitDisabled })}
          {...(onCheckoutGitBranch && { onCheckoutBranch: onCheckoutGitBranch })}
          onClose={() => setCommitDialogOpen(false)}
          onSaveRolePreference={onSaveCommitRolePreference!}
          onSuccess={onCommitSuccess!}
        />
      ) : null}
    </div>
  );
}
