import { Check, ChevronDown, CirclePlus, CloudDownload, GitBranch, GitCommitHorizontal, Loader2, Play, Plus } from "lucide-react";
import { ICON_SIZE, ICON_STROKE } from "./icon-metrics";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type {
  GitSettingsSnapshot,
  GitWorkingTreeStatus,
  RoutePricingHint,
  RuntimeAgentRole,
  RuntimeRoleRouteConfig,
  SubagentEnabledSettings,
  WorkspaceDiffResult,
} from "../shared/ipc";
import type { ComposerAgentModelLabel } from "./composer-agent-model-labels";
import { composerFloatingStyleForAnchor } from "./composer-floating";
import { GitCommitDialog } from "./GitCommitDialog";
import { GitPullConflictDialog } from "./GitPullConflictDialog";
import { WorkspaceDiffDrawer } from "./WorkspaceDiffDrawer";
import {
  getWorkspaceGitCommitEntryLabel,
  useWorkspaceGitAction,
} from "./workspace-git-action-store";

export interface WorkspaceGitSectionProps {
  workspacePath?: string;
  workspaceLabel: string;
  gitStatus?: GitWorkingTreeStatus;
  gitBusy?: boolean;
  commitDisabled?: boolean;
  mainAgentConfigId?: string;
  defaultCommitCandidateModelId?: string;
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
  onPushSuccess?: () => void | Promise<void>;
  onOpenChangesReview?: () => void | Promise<void>;
  onChangesDiffLoaded?: (diff: WorkspaceDiffResult) => void | Promise<void>;
  onChangesDiffLoadingChange?: (loading: boolean) => void;
  onChangesDiffError?: (error?: string) => void;
  onPullSuccess?: () => void | Promise<void>;
  onResolveConflictsWithAgent?: (conflictFiles: string[]) => void | Promise<void>;
  onRefreshGitStatus?: (force?: boolean) => void | Promise<void>;
  scriptsDisabled?: boolean;
  onOpenScriptsDialog?: () => void;
}

export function resolveGitRemoteSyncAction(behindCount: number): "fetch" | "pull" {
  return behindCount > 0 ? "pull" : "fetch";
}

export function WorkspaceGitSection({
  workspacePath,
  workspaceLabel: _workspaceLabel,
  gitStatus,
  gitBusy,
  commitDisabled,
  mainAgentConfigId,
  defaultCommitCandidateModelId,
  agentModelLabels = [],
  routes = [],
  routePricingHints = [],
  subagentEnabled,
  gitSettings,
  onCheckoutGitBranch,
  onCreateGitBranch,
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
}: WorkspaceGitSectionProps) {
  const { t } = useTranslation();
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [commitDialogWorkspacePath, setCommitDialogWorkspacePath] = useState<string | undefined>();
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
  const [remoteSyncOperation, setRemoteSyncOperation] = useState<"fetch" | "pull">();
  const [pullError, setPullError] = useState<string | undefined>();
  const [pullConflict, setPullConflict] = useState<string[] | undefined>();
  const [resolveConflictBusy, setResolveConflictBusy] = useState(false);
  const latestWorkspacePathRef = useRef(workspacePath);
  latestWorkspacePathRef.current = workspacePath;
  const workspaceGitAction = useWorkspaceGitAction(workspacePath);
  const commitEntryBusy = workspaceGitAction !== null;
  const commitEntryLabel = getWorkspaceGitCommitEntryLabel(workspaceGitAction?.phase);

  // Keep the dialog bound to the workspace that opened it; close on project switch.
  useEffect(() => {
    if (commitDialogWorkspacePath && commitDialogWorkspacePath !== workspacePath) {
      setCommitDialogOpen(false);
      setCommitDialogWorkspacePath(undefined);
    }
  }, [workspacePath, commitDialogWorkspacePath]);

  const showCommitEntry = Boolean(
    workspacePath &&
      mainAgentConfigId &&
      onSaveCommitModelPreference &&
      onCommitSuccess &&
      gitStatus?.isGitRepository,
  );

  const insertions = changesDiff?.totalAdditions ?? gitStatus?.insertions ?? 0;
  const deletions = changesDiff?.totalDeletions ?? gitStatus?.deletions ?? 0;
  const isGitStatusPending = Boolean(workspacePath && !gitStatus);
  const branchLabel = isGitStatusPending
    ? t("workspaceGit.fetching")
    : gitStatus?.isGitRepository
      ? gitStatus.branch ?? "detached"
      : t("workspaceGit.notRepository");
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
  const remoteSyncAction = resolveGitRemoteSyncAction(gitStatus?.behindCount ?? 0);
  const hasRemoteUpdates = remoteSyncAction === "pull";
  const pullBusy = remoteSyncOperation !== undefined;
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

  async function handleCommitSuccess(operationWorkspacePath: string) {
    if (latestWorkspacePathRef.current !== operationWorkspacePath) {
      return;
    }
    await onCommitSuccess?.();
    if (latestWorkspacePathRef.current !== operationWorkspacePath) {
      return;
    }
    await syncWorkspaceChangesState();
  }

  async function handleRemoteSync() {
    if (!workspacePath || !window.eco || pullBusy || gitBusy) {
      return;
    }
    const action = remoteSyncAction;
    setRemoteSyncOperation(action);
    setPullError(undefined);
    try {
      if (action === "fetch") {
        await window.eco.fetchGitChanges({ workspacePath });
        await onPullSuccess?.();
        return;
      }
      const result = await window.eco.pullGitChanges({
        workspacePath,
        ...(gitStatus?.branch && { branch: gitStatus.branch }),
      });
      if (result.conflicted) {
        setPullConflict(
          result.conflictFiles.length > 0
            ? result.conflictFiles
            : [t("workspaceGit.unknownConflictFiles")],
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
      setRemoteSyncOperation(undefined);
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
    await onRefreshGitStatus?.(true);
    if (onOpenChangesReview) {
      setChangesDrawerOpen(false);
      await onOpenChangesReview();
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
      await handleCommitSuccess(workspacePath);
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
    const confirmed = window.confirm(
      t("workspaceGit.confirmDiscardAll", { count: changesDiff.fileCount }),
    );
    if (!confirmed) {
      return;
    }
    setDiscardBusy(true);
    setChangesError(undefined);
    try {
      await window.eco.discardWorkspaceChanges({ workspacePath });
      await handleCommitSuccess(workspacePath);
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
            aria-label={t("workspaceGit.viewChanges")}
            onClick={() => void openChangesDrawer()}
          >
            <CirclePlus size={ICON_SIZE.md} strokeWidth={ICON_STROKE} aria-hidden />
            <span>{t("workspace.diff.changes")}</span>
            <span className="thread-info-workspace-git-stats" aria-label={t("workspaceGit.changedLines")}>
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
                aria-label={t("workspaceGit.switchBranch")}
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
                      aria-label={t("workspaceGit.switchBranch")}
                      style={branchMenuStyle}
                    >
                      {branchCreateMode ? (
                        <div className="thread-info-workspace-git-branch-menu-body">
                          <div className="thread-info-workspace-git-branch-create">
                            <div className="thread-info-workspace-git-branch-menu-header">
                              {t("workspaceGit.newBranch")}
                            </div>
                            <input
                              className="thread-info-workspace-git-branch-create-input"
                              value={newBranchName}
                              placeholder={t("workspaceGit.branchName")}
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
                          <div className="thread-info-workspace-git-branch-menu-header">
                            {t("workspaceGit.branches")}
                          </div>
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
                                    <span className="thread-info-workspace-git-branch-menu-label">
                                      {t("workspaceGit.newBranch")}
                                    </span>
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
              disabled={gitBusy || commitDisabled || commitEntryBusy}
              onClick={() => {
                if (commitEntryBusy || !workspacePath) {
                  return;
                }
                void onRefreshGitStatus?.(true);
                setCommitDialogWorkspacePath(workspacePath);
                setCommitDialogOpen(true);
              }}
            >
              {commitEntryBusy ? (
                <Loader2 size={16} className="spinning" aria-hidden />
              ) : (
                <GitCommitHorizontal size={16} aria-hidden />
              )}
              <span>{commitEntryLabel}</span>
            </button>
          </li>
        ) : null}

        {showPullEntry ? (
          <li className="thread-info-workspace-git-row">
            <button
              type="button"
              className="thread-info-workspace-git-row-button"
              disabled={!canPull || gitBusy || pullBusy}
              onClick={() => void handleRemoteSync()}
              title={
                !canPull
                  ? t("workspaceGit.noUpstream")
                  : hasRemoteUpdates
                    ? t("workspaceGit.behind", { count: gitStatus?.behindCount ?? 0 })
                    : t("workspaceGit.fetchUpdates")
              }
            >
              <CloudDownload size={16} aria-hidden />
              <span>
                {remoteSyncOperation
                  ? remoteSyncOperation === "pull"
                    ? t("workspaceGit.pulling")
                    : t("workspaceGit.fetching")
                  : hasRemoteUpdates
                    ? t("workspaceGit.pull")
                    : t("workspaceGit.fetch")}
              </span>
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
              <span>{t("dialog.scripts.title")}</span>
            </button>
          </li>
        ) : null}
      </ul>

      {showCommitEntry && commitDialogWorkspacePath ? (
        <GitCommitDialog
          open={commitDialogOpen && commitDialogWorkspacePath === workspacePath}
          workspacePath={commitDialogWorkspacePath}
          mainAgentConfigId={mainAgentConfigId!}
          {...(defaultCommitCandidateModelId ? { defaultCandidateModelId: defaultCommitCandidateModelId } : {})}
          {...(gitStatus && commitDialogWorkspacePath === workspacePath ? { gitStatus } : {})}
          {...(gitBusy !== undefined && { busy: gitBusy })}
          {...(commitDisabled !== undefined && { disabled: commitDisabled })}
          {...(onCheckoutGitBranch && { onCheckoutBranch: onCheckoutGitBranch })}
          {...(onCreateGitBranch && { onCreateBranch: onCreateGitBranch })}
          onClose={() => {
            setCommitDialogOpen(false);
            setCommitDialogWorkspacePath(undefined);
          }}
          onSaveModelPreference={onSaveCommitModelPreference!}
          {...(onRefreshGitStatus && {
            onBeforeAction: () => onRefreshGitStatus(true),
          })}
          onSuccess={() => handleCommitSuccess(commitDialogWorkspacePath)}
          {...(onPushSuccess && { onPushSuccess })}
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
