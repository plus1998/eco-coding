import { FileCode2, RotateCcw, X } from "lucide-react";
import { Component, lazy, type ReactNode, Suspense, useEffect } from "react";
import { createPortal } from "react-dom";
import type { WorkspaceDiffResult } from "../shared/ipc";
import { clearVitePreloadRecovery } from "./vite-preload-recovery";

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
        <span>代码审查器加载失败</span>
        <button type="button" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </div>
    );
  }
}

function DiffViewerLoading() {
  return (
    <div className="workspace-diff-code-loading" role="status" aria-label="正在加载代码审查器">
      <span />
      <span />
      <span />
    </div>
  );
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

function formatDiffStat(value: number): string {
  return value > 0 ? String(value) : "0";
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
  const files = diff?.files ?? [];
  const activePath = selectedPath ?? files[0]?.path;

  return (
    <>
      {showHeader ? (
        <header className="workspace-diff-drawer-header">
          <div className="workspace-diff-drawer-header-main">
            <h3 className="workspace-diff-drawer-title">变更</h3>
            {diff ? (
              <span className="workspace-diff-drawer-meta" title="变更行数">
                <span className="diff-stat-add">+{formatDiffStat(diff.totalAdditions)}</span>
                <span className="diff-stat-del">-{formatDiffStat(diff.totalDeletions)}</span>
                <span className="workspace-diff-drawer-file-count">{diff.fileCount} 个文件</span>
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
                全部撤掉
              </button>
            ) : null}
            {onClose ? (
              <button
                type="button"
                className="workspace-diff-drawer-close"
                onClick={onClose}
                aria-label="关闭"
              >
                <X size={16} aria-hidden />
              </button>
            ) : null}
          </div>
        </header>
      ) : null}

      {loading ? (
        <div className="workspace-diff-drawer-state">加载变更中…</div>
      ) : error ? (
        <div className="workspace-diff-drawer-state workspace-diff-drawer-error" role="alert">
          {error}
        </div>
      ) : (
        <div className="workspace-diff-drawer-body">
          <div className="workspace-diff-drawer-files">
            <div className="workspace-diff-drawer-files-header">文件</div>
            {files.length === 0 ? (
              <p className="workspace-diff-drawer-files-empty">工作区没有未提交变更</p>
            ) : (
              <ul className="workspace-diff-drawer-file-list">
                {files.map((file) => {
                  const isActive = file.path === activePath;
                  return (
                    <li key={file.path} className="workspace-diff-drawer-file-row">
                      <button
                        type="button"
                        className={
                          isActive
                            ? "workspace-diff-drawer-file-select is-active"
                            : "workspace-diff-drawer-file-select"
                        }
                        onClick={() => onSelectPath(file.path)}
                      >
                        <FileCode2 className="workspace-diff-drawer-file-icon" size={13} aria-hidden />
                        <span className="workspace-diff-drawer-file-path" title={file.path}>
                          {file.path}
                        </span>
                        <span className="workspace-diff-drawer-file-stats">
                          <span className="diff-stat-add">+{formatDiffStat(file.additions)}</span>
                          <span className="diff-stat-del">-{formatDiffStat(file.deletions)}</span>
                        </span>
                      </button>
                      {onDiscardPath ? (
                        <button
                          type="button"
                          className="workspace-diff-drawer-file-discard"
                          aria-label={`撤掉 ${file.path}`}
                          title="撤掉此文件"
                          disabled={discardBusy}
                          onClick={() => void onDiscardPath(file.path)}
                        >
                          <RotateCcw size={13} aria-hidden />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="workspace-diff-drawer-preview">
            {diff?.patchTruncated ? (
              <p className="workspace-diff-drawer-truncated" role="status">
                diff 内容过长，已截断显示
              </p>
            ) : null}
            {activePath && diff?.patch ? (
              <DiffViewerErrorBoundary>
                <Suspense fallback={<DiffViewerLoading />}>
                  <GitDiffViewer patch={diff.patch} selectedPath={activePath} />
                </Suspense>
              </DiffViewerErrorBoundary>
            ) : (
              <p className="workspace-diff-empty">选择文件查看 diff</p>
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
        aria-label="关闭变更面板"
        onClick={onClose}
      />
      <aside className="workspace-diff-drawer" aria-label="工作区变更">
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
