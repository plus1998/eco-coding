import { Check, ChevronDown, CloudDownload, GitBranch, GitCommitHorizontal, Play, Plus, PlusSquare } from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { composerFloatingStyleForAnchor } from "./composer-floating";
import type {
  GitSettingsSnapshot,
  GitWorkingTreeStatus,
  RoutePricingHint,
  RuntimeRoleRouteConfig,
  SubagentEnabledSettings,
  RuntimeAgentRole,
  WorkspaceDiffResult,
} from "../shared/ipc";
import type { ComposerAgentModelLabel } from "./composer-agent-model-labels";
import { GitCommitDialog } from "./GitCommitDialog";
import { GitPullConflictDialog } from "./GitPullConflictDialog";
import { WorkspaceDiffDrawer } from "./WorkspaceDiffDrawer";

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
  onCreateGitBranch?: (branch: string) => void | Promise<void>;
  onOpenGitSettings?: () => void;
  onSaveCommitRolePreference?: (role: RuntimeAgentRole | "auto") => void | Promise<void>;
  onCommitSuccess?: () => void | Promise<void>;
  onPullSuccess?: () => void | Promise<void>;
  onResolveConflictsWithAgent?: (conflictFiles: string[]) => void | Promise<void>;
  scriptsDisabled?: boolean;
  onOpenScriptsDialog?: () => void;
}

export function WorkspaceGitSection({
  workspacePath,
  workspaceLabel: _workspaceLabel,
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
  onCreateGitBranch,
  onSaveCommitRolePreference,
  onCommitSuccess,
  onPullSuccess,
  onResolveConflictsWithAgent,
  scriptsDisabled,
  onOpenScriptsDialog,
}: WorkspaceGitSectionProps) {
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchCreateMode, setBranchCreateMode] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [branchBusy, setBranchBusy] = useState(false);
  const [branchError, setBranchError] = useState<string | undefined>();
  const branchWrapRef = useRef<HTMLDivElement>(null);
  const branchTriggerRef = useRef<HTMLButtonElement>(null);
  const [branchMenuStyle, setBranchMenuStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));
  const [changesDrawerOpen, setChangesDrawerOpen] = useState(false);
  const [changesLoading, setChangesLoading] = useState(false);
  const [changesError, setChangesError] = useState<string | undefined>();
  const [changesDiff, setChangesDiff] = useState<WorkspaceDiffResult | undefined>();
  const [selectedChangePath, setSelectedChangePath] = useState<string | undefined>();
  const [pullBusy, setPullBusy] = useState(false);
  const [pullError, setPullError] = useState<string | undefined>();
  const [pullConflict, setPullConflict] = useState<string[] | undefined>();
  const [resolveConflictBusy, setResolveConflictBusy] = useState(false);

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
  const showBranchPicker = Boolean(
    gitStatus?.isGitRepository && gitStatus.branches.length > 0 && onCheckoutGitBranch,
  );
  const branchPickerDisabled = gitBusy || branchBusy;
  const canPull = Boolean(gitStatus?.isGitRepository && (gitStatus.behindCount ?? 0) > 0);
  const showPullEntry = Boolean(workspacePath && gitStatus?.isGitRepository);

  const closeBranchMenu = useCallback(() => {
    setBranchMenuOpen(false);
    setBranchCreateMode(false);
    setNewBranchName("");
    setBranchError(undefined);
  }, []);

  const handleSelectBranch = useCallback(
    async (branch: string) => {
      if (!onCheckoutGitBranch || branchBusy || branch === gitStatus?.branch) {
        closeBranchMenu();
        return;
      }
      closeBranchMenu();
      setBranchBusy(true);
      try {
        await onCheckoutGitBranch(branch);
      } finally {
        setBranchBusy(false);
      }
    },
    [onCheckoutGitBranch, branchBusy, closeBranchMenu, gitStatus?.branch],
  );

  const handleCreateBranch = useCallback(async () => {
    const trimmed = newBranchName.trim();
    if (!onCreateGitBranch || !trimmed || branchBusy) {
      return;
    }
    setBranchBusy(true);
    setBranchError(undefined);
    try {
      await onCreateGitBranch(trimmed);
      closeBranchMenu();
    } catch (caught) {
      setBranchError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBranchBusy(false);
    }
  }, [onCreateGitBranch, newBranchName, branchBusy, closeBranchMenu]);

  const updateBranchMenuPosition = useCallback(() => {
    const anchor = branchTriggerRef.current;
    if (!anchor) {
      return;
    }
    setBranchMenuStyle(
      composerFloatingStyleForAnchor(anchor, {
        width: 240,
        minHeight: 120,
        prefer: "below",
        align: "start",
      }),
    );
  }, []);

  useLayoutEffect(() => {
    if (!branchMenuOpen) {
      return;
    }
    updateBranchMenuPosition();
    window.addEventListener("resize", updateBranchMenuPosition);
    window.addEventListener("scroll", updateBranchMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateBranchMenuPosition);
      window.removeEventListener("scroll", updateBranchMenuPosition, true);
    };
  }, [branchMenuOpen, updateBranchMenuPosition]);

  useEffect(() => {
    if (!branchMenuOpen) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (branchWrapRef.current?.contains(target) || (event.target as HTMLElement).closest(".thread-info-workspace-git-branch-menu")) {
        return;
      }
      closeBranchMenu();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeBranchMenu();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [branchMenuOpen, closeBranchMenu]);

  async function handleCommitSuccess() {
    await onCommitSuccess?.();
  }

  async function handlePull() {
    if (!workspacePath || !window.eco || pullBusy || gitBusy) {
      return;
    }
    setPullBusy(true);
    setPullError(undefined);
    try {
      const result = await window.eco.pullGitChanges({
        workspacePath,
        ...(gitStatus?.branch && { branch: gitStatus.branch }),
      });
      if (result.conflicted) {
        setPullConflict(
          result.conflictFiles.length > 0 ? result.conflictFiles : ["（未能自动识别冲突文件，请查看 git status）"],
        );
        await onPullSuccess?.();
        return;
      }
      await onPullSuccess?.();
    } catch (caught) {
      setPullError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPullBusy(false);
    }
  }

  async function handleConfirmResolveConflicts() {
    if (!pullConflict?.length || !onResolveConflictsWithAgent) {
      setPullConflict(undefined);
      return;
    }
    setResolveConflictBusy(true);
    try {
      await onResolveConflictsWithAgent(pullConflict);
      setPullConflict(undefined);
    } finally {
      setResolveConflictBusy(false);
    }
  }

  async function openChangesDrawer() {
    if (!workspacePath || !window.eco || changesLoading) {
      return;
    }
    setChangesDrawerOpen(true);
    setChangesLoading(true);
    setChangesError(undefined);
    try {
      const result = await window.eco.getWorkspaceDiff(workspacePath);
      setChangesDiff(result);
      setSelectedChangePath(result.files[0]?.path);
    } catch (caught) {
      setChangesError(caught instanceof Error ? caught.message : String(caught));
      setChangesDiff(undefined);
      setSelectedChangePath(undefined);
    } finally {
      setChangesLoading(false);
    }
  }

  function closeChangesDrawer() {
    setChangesDrawerOpen(false);
    setChangesError(undefined);
  }

  return (
    <div className="thread-info-workspace-git">
      <ul className="thread-info-workspace-git-list">
        <li
          className={
            changesDrawerOpen
              ? "thread-info-workspace-git-row thread-info-workspace-git-changes-row is-active"
              : "thread-info-workspace-git-row thread-info-workspace-git-changes-row"
          }
        >
          <button
            type="button"
            className="thread-info-workspace-git-row-button"
            disabled={!workspacePath || gitBusy}
            aria-expanded={changesDrawerOpen}
            aria-haspopup="dialog"
            aria-label="查看工作区变更"
            onClick={() => void openChangesDrawer()}
          >
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
          </button>
        </li>

        <li
          className={
            branchMenuOpen
              ? "thread-info-workspace-git-row thread-info-workspace-git-picker-row is-active"
              : "thread-info-workspace-git-row thread-info-workspace-git-picker-row"
          }
        >
          <GitBranch size={14} aria-hidden />
          {showBranchPicker ? (
            <div ref={branchWrapRef} className="thread-info-workspace-git-branch-wrap">
              <button
                ref={branchTriggerRef}
                type="button"
                className="thread-info-workspace-git-row-button"
                disabled={branchPickerDisabled}
                aria-expanded={branchMenuOpen}
                aria-haspopup="listbox"
                aria-label="切换分支"
                onClick={() => {
                  setBranchMenuOpen((current) => {
                    const next = !current;
                    if (!next) {
                      setBranchCreateMode(false);
                      setNewBranchName("");
                      setBranchError(undefined);
                    } else {
                      updateBranchMenuPosition();
                    }
                    return next;
                  });
                }}
              >
                <span className="thread-info-workspace-git-picker-label">{branchLabel}</span>
                <ChevronDown
                  size={12}
                  className={
                    branchMenuOpen
                      ? "thread-info-workspace-git-chevron open"
                      : "thread-info-workspace-git-chevron"
                  }
                  aria-hidden
                />
              </button>
              {branchMenuOpen
                ? createPortal(
                    <div
                      className="thread-info-workspace-git-branch-menu"
                      role="listbox"
                      aria-label="切换分支"
                      style={branchMenuStyle}
                    >
                      {branchCreateMode ? (
                        <div className="thread-info-workspace-git-branch-menu-body">
                          <div className="thread-info-workspace-git-branch-create">
                            <div className="thread-info-workspace-git-branch-menu-header">新分支</div>
                            <input
                              className="thread-info-workspace-git-branch-create-input"
                              value={newBranchName}
                              placeholder="分支名称…"
                              disabled={branchBusy}
                              autoFocus
                              onChange={(event) => {
                                setNewBranchName(event.target.value);
                                setBranchError(undefined);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void handleCreateBranch();
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setBranchCreateMode(false);
                                  setNewBranchName("");
                                  setBranchError(undefined);
                                }
                              }}
                            />
                            {branchError ? (
                              <p className="thread-info-workspace-git-branch-create-error">{branchError}</p>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="thread-info-workspace-git-branch-menu-header">分支</div>
                          <div className="thread-info-workspace-git-branch-menu-body">
                            <ul className="thread-info-workspace-git-branch-menu-list">
                              {gitStatus!.branches.map((branch) => {
                                const isActive = branch === gitStatus?.branch;
                                return (
                                  <li key={branch}>
                                    <button
                                      type="button"
                                      role="option"
                                      aria-selected={isActive}
                                      className={isActive ? "is-active" : undefined}
                                      disabled={branchBusy}
                                      onClick={() => void handleSelectBranch(branch)}
                                    >
                                      <GitBranch size={14} aria-hidden />
                                      <span className="thread-info-workspace-git-branch-menu-label">
                                        {branch}
                                      </span>
                                      {isActive ? <Check size={14} aria-hidden /> : null}
                                    </button>
                                  </li>
                                );
                              })}
                              {onCreateGitBranch ? (
                                <li>
                                  <button
                                    type="button"
                                    className="thread-info-workspace-git-branch-menu-create"
                                    disabled={branchBusy}
                                    onClick={() => {
                                      setBranchCreateMode(true);
                                      setNewBranchName("");
                                      setBranchError(undefined);
                                    }}
                                  >
                                    <Plus size={14} aria-hidden />
                                    <span className="thread-info-workspace-git-branch-menu-label">新分支</span>
                                  </button>
                                </li>
                              ) : null}
                            </ul>
                          </div>
                        </>
                      )}
                    </div>,
                    document.body,
                  )
                : null}
            </div>
          ) : (
            <span className="thread-info-workspace-git-picker-label">{branchLabel}</span>
          )}
        </li>

        {showCommitEntry ? (
          <li className="thread-info-workspace-git-row">
            <button
              type="button"
              className="thread-info-workspace-git-row-button"
              disabled={gitBusy || commitDisabled}
              onClick={() => setCommitDialogOpen(true)}
            >
              <GitCommitHorizontal size={14} aria-hidden />
              <span>提交或推送</span>
            </button>
          </li>
        ) : null}

        {showPullEntry ? (
          <li className="thread-info-workspace-git-row">
            <button
              type="button"
              className="thread-info-workspace-git-row-button"
              disabled={!canPull || gitBusy || pullBusy}
              onClick={() => void handlePull()}
              title={
                canPull
                  ? `落后远程 ${gitStatus?.behindCount ?? 0} 个提交`
                  : "当前分支已与远程同步"
              }
            >
              <CloudDownload size={14} aria-hidden />
              <span>{pullBusy ? "拉取中…" : "拉取"}</span>
            </button>
          </li>
        ) : null}

        {pullError ? (
          <li className="thread-info-workspace-git-row thread-info-workspace-git-error-row">
            <span className="thread-info-workspace-git-error">{pullError}</span>
          </li>
        ) : null}

        {onOpenScriptsDialog ? (
          <li className="thread-info-workspace-git-row">
            <button
              type="button"
              className="thread-info-workspace-git-row-button"
              disabled={scriptsDisabled}
              onClick={onOpenScriptsDialog}
            >
              <Play size={14} aria-hidden />
              <span>npm scripts</span>
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
          {...(onCreateGitBranch && { onCreateBranch: onCreateGitBranch })}
          onClose={() => setCommitDialogOpen(false)}
          onSaveRolePreference={onSaveCommitRolePreference!}
          onSuccess={handleCommitSuccess}
        />
      ) : null}

      <WorkspaceDiffDrawer
        open={changesDrawerOpen}
        loading={changesLoading}
        {...(changesError && { error: changesError })}
        {...(changesDiff && { diff: changesDiff })}
        {...(selectedChangePath && { selectedPath: selectedChangePath })}
        onSelectPath={setSelectedChangePath}
        onClose={closeChangesDrawer}
      />

      {pullConflict && pullConflict.length > 0 ? (
        <GitPullConflictDialog
          conflictFiles={pullConflict}
          busy={resolveConflictBusy}
          onConfirmAgent={() => void handleConfirmResolveConflicts()}
          onDismiss={() => {
            if (!resolveConflictBusy) {
              setPullConflict(undefined);
            }
          }}
        />
      ) : null}
    </div>
  );
}
