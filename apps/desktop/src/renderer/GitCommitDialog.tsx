import { Check, ChevronDown, CloudUpload, GitBranch, GitCommitHorizontal, Loader2, Plus, Sparkles } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  GitSettingsSnapshot,
  GitWorkingTreeStatus,
  RoutePricingHint,
  RuntimeAgentRole,
  RuntimeRoleRouteConfig,
  SubagentEnabledSettings,
  SubagentRole,
} from "../shared/ipc";
import { SUBAGENT_ROLES } from "../shared/ipc";
import {
  buildCommitModelOptions,
  findCommitModelOptionForRole,
} from "../shared/commit-model-options";
import { resolveCommitMessageRoute } from "../shared/resolve-commit-message-route";
import type { ComposerAgentModelLabel } from "./composer-agent-model-labels";
import { CommitModelPricingCompact, CommitModelProviderDot } from "./CommitModelPricingCompact";

export type CommitDialogAction = "commit" | "commit-push" | "push";

interface GitCommitDialogProps {
  open: boolean;
  workspacePath: string;
  profileId: string;
  gitStatus?: GitWorkingTreeStatus;
  agentModelLabels: ComposerAgentModelLabel[];
  routes: readonly RuntimeRoleRouteConfig[];
  routePricingHints: RoutePricingHint[];
  subagentEnabled: SubagentEnabledSettings;
  gitSettings: GitSettingsSnapshot;
  busy?: boolean;
  disabled?: boolean;
  onCheckoutBranch?: (branch: string) => void | Promise<void>;
  onCreateBranch?: (branch: string) => void | Promise<void>;
  onClose: () => void;
  onSaveRolePreference: (role: RuntimeAgentRole) => void | Promise<void>;
  onSuccess: () => void | Promise<void>;
}

export function GitCommitDialog({
  open,
  workspacePath,
  profileId,
  gitStatus,
  agentModelLabels,
  routes,
  routePricingHints,
  subagentEnabled,
  gitSettings,
  busy,
  disabled,
  onCheckoutBranch,
  onCreateBranch,
  onClose,
  onSaveRolePreference,
  onSuccess,
}: GitCommitDialogProps) {
  const [message, setMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [selectedRole, setSelectedRole] = useState<RuntimeAgentRole | undefined>();
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchCreateMode, setBranchCreateMode] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [branchBusy, setBranchBusy] = useState(false);
  const [branchError, setBranchError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const configuredSubagentRoles = useMemo(() => {
    const roles = new Set<SubagentRole>();
    for (const route of routes) {
      if (route.role !== "planner" && (SUBAGENT_ROLES as readonly string[]).includes(route.role)) {
        roles.add(route.role as SubagentRole);
      }
    }
    return roles;
  }, [routes]);

  const modelOptions = useMemo(
    () => buildCommitModelOptions(routes, routePricingHints, configuredSubagentRoles),
    [routes, routePricingHints, configuredSubagentRoles],
  );

  const selectedOption = useMemo(
    () => findCommitModelOptionForRole(modelOptions, selectedRole, routes, routePricingHints),
    [modelOptions, selectedRole, routes, routePricingHints],
  );

  const modelLabel = selectedOption?.modelLabel ?? "未配置模型";

  const savedRole = gitSettings.commitMessageRoleByProfileId[profileId] ?? "auto";

  useEffect(() => {
    if (!open) {
      setModelMenuOpen(false);
      setBranchMenuOpen(false);
      setBranchCreateMode(false);
      setNewBranchName("");
      setBranchError(undefined);
      return;
    }
    setMessage("");
    setIncludeUnstaged(true);
    setError(undefined);
    setGeneratingMessage(false);
    setModelMenuOpen(false);
    setBranchMenuOpen(false);
    setBranchCreateMode(false);
    setNewBranchName("");
    setBranchError(undefined);
    const resolved = resolveCommitMessageRoute(
      routes,
      routePricingHints,
      configuredSubagentRoles,
      savedRole,
    );
    const matched = findCommitModelOptionForRole(modelOptions, resolved?.role, routes, routePricingHints);
    setSelectedRole(matched?.role ?? resolved?.role);
  }, [open]);

  const handleSelectRole = useCallback(
    (role: RuntimeAgentRole) => {
      setSelectedRole(role);
      setModelMenuOpen(false);
      void onSaveRolePreference(role);
    },
    [onSaveRolePreference],
  );

  const closeBranchMenu = useCallback(() => {
    setBranchMenuOpen(false);
    setBranchCreateMode(false);
    setNewBranchName("");
    setBranchError(undefined);
  }, []);

  const handleSelectBranch = useCallback(
    async (branch: string) => {
      if (!onCheckoutBranch || branchBusy) {
        return;
      }
      closeBranchMenu();
      setBranchBusy(true);
      try {
        await onCheckoutBranch(branch);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBranchBusy(false);
      }
    },
    [onCheckoutBranch, branchBusy, closeBranchMenu],
  );

  const handleCreateBranch = useCallback(async () => {
    const trimmed = newBranchName.trim();
    if (!onCreateBranch || !trimmed || branchBusy) {
      return;
    }
    setBranchBusy(true);
    setBranchError(undefined);
    try {
      await onCreateBranch(trimmed);
      closeBranchMenu();
    } catch (caught) {
      setBranchError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBranchBusy(false);
    }
  }, [onCreateBranch, newBranchName, branchBusy, closeBranchMenu]);

  const handleGenerateMessage = useCallback(async () => {
    if (!window.eco || generatingMessage || submitting || busy || disabled) {
      return;
    }
    setGeneratingMessage(true);
    setError(undefined);
    try {
      const result = await window.eco.generateGitCommitMessage({
        workspacePath,
        profileId,
        includeUnstaged,
        ...(selectedRole && { role: selectedRole }),
      });
      setMessage(result.message);
      setModelMenuOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setGeneratingMessage(false);
    }
  }, [
    generatingMessage,
    submitting,
    busy,
    disabled,
    workspacePath,
    profileId,
    includeUnstaged,
    selectedRole,
  ]);

  const runAction = useCallback(
    async (action: CommitDialogAction) => {
      if (!window.eco || submitting || disabled) {
        return;
      }
      setSubmitting(true);
      setError(undefined);
      try {
        if (action === "push") {
          await window.eco.pushGitChanges({
            workspacePath,
            ...(gitStatus?.branch && { branch: gitStatus.branch }),
          });
        } else {
          const trimmed = message.trim();
          const result = await window.eco.commitGitChanges({
            workspacePath,
            profileId,
            includeUnstaged,
            ...(trimmed && { message: trimmed }),
            ...(!trimmed && selectedRole && { role: selectedRole }),
          });
          if (!trimmed && result.generated) {
            setMessage(result.message);
          }
          if (action === "commit-push") {
            await window.eco.pushGitChanges({
              workspacePath,
              ...(gitStatus?.branch && { branch: gitStatus.branch }),
            });
          }
        }
        await onSuccess();
        onClose();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setSubmitting(false);
      }
    },
    [
      submitting,
      disabled,
      selectedRole,
      message,
      workspacePath,
      profileId,
      includeUnstaged,
      gitStatus?.branch,
      onSuccess,
      onClose,
    ],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void runAction("commit");
      }
      if (event.key === "Escape") {
        if (branchCreateMode) {
          setBranchCreateMode(false);
          setNewBranchName("");
          setBranchError(undefined);
          return;
        }
        if (branchMenuOpen) {
          closeBranchMenu();
          return;
        }
        if (modelMenuOpen) {
          setModelMenuOpen(false);
          return;
        }
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, runAction, modelMenuOpen, branchMenuOpen, branchCreateMode, closeBranchMenu]);

  if (!open) {
    return null;
  }

  const insertions = gitStatus?.insertions ?? 0;
  const deletions = gitStatus?.deletions ?? 0;
  const canPush = Boolean(gitStatus?.isGitRepository);
  const canCommit = Boolean(gitStatus?.canCommit) && !disabled;
  const canPushOnly = canPush && (gitStatus?.aheadCount ?? 0) > 0;
  const branchLabel = gitStatus?.branch ?? "detached";
  const branchPickerDisabled = submitting || busy || branchBusy || generatingMessage;
  const showBranchPicker =
    Boolean(gitStatus?.isGitRepository && gitStatus.branches.length > 0 && onCheckoutBranch);
  const modelPickerDisabled =
    submitting || busy || disabled || generatingMessage || modelOptions.length === 0;
  const messageFieldDisabled = submitting || busy || disabled || generatingMessage;
  const showModelPicker = message.trim().length === 0;

  return createPortal(
    <div className="git-commit-dialog-backdrop" onMouseDown={onClose}>
      <div
        className="git-commit-popover"
        role="dialog"
        aria-label="提交或推送"
        onMouseDown={(event) => {
          event.stopPropagation();
          if (!(event.target as HTMLElement).closest(".git-commit-model-select-wrap")) {
            setModelMenuOpen(false);
          }
          if (!(event.target as HTMLElement).closest(".git-commit-branch-select-wrap")) {
            closeBranchMenu();
          }
        }}
      >
        <header className="git-commit-popover-header">
          <div className="git-commit-popover-header-row">
            <div className="git-commit-popover-header-branch">
              {showBranchPicker ? (
                <div className="git-commit-branch-select-wrap">
                  <button
                    type="button"
                    className="git-commit-popover-branch git-commit-popover-branch-trigger"
                    disabled={branchPickerDisabled}
                    aria-expanded={branchMenuOpen}
                    aria-haspopup="listbox"
                    aria-label="切换分支"
                    onClick={() => {
                      setModelMenuOpen(false);
                      setBranchMenuOpen((current) => {
                        const next = !current;
                        if (!next) {
                          setBranchCreateMode(false);
                          setNewBranchName("");
                          setBranchError(undefined);
                        }
                        return next;
                      });
                    }}
                  >
                    <GitBranch size={15} strokeWidth={1.75} aria-hidden />
                    <span className="git-commit-popover-branch-label">{branchLabel}</span>
                    <ChevronDown
                      size={13}
                      strokeWidth={2}
                      className={branchMenuOpen ? "git-commit-model-chevron is-open" : "git-commit-model-chevron"}
                      aria-hidden
                    />
                  </button>
                  {branchMenuOpen ? (
                    <div className="git-commit-branch-menu" role="listbox" aria-label="提交到">
                      {branchCreateMode ? (
                        <div className="git-commit-branch-create">
                          <div className="git-commit-branch-menu-header">新分支</div>
                          <input
                            className="git-commit-branch-create-input"
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
                          {branchError ? <p className="git-commit-branch-create-error">{branchError}</p> : null}
                        </div>
                      ) : (
                        <>
                          <div className="git-commit-branch-menu-header">提交到</div>
                          <ul className="git-commit-branch-menu-list">
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
                                    <GitBranch size={14} strokeWidth={1.75} aria-hidden />
                                    <span className="git-commit-branch-menu-label">{branch}</span>
                                    {isActive ? <Check size={14} aria-hidden /> : null}
                                  </button>
                                </li>
                              );
                            })}
                            {onCreateBranch ? (
                              <li>
                                <button
                                  type="button"
                                  className="git-commit-branch-menu-create"
                                  disabled={branchBusy}
                                  onClick={() => {
                                    setBranchCreateMode(true);
                                    setNewBranchName("");
                                    setBranchError(undefined);
                                  }}
                                >
                                  <Plus size={14} strokeWidth={2} aria-hidden />
                                  <span className="git-commit-branch-menu-label">新分支</span>
                                </button>
                              </li>
                            ) : null}
                          </ul>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="git-commit-popover-branch">
                  <GitBranch size={15} strokeWidth={1.75} aria-hidden />
                  <span>{branchLabel}</span>
                  <ChevronDown size={13} strokeWidth={2} aria-hidden />
                </div>
              )}
            </div>

            <div className="git-commit-popover-stats" aria-label="变更行数">
              <span className="git-commit-stat-add">+{insertions}</span>
              <span className="git-commit-stat-del">-{deletions}</span>
            </div>
          </div>

          {showModelPicker ? (
            <div className="git-commit-popover-header-model">
              <div className="git-commit-model-select-wrap">
                <button
                  type="button"
                  className="git-commit-popover-branch git-commit-popover-model-trigger"
                  disabled={modelPickerDisabled}
                  aria-expanded={modelMenuOpen}
                  aria-haspopup="listbox"
                  aria-label="生成模型"
                  onClick={() => {
                    closeBranchMenu();
                    setModelMenuOpen((current) => !current);
                  }}
                >
                  {selectedOption ? (
                    <CommitModelProviderDot color={selectedOption.providerColor} label={selectedOption.providerName} />
                  ) : (
                    <span className="git-commit-model-provider-dot is-empty" aria-hidden />
                  )}
                  <span className="git-commit-popover-branch-label">{modelLabel}</span>
                  <ChevronDown
                    size={13}
                    strokeWidth={2}
                    className={modelMenuOpen ? "git-commit-model-chevron is-open" : "git-commit-model-chevron"}
                    aria-hidden
                  />
                </button>
                {modelMenuOpen ? (
                  <ul className="git-commit-model-menu" role="listbox" aria-label="生成模型">
                    {modelOptions.map((option) => {
                      const isActive = option.role === selectedRole;
                      return (
                        <li key={option.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            className={isActive ? "is-active" : undefined}
                            title={option.hint?.pricingLabel ?? `${option.providerName} · ${option.modelId}`}
                            onClick={() => handleSelectRole(option.role)}
                          >
                            <CommitModelProviderDot color={option.providerColor} label={option.providerName} />
                            <span className="git-commit-model-menu-label">{option.modelLabel}</span>
                            <CommitModelPricingCompact hint={option.hint} />
                            {isActive ? <Check size={14} aria-hidden /> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}
        </header>

        <div className="git-commit-popover-body">
          <div className="git-commit-popover-message-wrap">
            <textarea
              className="git-commit-popover-message"
              value={message}
              placeholder="提交信息（留空则 AI 生成）"
              rows={3}
              disabled={messageFieldDisabled}
              onChange={(event) => {
                const next = event.target.value;
                setMessage(next);
                if (next.trim().length > 0) {
                  setModelMenuOpen(false);
                }
              }}
              autoFocus
            />
            <button
              type="button"
              className="git-commit-popover-message-generate"
              aria-label="AI 生成提交信息"
              title="AI 生成提交信息"
              disabled={messageFieldDisabled || !canCommit}
              onClick={() => void handleGenerateMessage()}
            >
              {generatingMessage ? (
                <Loader2 size={16} className="spinning" aria-hidden />
              ) : (
                <Sparkles size={16} strokeWidth={1.75} aria-hidden />
              )}
            </button>
          </div>

          <label className="git-commit-popover-checkbox">
            <input
              type="checkbox"
              checked={includeUnstaged}
              disabled={messageFieldDisabled}
              onChange={(event) => setIncludeUnstaged(event.target.checked)}
            />
            <span>包含未暂存的更改</span>
          </label>

          {error ? <p className="git-commit-popover-error">{error}</p> : null}
        </div>

        <ul className="git-commit-popover-actions">
          <li>
            <button
              type="button"
              className="git-commit-popover-action"
              disabled={!canCommit || submitting || busy || generatingMessage}
              onClick={() => void runAction("commit")}
            >
              <span className="git-commit-popover-action-icon" aria-hidden>
                <GitCommitHorizontal size={16} strokeWidth={1.75} />
              </span>
              <span className="git-commit-popover-action-label">提交</span>
              <span className="git-commit-popover-action-trailing" aria-hidden>
                {submitting ? (
                  <Loader2 size={14} className="spinning git-commit-popover-spinner" />
                ) : (
                  <kbd className="git-commit-popover-shortcut">⌘↩</kbd>
                )}
              </span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="git-commit-popover-action"
              disabled={!canCommit || submitting || busy || generatingMessage}
              onClick={() => void runAction("commit-push")}
            >
              <span className="git-commit-popover-action-icon" aria-hidden>
                <CloudUpload size={16} strokeWidth={1.75} />
              </span>
              <span className="git-commit-popover-action-label">提交并推送</span>
              <span className="git-commit-popover-action-trailing" aria-hidden />
            </button>
          </li>
          <li>
            <button
              type="button"
              className="git-commit-popover-action"
              disabled={!canPushOnly || submitting || busy}
              onClick={() => void runAction("push")}
            >
              <span className="git-commit-popover-action-icon" aria-hidden>
                <CloudUpload size={16} strokeWidth={1.75} />
              </span>
              <span className="git-commit-popover-action-label">推送</span>
              <span className="git-commit-popover-action-trailing" aria-hidden />
            </button>
          </li>
        </ul>
      </div>
    </div>,
    document.body,
  );
}
