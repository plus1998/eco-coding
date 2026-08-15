import { Diff, X } from "lucide-react";
import { Component, lazy, type ReactNode, Suspense, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { WorkspaceDiffResult } from "../shared/ipc";
import { i18n } from "./i18n";
import { clearVitePreloadRecovery } from "./vite-preload-recovery";
import { WorkspaceDiffFileTree } from "./WorkspaceDiffFileTree";

const GitDiffViewer = lazy(() =>
  import("./GitDiffViewer").then((module) => {
    clearVitePreloadRecovery();
    return { default: module.GitDiffViewer };
  }),
);

class DiffViewerErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("[eco] Git diff viewer failed", error);
  }

  render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <div className="workspace-diff-viewer-error" role="alert">
        <span>{i18n.t("workspace.diff.viewerFailed")}</span>
        <button type="button" onClick={() => window.location.reload()}>
          {i18n.t("workspace.diff.reload")}
        </button>
      </div>
    );
  }
}

function DiffViewerLoading() {
  return (
    <div
      className="workspace-diff-code-loading"
      role="status"
      aria-label={i18n.t("workspace.diff.loadingViewer")}
    >
      <span />
      <span />
      <span />
    </div>
  );
}

function formatDiffStat(value: number): string {
  return value > 0 ? String(value) : "0";
}

interface WorkspaceDiffDrawerProps {
  open: boolean;
  loading: boolean;
  discardBusy?: boolean;
  error?: string;
  diff?: WorkspaceDiffResult;
  selectedPath?: string;
  onSelectPath: (path: string) => void;
  onDiscardPath?: (path: string) => void | Promise<void>;
  onDiscardAll?: () => void | Promise<void>;
  onClose: () => void;
}

export interface WorkspaceDiffPanelProps {
  loading: boolean;
  discardBusy?: boolean;
  error?: string;
  diff?: WorkspaceDiffResult;
  selectedPath?: string;
  showHeader?: boolean;
  onSelectPath: (path: string) => void;
  onDiscardPath?: (path: string) => void | Promise<void>;
  onDiscardAll?: () => void | Promise<void>;
  onClose?: () => void;
}

export function WorkspaceDiffPanel({
  loading,
  discardBusy = false,
  error,
  diff,
  selectedPath,
  showHeader = false,
  onSelectPath,
  onDiscardPath,
  onDiscardAll,
  onClose,
}: WorkspaceDiffPanelProps) {
  const { t } = useTranslation();
  const files = diff?.files ?? [];
  const activePath = selectedPath ?? files[0]?.path;
  const activeFile = files.find((file) => file.path === activePath);

  return (
    <>
      {showHeader ? (
        <header className="workspace-diff-drawer-header">
          <div className="workspace-diff-drawer-header-main">
            <h3 className="workspace-diff-drawer-title">{t("workspace.diff.changes")}</h3>
            {diff ? (
              <span className="workspace-diff-drawer-meta" title={t("git.commit.changedLines")}>
                <span className="diff-stat-add">+{formatDiffStat(diff.totalAdditions)}</span>
                <span className="diff-stat-del">-{formatDiffStat(diff.totalDeletions)}</span>
                <span className="workspace-diff-drawer-file-count">
                  {t("workspace.diff.fileCount", { count: diff.fileCount })}
                </span>
              </span>
            ) : null}
          </div>
          <div className="workspace-diff-drawer-header-actions">
            {onDiscardAll ? (
              <button
                type="button"
                className="workspace-diff-drawer-discard-all"
                disabled={discardBusy || files.length === 0}
                onClick={() => void onDiscardAll()}
              >
                {t("workspace.diff.discardAll")}
              </button>
            ) : null}
            {onClose ? (
              <button
                type="button"
                className="workspace-diff-drawer-close"
                onClick={onClose}
                aria-label={t("common.close")}
              >
                <X size={16} aria-hidden />
              </button>
            ) : null}
          </div>
        </header>
      ) : null}

      {loading ? (
        <div className="workspace-diff-drawer-state">{t("workspace.diff.loading")}</div>
      ) : error ? (
        <div className="workspace-diff-drawer-state workspace-diff-drawer-error" role="alert">
          {error}
        </div>
      ) : (
        <div className="workspace-diff-drawer-body">
          <div className="workspace-diff-drawer-files">
            <WorkspaceDiffFileTree
              files={files}
              {...(diff?.workspacePath && {
                rootLabel: diff.workspacePath.split(/[\\/]/).filter(Boolean).slice(-2).join(" / "),
              })}
              {...(activePath && { activePath })}
              discardBusy={discardBusy}
              onSelectPath={onSelectPath}
              {...(onDiscardPath && { onDiscardPath })}
            />
          </div>
          <div className="workspace-diff-drawer-preview">
            {diff?.patchTruncated ? (
              <p className="workspace-diff-drawer-truncated" role="status">
                {t("workspace.diff.truncated")}
              </p>
            ) : null}
            {files.length === 0 ? (
              <div className="workspace-diff-empty-state" role="status">
                <Diff
                  className="workspace-diff-empty-state__icon"
                  size={48}
                  strokeWidth={1.25}
                  aria-hidden
                />
                <p className="workspace-diff-empty-state__title">
                  {t("workspace.diff.emptyTitle")}
                </p>
                <p className="workspace-diff-empty-state__hint">
                  {t("workspace.diff.emptyHint")}
                </p>
              </div>
            ) : activePath && diff?.patch && activeFile ? (
              <DiffViewerErrorBoundary>
                <Suspense fallback={<DiffViewerLoading />}>
                  <GitDiffViewer
                    patch={diff.patch}
                    selectedPath={activePath}
                    originalContent={activeFile.originalContent}
                    currentContent={activeFile.currentContent}
                    additions={activeFile.additions}
                    deletions={activeFile.deletions}
                  />
                </Suspense>
              </DiffViewerErrorBoundary>
            ) : activePath && diff?.patch ? (
              <p className="workspace-diff-empty">{t("workspace.diff.contentUnavailable")}</p>
            ) : (
              <p className="workspace-diff-empty">{t("workspace.diff.selectFile")}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function WorkspaceDiffDrawer({
  open,
  loading,
  discardBusy = false,
  error,
  diff,
  selectedPath,
  onSelectPath,
  onDiscardPath,
  onDiscardAll,
  onClose,
}: WorkspaceDiffDrawerProps) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <>
      <button
        type="button"
        className="workspace-diff-drawer-backdrop"
        aria-label={t("workspace.diff.closePanel")}
        onClick={onClose}
      />
      <aside className="workspace-diff-drawer" aria-label={t("workspace.diff.workspaceChanges")}>
        <WorkspaceDiffPanel
          loading={loading}
          discardBusy={discardBusy}
          {...(error && { error })}
          {...(diff && { diff })}
          {...(selectedPath && { selectedPath })}
          showHeader
          onSelectPath={onSelectPath}
          {...(onDiscardPath && { onDiscardPath })}
          {...(onDiscardAll && { onDiscardAll })}
          onClose={onClose}
        />
      </aside>
    </>,
    document.body,
  );
}
