import { Check, ChevronDown, CloudUpload, GitBranch, GitCommitHorizontal, Loader2, X } from "lucide-react";
import {
  type FormEvent,
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
  resolveCommitMessageRoute,
  resolveDefaultCommitMessageRole,
} from "../shared/resolve-commit-message-route";
import type { ComposerAgentModelLabel } from "./composer-agent-model-labels";

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
  onClose: () => void;
  onSaveRolePreference: (role: RuntimeAgentRole | "auto") => void | Promise<void>;
  onSuccess: () => void | Promise<void>;
}

function subagentLabels(labels: ComposerAgentModelLabel[]): ComposerAgentModelLabel[] {
  return labels.filter((label) => label.subagentRole);
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
  onClose,
  onSaveRolePreference,
  onSuccess,
}: GitCommitDialogProps) {
  const [message, setMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [selectedRole, setSelectedRole] = useState<RuntimeAgentRole | "auto">("auto");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const enabledRoles = useMemo(
    () => new Set<SubagentRole>(SUBAGENT_ROLES.filter((role) => subagentEnabled[role])),
    [subagentEnabled],
  );

  const subagentRoutes = useMemo(
    () => routes.filter((route) => route.role !== "planner" && enabledRoles.has(route.role as SubagentRole)),
    [routes, enabledRoles],
  );

  const savedRole = gitSettings.commitMessageRoleByProfileId[profileId] ?? "auto";

  useEffect(() => {
    if (!open) {
      return;
    }
    setMessage("");
    setIncludeUnstaged(true);
    setError(undefined);
    setModelMenuOpen(false);
    const resolved =
      savedRole !== "auto"
        ? savedRole
        : resolveDefaultCommitMessageRole(routes, routePricingHints, enabledRoles) ?? "auto";
    setSelectedRole(resolved);
  }, [open, profileId, savedRole, routes, routePricingHints, enabledRoles]);

  const selectedRoute = useMemo(
    () => resolveCommitMessageRoute(routes, routePricingHints, enabledRoles, selectedRole),
    [routes, routePricingHints, enabledRoles, selectedRole],
  );

  const modelLabel = useMemo(() => {
    const labels = subagentLabels(agentModelLabels);
    const match = labels.find((label) => label.role === selectedRoute?.role);
    if (match) {
      return match.title;
    }
    if (selectedRoute) {
      return `${selectedRoute.role} · ${selectedRoute.modelId}`;
    }
    return "未配置子代理";
  }, [agentModelLabels, selectedRoute]);

  const pricingLabel = useMemo(() => {
    const hint = routePricingHints.find((entry) => entry.role === selectedRoute?.role);
    return hint?.pricingLabel ?? (hint?.pricingResolved ? undefined : "定价未知");
  }, [routePricingHints, selectedRoute]);

  const handleSelectRole = useCallback(
    async (role: RuntimeAgentRole | "auto") => {
      setSelectedRole(role);
      setModelMenuOpen(false);
      await onSaveRolePreference(role);
    },
    [onSaveRolePreference],
  );

  const runAction = useCallback(
    async (action: CommitDialogAction) => {
      if (!window.eco || submitting) {
        return;
      }
      setSubmitting(true);
      setError(undefined);
      try {
        const rolePreference = selectedRole === "auto" ? undefined : selectedRole;
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
            ...(rolePreference && { role: rolePreference }),
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
        void runAction("commit-push");
      }
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, runAction]);

  if (!open) {
    return null;
  }

  const insertions = gitStatus?.insertions ?? 0;
  const deletions = gitStatus?.deletions ?? 0;
  const canPush = Boolean(gitStatus?.isGitRepository);
  const canCommit = Boolean(gitStatus?.canCommit);

  return createPortal(
    <div className="git-commit-dialog-backdrop" onMouseDown={onClose}>
      <div
        className="git-commit-dialog"
        role="dialog"
        aria-label="提交或推送"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event: FormEvent) => event.preventDefault()}
      >
        <header className="git-commit-dialog-header">
          <div className="git-commit-dialog-branch">
            <GitBranch size={14} aria-hidden />
            <span>{gitStatus?.branch ?? "detached"}</span>
            <ChevronDown size={12} aria-hidden />
          </div>
          <div className="git-commit-dialog-stats" aria-label="变更行数">
            <span className="git-commit-stat-add">+{insertions}</span>
            <span className="git-commit-stat-del">-{deletions}</span>
          </div>
          <button type="button" className="git-commit-dialog-close" aria-label="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </header>

        <textarea
          className="git-commit-dialog-message"
          value={message}
          placeholder="提交信息（留空将自动生成）…"
          rows={4}
          disabled={submitting || busy}
          onChange={(event) => setMessage(event.target.value)}
        />

        <div className="git-commit-dialog-model-row">
          <span className="git-commit-dialog-model-label">生成模型</span>
          <div className="git-commit-model-select-wrap">
            <button
              type="button"
              className="git-commit-model-select"
              disabled={submitting || busy || subagentRoutes.length === 0}
              aria-expanded={modelMenuOpen}
              onClick={() => setModelMenuOpen((current) => !current)}
            >
              <span>{modelLabel}</span>
              {pricingLabel ? <span className="git-commit-model-pricing">{pricingLabel}</span> : null}
              <ChevronDown size={12} aria-hidden />
            </button>
            {modelMenuOpen ? (
              <ul className="git-commit-model-menu" role="listbox">
                <li>
                  <button
                    type="button"
                    className={selectedRole === "auto" ? "is-active" : undefined}
                    onClick={() => void handleSelectRole("auto")}
                  >
                    <span>自动（最便宜子代理）</span>
                    {selectedRole === "auto" ? <Check size={14} /> : null}
                  </button>
                </li>
                {subagentRoutes.map((route) => {
                  const label = subagentLabels(agentModelLabels).find((entry) => entry.role === route.role);
                  const hint = routePricingHints.find((entry) => entry.role === route.role);
                  return (
                    <li key={route.role}>
                      <button
                        type="button"
                        className={selectedRole === route.role ? "is-active" : undefined}
                        onClick={() => void handleSelectRole(route.role)}
                      >
                        <span>{label?.title ?? `${route.role} · ${route.modelId}`}</span>
                        {hint?.pricingLabel ? (
                          <span className="git-commit-model-pricing">{hint.pricingLabel}</span>
                        ) : null}
                        {selectedRole === route.role ? <Check size={14} /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </div>

        <label className="git-commit-dialog-checkbox">
          <input
            type="checkbox"
            checked={includeUnstaged}
            disabled={submitting || busy}
            onChange={(event) => setIncludeUnstaged(event.target.checked)}
          />
          <span>包含未暂存的更改</span>
        </label>

        {error ? <p className="git-commit-dialog-error">{error}</p> : null}

        <ul className="git-commit-dialog-actions">
          <li>
            <button
              type="button"
              disabled={!canCommit || submitting || busy}
              onClick={() => void runAction("commit")}
            >
              <GitCommitHorizontal size={14} aria-hidden />
              <span>提交</span>
              {submitting ? <Loader2 size={14} className="spinning" aria-hidden /> : null}
            </button>
          </li>
          <li>
            <button
              type="button"
              className="is-primary"
              disabled={!canCommit || submitting || busy}
              onClick={() => void runAction("commit-push")}
            >
              <CloudUpload size={14} aria-hidden />
              <span>提交并推送</span>
              <kbd>⌘↩</kbd>
            </button>
          </li>
          <li>
            <button
              type="button"
              disabled={!canPush || submitting || busy || (gitStatus?.aheadCount ?? 0) <= 0}
              onClick={() => void runAction("push")}
            >
              <CloudUpload size={14} aria-hidden />
              <span>推送</span>
            </button>
          </li>
        </ul>
      </div>
    </div>,
    document.body,
  );
}
