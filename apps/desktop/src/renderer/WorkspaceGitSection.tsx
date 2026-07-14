import { Check, ChevronDown, CloudDownload, GitBranch, GitCommitHorizontal, Loader2, Play, Plus, PlusSquare } from "lucide-react";
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
  onSaveCommitModelPreference?: (candidateModelId: string) => void | Promise<void>;
  onCommitSuccess?: () => void | Promise<void>;
  onOpenChangesReview?: () => void;
  onChangesDiffLoaded?: (diff: WorkspaceDiffResult) => void | Promise<void>;
  onChangesDiffLoadingChange?: (loading: boolean) => void;
  onChangesDiffError?: (error?: string) => void;
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
  const [discardBusy, setDiscardBusy] = useState(false);
  const [pullBusy, setPullBusy] = useState(false);
  const [pullError, setPullError] = useState<string | undefined>();
  const [pullConflict, setPullConflict] = useState<string[] | undefined>();
  const [resolveConflictBusy, setResolveConflictBusy] = useState(false);

  const showCommitEntry = Boolean(
    workspacePath &&
      profileId &&
      onSaveCommitModelPreference &&
      onCommitSuccess &&
      gitStatus?.isGitRepository,
  );

  const insertions = changesDiff?.totalAdditions ?? gitStatus?.insertions ?? 0;
  const deletions = changesDiff?.totalDeletions ?? gitStatus?.deletions ?? 0;
  const isGitStatusPending = Boolean(workspacePath && !gitStatus);
  const branchLabel = isGitStatusPending
    ? "获取中…"
    : gitStatus?.isGitRepository
      ? gitStatus.branch ?? "detached"
      : "非 Git 仓库";
  const showBranchPicker = Boolean(
    gitStatus?.isGitRepository && gitStatus.branches.length > 0 && onCheckoutGitBranch,
  );
  const branchPickerDisabled = gitBusy || branchBusy;
  const canPull = Boolean(
    gitStatus?.isGitRepository &&
      gitStatus.branch &&
      gitStatus.branch !== "detached" &&
      gitStatus.hasUpstream,
  );
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

  async function reloadChangesDiff(preferredPath?: string) {
    if (!workspacePath || !window.eco) {
      return;
    }
    setChangesLoading(true);
    onChangesDiffLoadingChange?.(true);
    setChangesError(undefined);
    onChangesDiffError?.(undefined);
    try {
      const result = await window.eco.getWorkspaceDiff(workspacePath);
      setChangesDiff(result);
      const nextPath =
        preferredPath && result.files.some((file) => file.path === preferredPath)
          ? preferredPath
          : result.files[0]?.path;
      setSelectedChangePath(nextPath);
      await onChangesDiffLoaded?.(result);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setChangesError(message);
      onChangesDiffError?.(message);
      setChangesDiff(undefined);
      setSelectedChangePath(undefined);
    } finally {
      setChangesLoading(false);
      onChangesDiffLoadingChange?.(false);
    }
  }

  async function syncWorkspaceChangesState() {
    if (changesDrawerOpen) {
      await reloadChangesDiff(selectedChangePath);
      return;
    }
    setChangesDiff(undefined);
    setSelectedChangePath(undefined);
  }

  async function handleCommitSuccess() {
    await onCommitSuccess?.();
    await syncWorkspaceChangesState();
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
        await syncWorkspaceChangesState();
        return;
      }
      await onPullSuccess?.();
      await syncWorkspaceChangesState();
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
    if (onOpenChangesReview) {
      setChangesDrawerOpen(false);
      onOpenChangesReview();
      await reloadChangesDiff(selectedChangePath);
      return;
    }
    setChangesDrawerOpen(true);
    await reloadChangesDiff(selectedChangePath);
  }

  function closeChangesDrawer() {
    setChangesDrawerOpen(false);
    setChangesError(undefined);
  }

  async function handleDiscardChange(path: string) {
    if (!workspacePath || !window.eco || discardBusy) {
      return;
    }
    setDiscardBusy(true);
    setChangesError(undefined);
    try {
      await window.eco.discardWorkspaceChanges({ workspacePath, path });
      await handleCommitSuccess();
    } catch (caught) {
      setChangesError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDiscardBusy(false);
    }
  }

  async function handleDiscardAllChanges() {
    if (!workspacePath || !window.eco || discardBusy || !changesDiff?.fileCount) {
      return;
    }
    const confirmed = window.confirm(`确定撤掉全部 ${changesDiff.fileCount} 个文件的未提交变更？此操作不可恢复。`);
    if (!confirmed) {
      return;
    }
    setDiscardBusy(true);
    setChangesError(undefined);
    try {
      await window.eco.discardWorkspaceChanges({ workspacePath });
      await handleCommitSuccess();
    } catch (caught) {
      setChangesError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDiscardBusy(false);
    }
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
            <PlusSquare size={16} aria-hidden />
            <span>变更</span>
            <span className="thread-info-workspace-git-stats" aria-label="变更行数">
              {gitBusy ? (
                <Loader2 size={12} className="spinning thread-info-workspace-git-stats-busy" aria-hidden />
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
          <GitBranch size={16} aria-hidden />
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
                  size={13}
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
                                      <GitBranch size={16} aria-hidden />
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
              <GitCommitHorizontal size={16} aria-hidden />
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
                !canPull
                  ? "未配置远程跟踪分支"
                  : (gitStatus?.behindCount ?? 0) > 0
                    ? `落后远程 ${gitStatus?.behindCount ?? 0} 个提交`
                    : "从远程拉取最新变更"
              }
            >
              <CloudDownload size={16} aria-hidden />
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
              <Play size={16} aria-hidden />
              <span>脚本</span>
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
          {...(gitBusy !== undefined && { busy: gitBusy })}
          {...(commitDisabled !== undefined && { disabled: commitDisabled })}
          {...(onCheckoutGitBranch && { onCheckoutBranch: onCheckoutGitBranch })}
          {...(onCreateGitBranch && { onCreateBranch: onCreateGitBranch })}
          onClose={() => setCommitDialogOpen(false)}
          onSaveModelPreference={onSaveCommitModelPreference!}
          onSuccess={handleCommitSuccess}
        />
      ) : null}

      <WorkspaceDiffDrawer
        open={changesDrawerOpen}
        loading={changesLoading}
        discardBusy={discardBusy}
        {...(changesError && { error: changesError })}
        {...(changesDiff && { diff: changesDiff })}
        {...(selectedChangePath && { selectedPath: selectedChangePath })}
        onSelectPath={setSelectedChangePath}
        onDiscardPath={(path) => void handleDiscardChange(path)}
        onDiscardAll={() => void handleDiscardAllChanges()}
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
